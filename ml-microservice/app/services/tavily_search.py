"""
Tavily live-RAG client for Indian agricultural schemes.

Government scheme rules change mid-season and are never in a model's weights,
so this is a retrieval problem, not a generation problem. We bias the search
toward .gov.in / .nic.in domains and synthesise a farmer-readable summary with
explicit source attribution.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

TRUSTED_DOMAINS = [
    "pmkisan.gov.in",
    "pmfby.gov.in",
    "agriwelfare.gov.in",
    "agricoop.nic.in",
    "farmer.gov.in",
    "myscheme.gov.in",
    "soilhealth.dac.gov.in",
    "enam.gov.in",
    "pib.gov.in",
    "nabard.org",
]

SCHEME_KEYWORDS = [
    "eligibility", "apply", "documents", "deadline", "subsidy",
    "installment", "beneficiary", "registration", "amount",
]


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
    follow_up_questions: List[str] = field(default_factory=list)
    searched_at: str = ""
    source: str = "tavily"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["results"] = [asdict(r) if not isinstance(r, dict) else r for r in self.results]
        return d


class TavilySearchService:
    def __init__(self) -> None:
        self.api_key = os.getenv("TAVILY_API_KEY", "")
        self.base_url = os.getenv("TAVILY_BASE_URL", "https://api.tavily.com").rstrip("/")

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def _expand_query(self, query: str, state: Optional[str], language: str) -> str:
        parts = [query.strip()]
        if state:
            parts.append(state)
        parts.append("government scheme farmers India")
        parts.append("2026 eligibility apply")
        if language == "hi":
            parts.append("किसान योजना")
        return " ".join(parts)

    async def search(
        self,
        query: str,
        state: Optional[str] = None,
        language: str = "hi",
        max_results: int = 6,
    ) -> SchemeAnswer:
        import datetime as _dt

        now = _dt.datetime.now(_dt.timezone.utc).isoformat()

        if not self.enabled:
            return SchemeAnswer(
                query=query,
                summary=(
                    "सरकारी योजनाओं की लाइव खोज अभी उपलब्ध नहीं है। "
                    "कृपया अपने नज़दीकी कृषि विभाग कार्यालय या pmkisan.gov.in पर जाँच करें।"
                    if language == "hi"
                    else "Live scheme search is not configured. Please check pmkisan.gov.in or your nearest agriculture office."
                ),
                searched_at=now,
                source="unavailable",
            )

        payload: Dict[str, Any] = {
            "api_key": self.api_key,
            "query": self._expand_query(query, state, language),
            "search_depth": "advanced",
            "include_answer": True,
            "include_raw_content": False,
            "max_results": max_results,
            "include_domains": TRUSTED_DOMAINS,
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(f"{self.base_url}/search", json=payload)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error("Tavily HTTP %s: %s", exc.response.status_code, exc.response.text[:200])
            # Retry once without the domain filter — narrow filters often 0-result
            # for newly announced state schemes.
            payload.pop("include_domains", None)
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.post(f"{self.base_url}/search", json=payload)
                    resp.raise_for_status()
                    data = resp.json()
            except Exception as exc2:  # noqa: BLE001
                logger.error("Tavily retry failed: %s", exc2)
                return SchemeAnswer(query=query, summary=self._error_text(language),
                                    searched_at=now, source="error")
        except Exception as exc:  # noqa: BLE001
            logger.error("Tavily request failed: %s", exc)
            return SchemeAnswer(query=query, summary=self._error_text(language),
                                searched_at=now, source="error")

        results: List[SchemeResult] = []
        for item in data.get("results", []):
            url = str(item.get("url", ""))
            domain = url.split("/")[2] if "://" in url else url
            content = str(item.get("content", ""))
            bonus = sum(0.02 for k in SCHEME_KEYWORDS if k in content.lower())
            results.append(
                SchemeResult(
                    title=str(item.get("title", "")).strip(),
                    url=url,
                    snippet=content[:420].strip(),
                    domain=domain,
                    relevance=round(min(1.0, float(item.get("score", 0.0)) + bonus), 3),
                    official=any(d in domain for d in TRUSTED_DOMAINS),
                )
            )
        results.sort(key=lambda r: (r.official, r.relevance), reverse=True)

        summary = str(data.get("answer") or "").strip()
        if not summary and results:
            summary = results[0].snippet
        if not summary:
            summary = self._error_text(language)

        return SchemeAnswer(
            query=query,
            summary=summary,
            results=results,
            follow_up_questions=list(data.get("follow_up_questions") or [])[:3],
            searched_at=now,
            source="tavily",
        )

    @staticmethod
    def _error_text(language: str) -> str:
        return (
            "अभी जानकारी नहीं मिल पाई। थोड़ी देर बाद दोबारा कोशिश करें या pmkisan.gov.in देखें।"
            if language == "hi"
            else "Could not retrieve scheme information right now. Please retry shortly or visit pmkisan.gov.in."
        )


tavily_service = TavilySearchService()