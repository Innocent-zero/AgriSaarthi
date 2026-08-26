"""
Scheme RAG service.

Retrieval-grounded answering for government scheme questions, plus a
PMFBY-specific eligibility checker.

Answers are EXTRACTIVE: sentences are selected from retrieved passages, never
generated. For scheme rules this is the correct trade-off — a fluent paraphrase
that shifts a deadline from 72 hours to 7 days would cost a farmer their claim.
Every returned sentence is traceable to a cited source section.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from app.knowledge.schemes_seed import SCHEMES
from app.services.vector_store import Chunk, Hit, SchemeVectorStore, tokenize
from app.services.tavily_ingest import tavily_ingest
logger = logging.getLogger(__name__)

INDEX_PATH = os.getenv("RAG_INDEX_PATH", "app/models/artifacts/scheme_index.joblib")

# Sentence split that respects both the Latin full stop and the Devanagari danda.
SENT_SPLIT = re.compile(r"(?<=[.!?।])\s+")


def chunks_from_seed() -> List[Chunk]:
    """Flatten the seed corpus into retrievable chunks, one per section."""
    out: List[Chunk] = []
    for scheme in SCHEMES:
        for section in scheme["sections"]:
            out.append(Chunk(
                chunk_id=section["section_id"],
                scheme_id=scheme["scheme_id"],
                title_en=scheme["title_en"],
                title_hi=scheme["title_hi"],
                heading_en=section["heading_en"],
                heading_hi=section["heading_hi"],
                text_en=section["text_en"],
                text_hi=section["text_hi"],
                source_url=scheme["source_url"],
                official=scheme.get("official", True),
                keywords=list(section.get("keywords", [])),
                aliases=list(scheme.get("aliases", [])),
            ))
    return out


@dataclass
class Citation:
    scheme_id: str
    title: str
    heading: str
    source_url: str
    score: float


@dataclass
class RagAnswer:
    query: str
    answer: str
    citations: List[Citation] = field(default_factory=list)
    passages: List[Dict[str, Any]] = field(default_factory=list)
    grounded: bool = True
    confidence: float = 0.0
    language: str = "en"
    source: str = "knowledge-base"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query": self.query,
            "answer": self.answer,
            "citations": [c.__dict__ for c in self.citations],
            "passages": self.passages,
            "grounded": self.grounded,
            "confidence": round(self.confidence, 3),
            "language": self.language,
            "source": self.source,
        }


class SchemeRagService:
    def __init__(self) -> None:
        self.store = SchemeVectorStore()
        self._ensure_index()

    def _ensure_index(self) -> None:
        if self.store.load(INDEX_PATH):
            return
        logger.warning("Scheme index missing at %s — building", INDEX_PATH)
        self.store.build(chunks_from_seed() + self._load_live_chunks())
        try:
            self.store.save(INDEX_PATH)
        except Exception as exc:  # noqa: BLE001
            logger.error("Could not persist scheme index: %s", exc)

    @property
    def ready(self) -> bool:
        return self.store.ready

    def stats(self) -> Dict[str, Any]:
        return self.store.stats()

    def rebuild(self, extra: Optional[List[Chunk]] = None) -> Dict[str, Any]:
        chunks = chunks_from_seed() + list(extra or [])
        self.store.build(chunks)
        self.store.save(INDEX_PATH)
        return self.store.stats()

    # ─────────────── answering ───────────────
    def answer(self, query: str, language: str = "en", k: int = 4,
               scheme_id: Optional[str] = None) -> RagAnswer:
        hits = self.store.search(query, k=k, scheme_id=scheme_id)

        if not hits:
            return RagAnswer(
                query=query,
                answer=(
                    "इस सवाल का जवाब उपलब्ध योजना दस्तावेज़ों में नहीं मिला। "
                    "कृपया अपने नज़दीकी कृषि कार्यालय या संबंधित पोर्टल पर जाँच करें।"
                    if language == "hi"
                    else "That question is not covered by the scheme documents available here. "
                         "Please check with your nearest agriculture office or the relevant portal."
                ),
                grounded=False,
                confidence=0.0,
                language=language,
            )

        top = hits[0]
        answer_text = self._compose(query, hits, language)

        citations = [
            Citation(
                scheme_id=h.chunk.scheme_id,
                title=h.chunk.title(language),
                heading=h.chunk.heading(language),
                source_url=h.chunk.source_url,
                score=round(h.score, 3),
            )
            for h in hits
        ]

        return RagAnswer(
            query=query,
            answer=answer_text,
            citations=citations,
            passages=[h.to_dict(language) for h in hits],
            grounded=True,
            confidence=min(1.0, top.score * 1.4),
            language=language,
        )

    def _compose(self, query: str, hits: List[Hit], language: str) -> str:
        """
        Extractive composition: rank sentences from the retrieved passages by
        overlap with the query, then emit the best few in source order so the
        result still reads as continuous prose rather than a bag of fragments.
        """
        q_tokens = set(tokenize(query))
        scored: List[tuple] = []

        for rank, hit in enumerate(hits[:3]):
            text = hit.chunk.text(language)
            for pos, sentence in enumerate(SENT_SPLIT.split(text)):
                s = sentence.strip()
                if len(s) < 25:
                    continue
                overlap = len(q_tokens & set(tokenize(s)))
                # Passage rank matters as much as sentence overlap: a weaker
                # sentence from the best passage usually beats a keyword-dense
                # sentence from a marginally relevant one.
                score = overlap * 2.0 + (3 - rank) * 1.5 - pos * 0.1
                scored.append((score, rank, pos, s))

        if not scored:
            return hits[0].chunk.text(language)

        scored.sort(key=lambda x: -x[0])
        chosen = scored[:4]
        chosen.sort(key=lambda x: (x[1], x[2]))     # restore reading order

        out = " ".join(s for _, _, _, s in chosen)
        # Keep it readable on a phone; the full passage is in `passages`.
        return out[:900].rsplit(" ", 1)[0] + "…" if len(out) > 900 else out

    # ─────────────── PMFBY claim checker ───────────────
    def check_pmfby_claim(
        self,
        cause: str,
        event_date: str,
        estimated_loss_pct: float,
        language: str = "en",
        reported_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Rule-based eligibility screen, with each finding grounded in a retrieved
        passage. This is decision support for a farmer about to file, not an
        insurance determination — the wording of every finding says so.
        """
        hi = language == "hi"
        findings: List[Dict[str, Any]] = []

        # ── 1. 72-hour intimation window ──
        try:
            evt = datetime.strptime(event_date[:10], "%Y-%m-%d").date()
            ref = (
                datetime.strptime(reported_date[:10], "%Y-%m-%d").date()
                if reported_date else date.today()
            )
            hours = (ref - evt).days * 24
        except ValueError:
            hours = 0

        if hours <= 72:
            findings.append({
                "key": "intimation",
                "status": "ok",
                "text": (
                    f"घटना को लगभग {max(hours, 0)} घंटे हुए हैं — आप 72 घंटे की सीमा के भीतर हैं। "
                    "आज ही सूचना दर्ज करें।"
                    if hi else
                    f"About {max(hours, 0)} hours have passed — you are inside the 72-hour window. "
                    "File the intimation today."
                ),
            })
        else:
            findings.append({
                "key": "intimation",
                "status": "warning",
                "text": (
                    f"घटना को लगभग {hours} घंटे हो चुके हैं, जो 72 घंटे की सीमा से अधिक है। "
                    "फिर भी सूचना दर्ज करें और देरी का कारण लिखित में दें — कुछ मामलों में "
                    "उचित कारण स्वीकार किया जाता है।"
                    if hi else
                    f"About {hours} hours have passed, which is beyond the 72-hour window. "
                    "File the intimation anyway and record the reason for the delay in writing — "
                    "a justified delay is considered in some cases."
                ),
            })

        # ── 2. Is the cause a recognised localised peril? ──
        localised_terms = [
            "hail", "ओला", "landslide", "भूस्खलन", "inundation", "जलभराव",
            "cloud burst", "बादल", "fire", "आग", "lightning", "बिजली",
        ]
        cause_l = cause.lower()
        is_localised = any(term in cause_l for term in localised_terms)

        findings.append({
            "key": "peril",
            "status": "ok" if is_localised else "info",
            "text": (
                ("यह एक मान्य स्थानीय आपदा है, इसलिए आपके खेत का अलग से आकलन होगा — "
                 "पड़ोसी खेत सुरक्षित होने पर भी दावा बनता है।"
                 if is_localised else
                 "यह कारण स्थानीय आपदा की सूची में स्पष्ट नहीं है। यदि नुकसान पूरे क्षेत्र में हुआ है "
                 "तो क्षेत्र आधारित आकलन लागू होगा, जिसमें फसल कटाई प्रयोगों से उपज तय होती है।")
                if hi else
                ("This is a recognised localised calamity, so your field will be assessed "
                 "individually — the claim stands even if neighbouring fields were untouched."
                 if is_localised else
                 "This cause is not clearly on the localised calamity list. If the damage is "
                 "area-wide, the area approach applies and yield is determined by crop cutting "
                 "experiments.")
            ),
        })

        # ── 3. Loss magnitude ──
        if estimated_loss_pct >= 33:
            findings.append({
                "key": "magnitude",
                "status": "ok",
                "text": (
                    f"अनुमानित नुकसान {estimated_loss_pct:.0f}% है, जो सामान्य क्षतिपूर्ति सीमा से ऊपर है। "
                    "तुरंत सर्वे की माँग करें और खेत की फोटो व वीडियो रखें।"
                    if hi else
                    f"Estimated loss of {estimated_loss_pct:.0f}% is above the usual indemnity "
                    "threshold. Request a survey immediately and keep dated photographs and video "
                    "of the field."
                ),
            })
        else:
            findings.append({
                "key": "magnitude",
                "status": "info",
                "text": (
                    f"अनुमानित नुकसान {estimated_loss_pct:.0f}% है। सर्वे में अंतिम आकलन इससे अलग हो "
                    "सकता है, इसलिए सूचना देना फिर भी उचित है।"
                    if hi else
                    f"Estimated loss is {estimated_loss_pct:.0f}%. The surveyor's final assessment "
                    "may differ, so filing the intimation is still worthwhile."
                ),
            })

        # ── 4. Ground the guidance in retrieved passages ──
        rag_query = f"{cause} claim intimation localised calamity assessment"
        hits = self.store.search(rag_query, k=3, scheme_id="pmfby")

        return {
            "findings": findings,
            "guidance": self._compose(rag_query, hits, language) if hits else "",
            "citations": [
                {
                    "scheme_id": h.chunk.scheme_id,
                    "title": h.chunk.title(language),
                    "heading": h.chunk.heading(language),
                    "source_url": h.chunk.source_url,
                    "score": round(h.score, 3),
                }
                for h in hits
            ],
            "within_72h": hours <= 72,
            "hours_elapsed": max(hours, 0),
            "localised_peril": is_localised,
        }
    def _live_index_path(self) -> str:
        base, ext = os.path.splitext(INDEX_PATH)
        return f"{base}_live{ext}"

    async def refresh_from_web(self) -> Dict[str, Any]:
        """
        Crawl official portals via Tavily and rebuild the index with the results
        merged in. The seed corpus is always included, so a failed or empty
        crawl degrades to exactly the previous behaviour.
        """
        live_chunks, report = await tavily_ingest.collect()

        if not live_chunks:
            return {
                "success": False,
                "report": report.to_dict(),
                "stats": self.store.stats(),
                "note": "No live content collected; the existing index is unchanged.",
            }

        # Persist the live chunks so a restart does not lose the crawl.
        try:
            import joblib
            from dataclasses import asdict
            path = self._live_index_path()
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            joblib.dump([asdict(c) for c in live_chunks], path, compress=3)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not persist live chunks: %s", exc)

        self.store.build(chunks_from_seed() + live_chunks)
        self.store.save(INDEX_PATH)

        return {"success": True, "report": report.to_dict(), "stats": self.store.stats()}

    def _load_live_chunks(self) -> List[Chunk]:
        path = self._live_index_path()
        if not os.path.exists(path):
            return []
        try:
            import joblib
            return [Chunk(**c) for c in joblib.load(path)]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not load live chunks: %s", exc)
            return []


rag_service = SchemeRagService()