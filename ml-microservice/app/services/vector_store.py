"""
Hybrid vector store for the scheme knowledge base.

Retrieval combines two signals:

  1. Dense — TF-IDF projected through TruncatedSVD (latent semantic analysis),
     L2-normalised so cosine similarity is a dot product. Catches paraphrase:
     "when do I have to tell them" finds the intimation section.

  2. Lexical — BM25 over the same tokens. Catches exact terms: "72 hours",
     "PMFBY", "eKYC", "2 percent". Scheme queries are unusually keyword-heavy,
     which is why a pure-embedding store underperforms here.

Both are computed at query time and blended. The whole index serialises to
about 2 MB and loads in milliseconds — no external database, no GPU, no
network call, which keeps the service deployable on a small container and
usable when the network is poor.

If you later want transformer embeddings, implement encode() on a class with
the same interface and pass it as `encoder`; nothing else changes.
"""
from __future__ import annotations

import logging
import math
import os
import re
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

logger = logging.getLogger(__name__)

# Devanagari occupies U+0900–U+097F; the pattern keeps Hindi tokens intact
# alongside Latin words and bare numbers like "72" or "6000".
TOKEN_RE = re.compile(r"[a-zA-Z]+|[\u0900-\u097F]+|\d+")

ENGLISH_STOP = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "of",
    "to", "in", "for", "on", "at", "by", "with", "and", "or", "but", "if",
    "then", "this", "that", "these", "those", "it", "its", "as", "from",
    "can", "will", "would", "should", "do", "does", "did", "have", "has",
    "had", "i", "you", "my", "me", "we", "us", "our", "what", "how", "when",
    "where", "which", "who", "whom", "there", "here", "not", "no", "so",
}

HINDI_STOP = {
    "है", "हैं", "था", "थे", "थी", "का", "के", "की", "को", "में", "से", "पर",
    "और", "या", "यह", "वह", "ये", "वे", "एक", "कि", "भी", "ही", "तो", "नहीं",
    "क्या", "कैसे", "कब", "कहाँ", "कौन", "मैं", "मेरा", "मेरी", "हम", "आप",
    "अपना", "अपनी", "लिए", "साथ", "तक", "द्वारा", "गया", "गई", "करने", "होता",
}

STOPWORDS = ENGLISH_STOP | HINDI_STOP


def tokenize(text: str) -> List[str]:
    """Lowercase, split on script boundaries, drop stopwords and 1-char noise."""
    tokens = TOKEN_RE.findall(text.lower())
    return [t for t in tokens if t not in STOPWORDS and len(t) > 1]


def _analyzer(text: str) -> List[str]:
    """Module-level so joblib can pickle the vectorizer."""
    return tokenize(text)


@dataclass
class Chunk:
    """One retrievable passage plus everything needed to cite it."""
    chunk_id: str
    scheme_id: str
    title_en: str
    title_hi: str
    heading_en: str
    heading_hi: str
    text_en: str
    text_hi: str
    source_url: str
    official: bool = True
    keywords: List[str] = field(default_factory=list)
    aliases: List[str] = field(default_factory=list)
    live: bool = False
    fetched_at: str = ""

    def index_text(self) -> str:
        """
        The string actually indexed. Both languages plus keywords and aliases
        go in, so a Hindi query retrieves a chunk whose canonical text is
        English and vice versa — a cheap and effective substitute for a
        cross-lingual embedding model.
        """
        parts = [
            self.title_en, self.title_hi,
            self.heading_en, self.heading_hi,
            self.text_en, self.text_hi,
            " ".join(self.keywords),
            " ".join(self.aliases),
        ]
        return " \n ".join(p for p in parts if p)

    def text(self, language: str = "en") -> str:
        return self.text_hi if language == "hi" and self.text_hi else self.text_en

    def heading(self, language: str = "en") -> str:
        return self.heading_hi if language == "hi" and self.heading_hi else self.heading_en

    def title(self, language: str = "en") -> str:
        return self.title_hi if language == "hi" and self.title_hi else self.title_en


@dataclass
class Hit:
    chunk: Chunk
    score: float
    dense_score: float
    lexical_score: float

    def to_dict(self, language: str = "en") -> Dict[str, Any]:
        return {
            "chunk_id": self.chunk.chunk_id,
            "scheme_id": self.chunk.scheme_id,
            "title": self.chunk.title(language),
            "heading": self.chunk.heading(language),
            "text": self.chunk.text(language),
            "source_url": self.chunk.source_url,
            "official": self.chunk.official,
            "score": round(self.score, 4),
            "dense_score": round(self.dense_score, 4),
            "lexical_score": round(self.lexical_score, 4),
            "live": self.chunk.live,
            "fetched_at": self.chunk.fetched_at,
        }


