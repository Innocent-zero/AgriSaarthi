"""
Tavily-driven knowledge base refresh.

The seed corpus holds settled scheme rules. This module keeps it current by
crawling official portals through Tavily's extract API, chunking what it finds,
and merging it into the vector index as dated `live` chunks.

Design notes:
  - Live chunks carry a fetch date and are marked `live=True`, so retrieval can
    prefer them for recency-sensitive questions while the seed corpus remains
    the authority on settled rules.
  - A refresh never destroys the seed corpus. Worst case, a failed refresh
    leaves the index exactly as it was.
  - Refresh is explicit (endpoint or CLI), not automatic on startup. A cold
    start must never block on a network crawl.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from app.services.vector_store import Chunk

logger = logging.getLogger(__name__)

WHITESPACE = re.compile(r"\s+")

# Portals crawled on refresh, with the scheme each belongs to.
REFRESH_TARGETS: List[Dict[str, str]] = [
    {"scheme_id": "pmfby",   "url": "https://pmfby.gov.in",             "title": "PMFBY portal"},
    {"scheme_id": "pmkisan", "url": "https://pmkisan.gov.in",           "title": "PM-KISAN portal"},
    {"scheme_id": "shc",     "url": "https://soilhealth.dac.gov.in",    "title": "Soil Health Card portal"},
    {"scheme_id": "enam",    "url": "https://enam.gov.in",              "title": "e-NAM portal"},
    {"scheme_id": "kusum",   "url": "https://pmkusum.mnre.gov.in",      "title": "PM-KUSUM portal"},
]

# Searches run on refresh to catch notifications that are not on a fixed URL.
REFRESH_QUERIES: List[Dict[str, str]] = [
    {"scheme_id": "pmfby",   "q": "PMFBY latest operational guidelines premium rate notification"},
    {"scheme_id": "pmkisan", "q": "PM-KISAN latest installment date eligibility eKYC update"},
    {"scheme_id": "kcc",     "q": "Kisan Credit Card interest subvention latest rate limit"},
    {"scheme_id": "kusum",   "q": "PM-KUSUM solar pump subsidy latest state share"},
]

TRUSTED = [
    "pmkisan.gov.in", "pmfby.gov.in", "agriwelfare.gov.in", "agricoop.nic.in",
    "farmer.gov.in", "myscheme.gov.in", "soilhealth.dac.gov.in", "enam.gov.in",
    "pib.gov.in", "nabard.org", "pmkusum.mnre.gov.in",
]


def clean(text: str) -> str:
    return WHITESPACE.sub(" ", text or "").strip()


def chunk_words(text: str, size: int = 700, overlap: int = 120) -> List[str]:
    """Sliding window with overlap so a rule spanning a boundary stays findable."""
    words = text.split()
    if len(words) <= size:
        return [" ".join(words)] if len(words) >= 40 else []
    out: List[str] = []
    step = max(1, size - overlap)
    for start in range(0, len(words), step):
        piece = words[start:start + size]
        if len(piece) < 40:
            break
        out.append(" ".join(piece))
    return out


@dataclass
class RefreshReport:
    started_at: str
    finished_at: str
    urls_extracted: int
    queries_run: int
    chunks_added: int
    errors: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return self.__dict__


class TavilyIngestService:
    def __init__(self) -> None:
        self.api_key = os.getenv("TAVILY_API_KEY", "")
        self.base_url = os.getenv("TAVILY_BASE_URL", "https://api.tavily.com").rstrip("/")

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    async def _post(self, path: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(f"{self.base_url}{path}", json=payload)
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Tavily %s failed: %s", path, exc)
            return None

    async def _extract(self, urls: List[str]) -> Dict[str, str]:
        """Full page content for a batch of URLs via Tavily's extract endpoint."""
        data = await self._post("/extract", {
            "api_key": self.api_key,
            "urls": urls,
            "extract_depth": "advanced",
        })
        if not data:
            return {}

        out: Dict[str, str] = {}
        for item in data.get("results", []):
            url = str(item.get("url", ""))
            content = clean(str(item.get("raw_content") or item.get("content") or ""))
            if url and len(content) > 300:
                out[url] = content
        return out

    async def _search(self, query: str, max_results: int = 4) -> List[Dict[str, str]]:
        data = await self._post("/search", {
            "api_key": self.api_key,
            "query": query,
            "search_depth": "advanced",
            "include_answer": False,
            "include_raw_content": True,
            "max_results": max_results,
            "include_domains": TRUSTED,
        })
        if not data:
            return []

        out: List[Dict[str, str]] = []
        for item in data.get("results", []):
            content = clean(str(item.get("raw_content") or item.get("content") or ""))
            if len(content) < 300:
                continue
            out.append({
                "url": str(item.get("url", "")),
                "title": str(item.get("title", "")).strip(),
                "content": content,
            })
        return out

    async def collect(self) -> tuple[List[Chunk], RefreshReport]:
        started = datetime.now(timezone.utc).isoformat()
        errors: List[str] = []
        chunks: List[Chunk] = []
        extracted = 0
        queries = 0

        if not self.enabled:
            return [], RefreshReport(started, started, 0, 0, 0, ["TAVILY_API_KEY not configured"])

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # ── portal extraction ──
        by_url = {t["url"]: t for t in REFRESH_TARGETS}
        pages = await self._extract(list(by_url.keys()))
        extracted = len(pages)

        for url, content in pages.items():
            target = by_url.get(url) or {"scheme_id": "misc", "title": url}
            for i, piece in enumerate(chunk_words(content)):
                chunks.append(self._make_chunk(
                    scheme_id=target["scheme_id"],
                    title=target["title"],
                    heading=f"{target['title']} — updated {today}",
                    text=piece,
                    url=url,
                    idx=i,
                    stamp=today,
                ))

        # ── query-driven collection ──
        for spec in REFRESH_QUERIES:
            results = await self._search(spec["q"])
            queries += 1
            for r_i, r in enumerate(results):
                for i, piece in enumerate(chunk_words(r["content"])):
                    chunks.append(self._make_chunk(
                        scheme_id=spec["scheme_id"],
                        title=r["title"] or spec["scheme_id"].upper(),
                        heading=f"{r['title'][:70] or spec['scheme_id']} — {today}",
                        text=piece,
                        url=r["url"],
                        idx=f"{r_i}_{i}",
                        stamp=today,
                    ))
            # Be polite between searches.
            await asyncio.sleep(0.4)

        finished = datetime.now(timezone.utc).isoformat()
        logger.info("Tavily refresh: %d pages, %d queries, %d chunks",
                    extracted, queries, len(chunks))

        return chunks, RefreshReport(
            started_at=started,
            finished_at=finished,
            urls_extracted=extracted,
            queries_run=queries,
            chunks_added=len(chunks),
            errors=errors,
        )

    @staticmethod
    def _make_chunk(*, scheme_id: str, title: str, heading: str, text: str,
                    url: str, idx: Any, stamp: str) -> Chunk:
        return Chunk(
            chunk_id=f"{scheme_id}.live.{stamp}.{idx}",
            scheme_id=scheme_id,
            title_en=title,
            title_hi=title,
            heading_en=heading,
            heading_hi=heading,
            text_en=text,
            text_hi="",
            source_url=url,
            official=any(d in url for d in TRUSTED),
            keywords=["latest", "update", "ताज़ा", "नया", stamp],
            aliases=[scheme_id],
            live=True,
            fetched_at=stamp,
        )


tavily_ingest = TavilyIngestService()