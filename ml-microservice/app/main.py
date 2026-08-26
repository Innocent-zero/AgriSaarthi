from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
load_dotenv()   # must run before importing app.services.* singletons

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator

from app.services.disease_classifier import get_classifier
from app.services.pmfby_pdf_generator import generate_pmfby_report
from app.services.tavily_search import tavily_service
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(),
                    format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("agrisaarthi.ml")

MAX_IMAGE_BYTES = 6 * 1024 * 1024
ALLOWED_MIME = {"image/jpeg", "image/jpg", "image/png", "image/webp"}

app = FastAPI(
    title="AgriSaarthi ML & Spatial Microservice",
    description="Frugal leaf-disease SVM, live scheme RAG, and PMFBY claim passbook generation",
    version="1.0.0",
    docs_url="/docs",
)

origins = [o.strip() for o in os.getenv("ML_ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ═══════════════════════ Schemas ═══════════════════════
class SchemeQuery(BaseModel):
    query: str = Field(..., min_length=2, max_length=300)
    state: Optional[str] = Field(None, max_length=60)
    language: str = Field("hi", pattern="^(hi|en)$")
    max_results: int = Field(6, ge=1, le=10)


class BoundaryPoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class FarmerBlock(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    guardian: Optional[str] = None
    phone: Optional[str] = None
    aadhaar_masked: Optional[str] = None
    bank_masked: Optional[str] = None
    policy_no: Optional[str] = None
    village: Optional[str] = None
    block: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None


class FarmBlock(BaseModel):
    survey_no: Optional[str] = None
    crop: str = Field(..., min_length=1, max_length=60)
    variety: Optional[str] = None
    season: Optional[str] = None
    area_ha: float = Field(..., gt=0, le=10000)
    sowing_date: Optional[str] = None
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    irrigation: Optional[str] = None
    boundary: List[BoundaryPoint] = Field(default_factory=list)


class NdviBlock(BaseModel):
    pre_event_date: Optional[str] = None
    pre_event_mean: float = Field(0.0, ge=-1.0, le=1.0)
    post_event_date: Optional[str] = None
    post_event_mean: float = Field(0.0, ge=-1.0, le=1.0)


class WeatherAnomaly(BaseModel):
    date: str
    parameter: str
    observed: str
    normal: str
    deviation: str


class PmfbyRequest(BaseModel):
    farmer: FarmerBlock
    farm: FarmBlock
    ndvi: NdviBlock
    weather_anomalies: List[WeatherAnomaly] = Field(default_factory=list)
    cause: str = Field(..., min_length=2, max_length=200)
    event_date: str
    description: Optional[str] = None
    affected_area_ha: Optional[float] = Field(None, ge=0)
    estimated_loss_pct: Optional[float] = Field(None, ge=0, le=100)
    sum_insured_inr: Optional[float] = Field(None, ge=0)
    indicative_claim_inr: Optional[float] = Field(None, ge=0)
    reported_within_72h: bool = True

    @field_validator("cause")
    @classmethod
    def _clean_cause(cls, v: str) -> str:
        return v.strip()


# ═══════════════════════ Routes ═══════════════════════
@app.get("/health")
async def health() -> Dict[str, Any]:
    clf = get_classifier()
    return {
        "status": "ok",
        "service": "agrisaarthi-ml",
        "version": "1.0.0",
        "classifier": {"ready": clf.ready, "version": clf.version, "classes": clf.classes},
        "tavily": "configured" if tavily_service.enabled else "not configured",
    }


@app.post("/api/v1/diagnose")
async def diagnose(
    image: UploadFile = File(...),
    crop: str = Form("unknown"),
    language: str = Form("hi"),
) -> Dict[str, Any]:
    if image.content_type not in ALLOWED_MIME:
        raise HTTPException(415, f"Unsupported media type {image.content_type}. Use JPEG, PNG or WebP.")

    data = await image.read()
    if not data:
        raise HTTPException(400, "Uploaded image is empty")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds the 6 MB limit — retake at a lower resolution")

    try:
        result = get_classifier().predict(data, language=language if language in ("hi", "en") else "hi")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Diagnosis failed")
        raise HTTPException(500, "Diagnosis failed — please retake the photo in daylight") from exc

    low_confidence = result.confidence < 0.55
    return {
        "success": True,
        "crop": crop,
        "diagnosis": {
            "label": result.label,
            "display_name": result.display_name,
            "confidence": result.confidence,
            "severity": result.severity,
            "advice": result.advice,
            "treatment": result.treatment,
            "est_cost_inr_per_acre": result.est_cost_inr_per_acre,
            "lesion_coverage_pct": result.lesion_coverage_pct,
            "probabilities": result.probabilities,
        },
        "low_confidence": low_confidence,
        "note": (
            "कम भरोसा — साफ़ रोशनी में एक ही पत्ती की नज़दीकी फोटो दोबारा लें।"
            if low_confidence and language == "hi"
            else "Low confidence — retake a close photo of a single leaf in good daylight."
            if low_confidence
            else None
        ),
        "model_version": result.model_version,
    }


@app.post("/api/v1/schemes")
async def schemes(payload: SchemeQuery) -> Dict[str, Any]:
    answer = await tavily_service.search(
        query=payload.query,
        state=payload.state,
        language=payload.language,
        max_results=payload.max_results,
    )
    return {"success": answer.source != "error", **answer.to_dict()}


@app.post("/api/v1/pmfby/report")
async def pmfby_report(payload: PmfbyRequest) -> Response:
    try:
        pdf = generate_pmfby_report(payload.model_dump())
    except Exception as exc:  # noqa: BLE001
        logger.exception("PDF generation failed")
        raise HTTPException(500, "Could not generate the claim passbook") from exc

    filename = f"PMFBY_{payload.farmer.name.replace(' ', '_')}_{payload.event_date}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf)),
        },
    )


@app.exception_handler(HTTPException)
async def http_error(_, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"success": False, "error": exc.detail})


@app.on_event("startup")
async def warmup() -> None:
    clf = get_classifier()
    logger.info("Classifier warm — v%s, %d classes", clf.version, len(clf.classes))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("ML_SERVICE_PORT", 8000)), reload=True)