class BM25:
    """
    Okapi BM25 over a token-id matrix.

    Implemented directly rather than pulled in as a dependency: it is forty
    lines, it avoids another package in the image, and having it inline makes
    the scoring auditable when a retrieval result looks wrong.
    """

    def __init__(self, corpus_tokens: List[List[str]], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.n_docs = len(corpus_tokens)
        self.doc_lens = np.array([len(d) for d in corpus_tokens], dtype=np.float64)
        self.avg_len = float(self.doc_lens.mean()) if self.n_docs else 0.0

        self.vocab: Dict[str, int] = {}
        for doc in corpus_tokens:
            for tok in doc:
                if tok not in self.vocab:
                    self.vocab[tok] = len(self.vocab)

        # Term-frequency matrix, docs x vocab. The corpus is small enough
        # (a few hundred chunks) that dense is simpler and fast enough.
        self.tf = np.zeros((self.n_docs, len(self.vocab)), dtype=np.float32)
        for i, doc in enumerate(corpus_tokens):
            for tok in doc:
                self.tf[i, self.vocab[tok]] += 1.0

        df = (self.tf > 0).sum(axis=0).astype(np.float64)
        # Standard BM25 idf with the +0.5 smoothing that keeps it positive.
        self.idf = np.log(1.0 + (self.n_docs - df + 0.5) / (df + 0.5))

    def score(self, query_tokens: List[str]) -> np.ndarray:
        scores = np.zeros(self.n_docs, dtype=np.float64)
        if self.n_docs == 0 or self.avg_len == 0:
            return scores

        norm = self.k1 * (1 - self.b + self.b * self.doc_lens / self.avg_len)
        for tok in query_tokens:
            j = self.vocab.get(tok)
            if j is None:
                continue
            f = self.tf[:, j].astype(np.float64)
            scores += self.idf[j] * (f * (self.k1 + 1)) / (f + norm)
        return scores


class SchemeVectorStore:
    """Build, persist, load and query the hybrid index."""

    VERSION = "1.0.0"

    def __init__(self) -> None:
        self.chunks: List[Chunk] = []
        self.vectorizer: Optional[TfidfVectorizer] = None
        self.svd: Optional[TruncatedSVD] = None
        self.matrix: Optional[np.ndarray] = None   # (n_chunks, n_components)
        self.bm25: Optional[BM25] = None
        self.alpha = float(os.getenv("RAG_HYBRID_ALPHA", "0.5"))  # dense weight

    # ─────────────── build ───────────────
    def build(self, chunks: List[Chunk], n_components: int = 128) -> None:
        if not chunks:
            raise ValueError("Cannot build an index from zero chunks")

        self.chunks = chunks
        texts = [c.index_text() for c in chunks]

        self.vectorizer = TfidfVectorizer(
            analyzer=_analyzer,
            sublinear_tf=True,
            min_df=1,
            max_df=0.92,
        )
        tfidf = self.vectorizer.fit_transform(texts)

        # SVD needs at least one fewer component than features/documents.
        max_components = max(2, min(n_components, min(tfidf.shape) - 1))
        self.svd = TruncatedSVD(n_components=max_components, random_state=42)
        dense = self.svd.fit_transform(tfidf)
        self.matrix = normalize(dense).astype(np.float32)

        self.bm25 = BM25([tokenize(t) for t in texts])

        explained = float(self.svd.explained_variance_ratio_.sum())
        logger.info(
            "Index built: %d chunks, %d components, %.1f%% variance explained",
            len(chunks), max_components, explained * 100,
        )

    # ─────────────── persistence ───────────────
    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        joblib.dump(
            {
                "version": self.VERSION,
                "chunks": [asdict(c) for c in self.chunks],
                "vectorizer": self.vectorizer,
                "svd": self.svd,
                "matrix": self.matrix,
                "bm25": self.bm25,
            },
            path,
            compress=3,
        )
        size_kb = os.path.getsize(path) / 1024
        logger.info("Index saved to %s (%.0f KB)", path, size_kb)

    def load(self, path: str) -> bool:
        if not os.path.exists(path):
            return False
        try:
            bundle = joblib.load(path)
            self.chunks = [Chunk(**c) for c in bundle["chunks"]]
            self.vectorizer = bundle["vectorizer"]
            self.svd = bundle["svd"]
            self.matrix = bundle["matrix"]
            self.bm25 = bundle["bm25"]
            logger.info("Index loaded: %d chunks (v%s)", len(self.chunks), bundle.get("version"))
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to load index from %s: %s", path, exc)
            return False

    @property
    def ready(self) -> bool:
        return bool(self.chunks) and self.matrix is not None and self.bm25 is not None

    # ─────────────── query ───────────────
    def search(
        self,
        query: str,
        k: int = 5,
        scheme_id: Optional[str] = None,
        min_score: float = 0.05,
    ) -> List[Hit]:
        if not self.ready or not query.strip():
            return []

        q_tfidf = self.vectorizer.transform([query])          # type: ignore[union-attr]
        q_dense = normalize(self.svd.transform(q_tfidf))      # type: ignore[union-attr]
        dense_scores = (self.matrix @ q_dense[0]).astype(np.float64)  # type: ignore[operator]

        lexical_raw = self.bm25.score(tokenize(query))        # type: ignore[union-attr]
        # BM25 is unbounded, cosine is [-1,1]; scale BM25 into [0,1] so the
        # blend weight means what it says.
        peak = float(lexical_raw.max())
        lexical_scores = lexical_raw / peak if peak > 0 else lexical_raw

        combined = self.alpha * dense_scores + (1.0 - self.alpha) * lexical_scores

        order = np.argsort(-combined)
        hits: List[Hit] = []
        for idx in order:
            chunk = self.chunks[int(idx)]
            if scheme_id and chunk.scheme_id != scheme_id:
                continue
            score = float(combined[idx])
            if score < min_score:
                break
            hits.append(Hit(
                chunk=chunk,
                score=score,
                dense_score=float(dense_scores[idx]),
                lexical_score=float(lexical_scores[idx]),
            ))
            if len(hits) >= k:
                break
        return hits

    def stats(self) -> Dict[str, Any]:
        schemes = sorted({c.scheme_id for c in self.chunks})
        return {
            "ready": self.ready,
            "chunks": len(self.chunks),
            "schemes": schemes,
            "components": int(self.svd.n_components) if self.svd else 0,
            "hybrid_alpha": self.alpha,
            "version": self.VERSION,
        }