"""
Tavily live-RAG client for Indian agricultural schemes.

Government scheme rules change mid-season and are never in a model's weights,
so this is a retrieval problem, not a generation problem. We bias the search
toward .gov.in / .nic.in domains and synthesise a farmer-readable summary with
explicit source attribution.

Domain trust is TLD-suffix based rather than an exact-match whitelist, so a
newly launched state portal (e.g. krushi.odisha.gov.in, telangana.gov.in) is
recognised as official the moment it appears in results — no code change or
redeploy needed when a new state rolls out its own scheme portal.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# Suffix-based official detection: any domain ENDING WITH one of these is
# treated as an official government (or apex financial institution) source.
# This intentionally has no per-state list — every *.gov.in / *.nic.in domain
# qualifies automatically, current or future.
OFFICIAL_TLD_SUFFIXES = (".gov.in", ".nic.in", "nabard.org")

# Tier 2: trusted press / apex bodies that aren't *.gov.in|nic.in themselves
# but are reliable for reporting newly announced cabinet approvals before the
# official portal catches up.
TRUSTED_PRESS_DOMAINS = (
    "prsindia.org",
    "thehindu.com",
    "indianexpress.com",
    "livemint.com",
    "downtoearth.org.in",
)

SCHEME_KEYWORDS = [
    "eligibility", "apply", "documents", "deadline", "subsidy",
    "installment", "beneficiary", "registration", "amount",
]

# Relevance boosts applied post-retrieval (tiered scoring, not a hard filter).
TIER1_OFFICIAL_BOOST = 0.35   # *.gov.in / *.nic.in / nabard.org
TIER2_PRESS_BOOST = 0.15      # trusted press & apex orgs
TIER3_KEYWORD_BONUS = 0.02    # per matched scheme keyword


def _is_official_domain(domain: str) -> bool:
    """TLD-suffix check — no hardcoded state list, so any *.gov.in/*.nic.in
    subdomain (including brand-new state portals) is recognised automatically."""
    domain = domain.lower()
    return domain.endswith(OFFICIAL_TLD_SUFFIXES)


def _is_trusted_press(domain: str) -> bool:
    domain = domain.lower()
    return any(domain.endswith(d) or d in domain for d in TRUSTED_PRESS_DOMAINS)


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

    def _expand_query(
        self,
        query: str,
        state: Optional[str],
        language: str,
        *,
        with_site_operators: bool = True,
    ) -> str:
        """Build a broader query that surfaces both the stable central-scheme
        portals and freshly announced state-level / cabinet-approved schemes.

        with_site_operators=False is used on retry, since `site:` operators
        combined with an empty broader web search can over-constrain results
        for very new announcements that search engines haven't indexed under
        those domains yet.
        """
        parts = [query.strip()]

        if state:
            parts.append(state)
            parts.append(f"{state} government scheme")

        parts.append("government scheme farmers India")
        parts.append("2026 eligibility apply")
        parts.append("cabinet approval press release")

        # Intent terms that help surface eligibility/registration pages as
        # well as brand-new cabinet-approved scheme announcements.
        parts.extend(["eligibility", "apply", "press release"])

        if language == "hi":
            parts.append("किसान योजना")

        if with_site_operators:
            parts.append("(site:gov.in OR site:nic.in)")

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
        }

        async def _do_request(body: Dict[str, Any]) -> Dict[str, Any]:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(f"{self.base_url}/search", json=body)
                resp.raise_for_status()
                return resp.json()

        def _needs_retry(body: Dict[str, Any]) -> bool:
            """Retry not just on HTTP errors but also on a 200 with an empty
            result set — narrow/newly-announced state schemes often 0-result
            on the first, more constrained pass."""
            return not body.get("results")

        data: Dict[str, Any] = {}
        try:
            data = await _do_request(payload)
            if _needs_retry(data):
                logger.info("Tavily returned 0 results, retrying with broader web search")
                retry_payload = dict(payload)
                retry_payload["query"] = self._expand_query(
                    query, state, language, with_site_operators=False
                )
                retry_payload.pop("include_domains", None)
                data = await _do_request(retry_payload)
        except httpx.HTTPStatusError as exc:
            logger.error("Tavily HTTP %s: %s", exc.response.status_code, exc.response.text[:200])
            # Retry once without any domain constraints — narrow filters often
            # 0-result for newly announced state schemes.
            retry_payload = dict(payload)
            retry_payload["query"] = self._expand_query(
                query, state, language, with_site_operators=False
            )
            retry_payload.pop("include_domains", None)
            try:
                data = await _do_request(retry_payload)
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

            base_score = float(item.get("score", 0.0))
            is_official = _is_official_domain(domain)

            # Tiered post-retrieval scoring instead of a hard whitelist gate.
            if is_official:
                boost = TIER1_OFFICIAL_BOOST
            elif _is_trusted_press(domain):
                boost = TIER2_PRESS_BOOST
            else:
                boost = 0.0

            keyword_bonus = sum(
                TIER3_KEYWORD_BONUS for k in SCHEME_KEYWORDS if k in content.lower()
            )

            relevance = max(0.0, min(1.0, base_score + boost + keyword_bonus))

            results.append(
                SchemeResult(
                    title=str(item.get("title", "")).strip(),
                    url=url,
                    snippet=content[:420].strip(),
                    domain=domain,
                    relevance=round(relevance, 3),
                    official=is_official,
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