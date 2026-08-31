"""
Build the scheme index.

Default builds from the seed corpus alone:

    python -m app.scripts.ingest

To supplement with official PDFs — strongly recommended before any public
deployment, since seed figures can go stale:

    python -m app.scripts.ingest --pdf-dir data/scheme_pdfs

Name each PDF <scheme_id>__<Readable Title>.pdf, e.g.

    pmfby__Operational Guidelines 2024.pdf
    pmkisan__Scheme FAQ.pdf

PDF text is chunked with overlap and indexed alongside the seed sections.
Retrieval treats both identically; PDF chunks tend to win on specific queries
because they carry the exact clause language.
"""
from __future__ import annotations

# Must run before importing app.services.* singletons — this script is
# invoked standalone (via `python -m app.scripts.ingest`, e.g. from
# `make train` / `make ingest`), so it never goes through app.main and would
# otherwise silently ignore everything in .env (RAG_INDEX_PATH,
# TAVILY_API_KEY, etc. would all fall back to their hardcoded defaults).
from dotenv import load_dotenv
load_dotenv()

import argparse
import glob
import logging
import os
import re
from typing import List

from app.services.rag_service import INDEX_PATH, chunks_from_seed, rag_service
from app.services.vector_store import Chunk

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("ingest")

WHITESPACE = re.compile(r"\s+")


def clean(text: str) -> str:
    return WHITESPACE.sub(" ", text).strip()


def chunk_text(text: str, size: int = 900, overlap: int = 150) -> List[str]:
    """
    Sliding window over words. Overlap matters: a rule that straddles a chunk
    boundary ("...within 72 hours | of the event...") would otherwise be
    retrievable by neither half.
    """
    words = text.split()
    if len(words) <= size:
        return [" ".join(words)] if words else []

    out: List[str] = []
    step = max(1, size - overlap)
    for start in range(0, len(words), step):
        piece = words[start:start + size]
        if len(piece) < 40 and out:      # trailing scrap, fold it in
            break
        out.append(" ".join(piece))
    return out


def pdf_chunks(pdf_dir: str) -> List[Chunk]:
    try:
        from pypdf import PdfReader
    except ImportError:
        raise SystemExit("pypdf is not installed. Run: pip install pypdf")

    paths = sorted(glob.glob(os.path.join(pdf_dir, "*.pdf")))
    if not paths:
        logger.warning("No PDFs found in %s", pdf_dir)
        return []

    out: List[Chunk] = []
    for path in paths:
        base = os.path.basename(path)[:-4]
        scheme_id, _, title = base.partition("__")
        scheme_id = scheme_id.strip().lower() or "misc"
        title = title.strip() or scheme_id.upper()

        try:
            reader = PdfReader(path)
        except Exception as exc:  # noqa: BLE001
            logger.error("Could not read %s: %s", base, exc)
            continue

        pages = []
        for page in reader.pages:
            try:
                pages.append(page.extract_text() or "")
            except Exception:  # noqa: BLE001
                continue

        text = clean(" ".join(pages))
        if len(text) < 200:
            logger.warning("%s yielded almost no text — is it a scanned image?", base)
            continue

        pieces = chunk_text(text)
        for i, piece in enumerate(pieces):
            out.append(Chunk(
                chunk_id=f"{scheme_id}.pdf.{i:03d}",
                scheme_id=scheme_id,
                title_en=title,
                title_hi=title,
                heading_en=f"{title} — part {i + 1}",
                heading_hi=f"{title} — भाग {i + 1}",
                text_en=piece,
                text_hi="",              # PDF language is whatever the source is
                source_url="",
                official=True,
                keywords=[],
                aliases=[scheme_id],
            ))
        logger.info("%s → %d chunks", base, len(pieces))

    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the AgriSaarthi scheme index")
    ap.add_argument("--pdf-dir", type=str, default=None, help="directory of official scheme PDFs")
    ap.add_argument("--out", type=str, default=INDEX_PATH)
    ap.add_argument("--components", type=int, default=128)
    args = ap.parse_args()

    chunks = chunks_from_seed()
    logger.info("Seed corpus: %d chunks", len(chunks))

    if args.pdf_dir:
        extra = pdf_chunks(args.pdf_dir)
        logger.info("PDF corpus: %d chunks", len(extra))
        chunks += extra

    rag_service.store.build(chunks, n_components=args.components)
    rag_service.store.save(args.out)

    stats = rag_service.store.stats()
    print(f"\n✓ Index written to {args.out}")
    print(f"  chunks     : {stats['chunks']}")
    print(f"  schemes    : {', '.join(stats['schemes'])}")
    print(f"  components : {stats['components']}")

    # Smoke test — these should all return a sensible top hit.
    print("\nRetrieval smoke test:")
    for q in [
        "how long do I have to report hail damage",
        "ओले से नुकसान की सूचना कितने समय में देनी है",
        "why is my PM-KISAN installment not coming",
        "what interest rate on kisan credit card",
        "मिट्टी की जांच कैसे कराएं",
    ]:
        hits = rag_service.store.search(q, k=1)
        top = hits[0] if hits else None
        print(f"  {q[:48]:<50} → {top.chunk.chunk_id if top else 'NO MATCH'}"
              f" ({top.score:.3f})" if top else "")


if __name__ == "__main__":
    main()