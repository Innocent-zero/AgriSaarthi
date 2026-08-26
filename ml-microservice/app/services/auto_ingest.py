"""
Automatic re-ingestion of the PDF corpus. Fingerprints the directory
(name + size + mtime, not content — cheap and good enough for a folder a
human drops files into) and rebuilds the index when it changes.
"""
from __future__ import annotations

import asyncio
import glob
import hashlib
import json
import logging
import os
from typing import Dict

from app.config import get_settings

logger = logging.getLogger(__name__)
_settings = get_settings()
_MANIFEST_PATH = os.path.join(os.path.dirname(_settings.rag_index_path), "pdf_manifest.json")


def _fingerprint(pdf_dir: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for path in sorted(glob.glob(os.path.join(pdf_dir, "*.pdf"))):
        stat = os.stat(path)
        sig = f"{stat.st_size}:{int(stat.st_mtime)}"
        out[os.path.basename(path)] = hashlib.sha1(sig.encode()).hexdigest()
    return out


def _load_manifest() -> Dict[str, str]:
    if os.path.exists(_MANIFEST_PATH):
        try:
            with open(_MANIFEST_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:  # noqa: BLE001
            return {}
    return {}


def _save_manifest(fp: Dict[str, str]) -> None:
    os.makedirs(os.path.dirname(_MANIFEST_PATH) or ".", exist_ok=True)
    with open(_MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(fp, f)


def check_and_reingest(force: bool = False) -> bool:
    """Returns True if a rebuild happened."""
    pdf_dir = _settings.scheme_pdf_dir
    if not os.path.isdir(pdf_dir):
        return False

    current = _fingerprint(pdf_dir)
    if not force and current == _load_manifest():
        return False

    from app.scripts.ingest import pdf_chunks           # local import avoids a cycle
    from app.services.rag_service import chunks_from_seed, rag_service

    logger.info("PDF corpus changed (%d files) — rebuilding index", len(current))
    chunks = chunks_from_seed() + pdf_chunks(pdf_dir)
    rag_service.store.build(chunks)
    rag_service.store.save(_settings.rag_index_path)
    _save_manifest(current)
    return True


async def auto_reingest_loop() -> None:
    interval_h = _settings.auto_reingest_hours
    if interval_h <= 0:
        logger.info("Auto-reingest disabled (AUTO_REINGEST_HOURS=0)")
        return
    logger.info("Auto-reingest watching %s every %.1fh", _settings.scheme_pdf_dir, interval_h)
    while True:
        try:
            if check_and_reingest():
                logger.info("Index auto-rebuilt from updated PDF corpus")
        except Exception as exc:  # noqa: BLE001
            logger.error("Auto-reingest check failed: %s", exc)
        await asyncio.sleep(interval_h * 3600)