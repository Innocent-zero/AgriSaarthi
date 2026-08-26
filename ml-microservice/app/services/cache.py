"""
TTL cache for Tavily responses. Redis when REDIS_URL is set, in-memory
otherwise — mirrors the fallback pattern already used for SoilGrids.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional

from app.config import get_settings

logger = logging.getLogger(__name__)
_settings = get_settings()
_redis_client = None

if _settings.redis_url:
    try:
        import redis as _redis_lib
        _redis_client = _redis_lib.from_url(_settings.redis_url, decode_responses=True)
        _redis_client.ping()
        logger.info("Tavily cache: using Redis at %s", _settings.redis_url)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Redis unavailable (%s) — falling back to in-memory cache", exc)
        _redis_client = None

_memory_store: dict[str, tuple[float, str]] = {}


def backend_name() -> str:
    return "redis" if _redis_client is not None else "memory"


def cache_get(key: str) -> Optional[Any]:
    if _redis_client is not None:
        try:
            raw = _redis_client.get(key)
            return json.loads(raw) if raw else None
        except Exception as exc:  # noqa: BLE001
            logger.warning("Redis get failed for %s: %s", key, exc)
            return None
    entry = _memory_store.get(key)
    if entry is None:
        return None
    expires_at, raw = entry
    if expires_at < time.time():
        _memory_store.pop(key, None)
        return None
    return json.loads(raw)


def cache_set(key: str, value: Any, ttl_s: int) -> None:
    raw = json.dumps(value)
    if _redis_client is not None:
        try:
            _redis_client.set(key, raw, ex=ttl_s)
            return
        except Exception as exc:  # noqa: BLE001
            logger.warning("Redis set failed for %s: %s", key, exc)
    _memory_store[key] = (time.time() + ttl_s, raw)