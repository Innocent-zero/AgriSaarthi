"""
Scheme answering: knowledge base first, live web second.

Order matters. The knowledge base holds settled rules — premium caps, the
72-hour window, eligibility exclusions — which are exactly the questions
farmers ask most and exactly where a hallucinated answer does real damage.
Tavily is reserved for genuinely current things the corpus cannot know:
newly announced state schemes, revised instalment dates, fresh notifications.
"""
from __future__ import annotations

import datetime as _dt
import logging
import os
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

import httpx

from app.services.rag_service import rag_service

logger = logging.getLogger(__name__)

TRUSTED_DOMAINS = [
    "pmkisan.gov.in", "pmfby.gov.in", "agriwelfare.gov.in", "agricoop.nic.in",
    "farmer.gov.in", "myscheme.gov.in", "soilhealth.dac.gov.in", "enam.gov.in",
    "pib.gov.in", "nabard.org", "pmkusum.mnre.gov.in",
]

# Queries containing these are asking about change, not about the rules,
# so the knowledge base is the wrong source even when it scores well.
RECENCY_MARKERS = [
    "new", "latest", "announced", "this year", "2026", "2025", "update",
    "changed", "revised", "deadline", "last date", "when will",
    "नया", "नई", "ताज़ा", "ताजा", "घोषणा", "इस साल", "बदल", "संशोधित",
    "अंतिम तिथि", "कब आएगी", "कब मिलेगी",
]

GROUNDED_THRESHOLD = float(os.getenv("RAG_MIN_CONFIDENCE", "0.28"))


@dataclass
class SchemeResult:
    title: str
    url: str
    snippet: str
    domain: str
    relevance: float
    official: bool


@dataclass
class SchemeAnswer:
    query: str
    summary: str
    results: List[SchemeResult] = field(default_factory=list)
    citations: List[Dict[str, Any]] = field(default_factory=list)
    follow_up_questions: List[str] = field(default_factory=list)
    searched_at: str = ""
    source: str = "knowledge-base"
    grounded: bool = True
    confidence: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["results"] = [r if isinstance(r, dict) else asdict(r) for r in self.results]
        return d


class SchemeAnswerService:
    def __init__(self) -> None:
        self.api_key = os.getenv("TAVILY_API_KEY", "")
        self.base_url = os.getenv("TAVILY_BASE_URL", "https://api.tavily.com").rstrip("/")

    @property
    def tavily_enabled(self) -> bool:
        return bool(self.api_key)

    @staticmethod
    def _now() -> str:
        return _dt.datetime.now(_dt.timezone.utc).isoformat()

    @staticmethod
    def _wants_recency(query: str) -> bool:
        q = query.lower()
        return any(m in q for m in RECENCY_MARKERS)

    async def search(
        self,
        query: str,
        state: Optional[str] = None,
        language: str = "hi",
        max_results: int = 6,
    ) -> SchemeAnswer:
        recency = self._wants_recency(query)

        # ── 1. Knowledge base ──
        rag = rag_service.answer(query, language=language, k=4)

        if rag.grounded and rag.confidence >= GROUNDED_THRESHOLD and not recency:
            results = [
                SchemeResult(
                    title=f"{p['title']} — {p['heading']}",
                    url=p["source_url"],
                    snippet=p["text"][:420],
                    domain=(p["source_url"].split("/")[2] if "://" in p["source_url"] else "knowledge base"),
                    relevance=p["score"],
                    official=p["official"],
                )
                for p in rag.passages
            ]
            return SchemeAnswer(
                query=query,
                summary=rag.answer,
                results=results,
                citations=[c.__dict__ for c in rag.citations],
                searched_at=self._now(),
                source="knowledge-base",
                grounded=True,
                confidence=rag.confidence,
            )

        # ── 2. Live web ──
        if self.tavily_enabled:
            live = await self._tavily(query, state, language, max_results)
            if live:
                # Keep the grounded answer alongside the live result when we
                # have one — the rules give context the news item assumes.
                if rag.grounded and rag.confidence >= GROUNDED_THRESHOLD * 0.7:
                    live.summary = f"{rag.answer}\n\n{live.summary}"
                    live.citations = [c.__dict__ for c in rag.citations]
                    live.source = "knowledge-base + live"
                return live

        # ── 3. Whatever the knowledge base had, even if weak ──
        if rag.grounded:
            return SchemeAnswer(
                query=query,
                summary=rag.answer,
                results=[
                    SchemeResult(
                        title=f"{p['title']} — {p['heading']}",
                        url=p["source_url"],
                        snippet=p["text"][:420],
                        domain=(p["source_url"].split("/")[2] if "://" in p["source_url"] else "knowledge base"),
                        relevance=p["score"],
                        official=p["official"],
                    )
                    for p in rag.passages
                ],
                citations=[c.__dict__ for c in rag.citations],
                searched_at=self._now(),
                source="knowledge-base",
                grounded=True,
                confidence=rag.confidence,
            )

        return SchemeAnswer(
            query=query,
            summary=(
                "इस सवाल का भरोसेमंद जवाब अभी उपलब्ध नहीं है। कृपया अपने कृषि कार्यालय या "
                "संबंधित सरकारी पोर्टल पर जाँच करें।"
                if language == "hi"
                else "A reliable answer is not available for this question. Please check with your "
                     "agriculture office or the relevant government portal."
            ),
            searched_at=self._now(),
            source="none",
            grounded=False,
            confidence=0.0,
        )

    async def _tavily(
        self, query: str, state: Optional[str], language: str, max_results: int,
    ) -> Optional[SchemeAnswer]:
        parts = [query.strip()]
        if state:
            parts.append(state)
        parts.append("government scheme farmers India")
        if language == "hi":
            parts.append("किसान योजना")

        payload: Dict[str, Any] = {
            "api_key": self.api_key,
            "query": " ".join(parts),
            "search_depth": "advanced",
            "include_answer": True,
            "include_raw_content": False,
            "max_results": max_results,
            "include_domains": TRUSTED_DOMAINS,
        }

        data = await self._post(payload)
        if data is None:
            # Domain-restricted searches return nothing for brand-new state
            # schemes; retry once unrestricted before giving up.
            payload.pop("include_domains", None)
            data = await self._post(payload)
        if data is None:
            return None

        results: List[SchemeResult] = []
        for item in data.get("results", []):
            url = str(item.get("url", ""))
            domain = url.split("/")[2] if "://" in url else url
            results.append(SchemeResult(
                title=str(item.get("title", "")).strip(),
                url=url,
                snippet=str(item.get("content", ""))[:420].strip(),
                domain=domain,
                relevance=round(float(item.get("score", 0.0)), 3),
                official=any(d in domain for d in TRUSTED_DOMAINS),
            ))
        results.sort(key=lambda r: (r.official, r.relevance), reverse=True)

        summary = str(data.get("answer") or "").strip()
        if not summary and results:
            summary = results[0].snippet
        if not summary:
            return None

        return SchemeAnswer(
            query=query,
            summary=summary,
            results=results,
            follow_up_questions=list(data.get("follow_up_questions") or [])[:3],
            searched_at=self._now(),
            source="live-search",
            grounded=False,
            confidence=0.5,
        )

    async def _post(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(f"{self.base_url}/search", json=payload)
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Tavily request failed: %s", exc)
            return None


tavily_service = SchemeAnswerService()