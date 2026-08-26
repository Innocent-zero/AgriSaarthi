"""
Centralized runtime configuration, validated once at import time.

Nothing else in the service should call os.getenv() directly — that's how
the Tavily key ended up wired with three different default values in three
different files.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── RAG / knowledge base ──
    rag_index_path: str = Field("app/models/artifacts/scheme_index.joblib", alias="RAG_INDEX_PATH")
    rag_hybrid_alpha: float = Field(0.5, alias="RAG_HYBRID_ALPHA")
    rag_min_confidence: float = Field(0.28, alias="RAG_MIN_CONFIDENCE")
    scheme_pdf_dir: str = Field("data/scheme_pdfs", alias="SCHEME_PDF_DIR")
    auto_reingest_hours: float = Field(6.0, alias="AUTO_REINGEST_HOURS")  # 0 disables
    scheme_data_current_as_of: str = Field("2026-01", alias="SCHEME_DATA_CURRENT_AS_OF")

    # ── Tavily (live web fallback) ──
    tavily_api_key: str = Field("", alias="TAVILY_API_KEY")
    tavily_base_url: str = Field("https://api.tavily.com", alias="TAVILY_BASE_URL")
    tavily_timeout_s: float = Field(20.0, alias="TAVILY_TIMEOUT_S")
    tavily_max_retries: int = Field(2, alias="TAVILY_MAX_RETRIES")
    tavily_cache_ttl_s: int = Field(3600, alias="TAVILY_CACHE_TTL_S")
    tavily_breaker_fail_threshold: int = Field(3, alias="TAVILY_BREAKER_FAIL_THRESHOLD")
    tavily_breaker_reset_s: int = Field(120, alias="TAVILY_BREAKER_RESET_S")
    tavily_recency_markers: str = Field(
        "new,latest,announced,this year,update,changed,revised,deadline,last date,"
        "when will,नया,नई,ताज़ा,ताजा,घोषणा,इस साल,बदल,संशोधित,अंतिम तिथि,कब आएगी,कब मिलेगी",
        alias="TAVILY_RECENCY_MARKERS",
    )

    # ── Cache backend — shares the Node gateway's Redis when pointed at it ──
    redis_url: Optional[str] = Field(None, alias="REDIS_URL")

    @field_validator("tavily_api_key")
    @classmethod
    def _strip_key(cls, v: str) -> str:
        return v.strip()

    @property
    def tavily_enabled(self) -> bool:
        return bool(self.tavily_api_key)

    @property
    def recency_marker_list(self) -> list[str]:
        return [m.strip().lower() for m in self.tavily_recency_markers.split(",") if m.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]