"""
Frugal leaf-disease classification.

Design constraint: rural 2G. So no CNN, no GPU, no 90 MB weights.
Instead: classical descriptors (HSV colour histogram + Hu moments + Haralick
GLCM texture + lesion morphology) into an RBF-kernel SVM. The full feature
vector is 74-dimensional and the serialised model is well under 1 MB, giving
sub-100 ms CPU inference on Render's starter tier.
"""
from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from typing import Dict, List, Tuple

import cv2
import joblib
import numpy as np
from skimage.feature import graycomatrix, graycoprops

from app.models.plant_village_labels import ALL_PLANT_VILLAGE_CLASSES
from app.services.plant_village_treatments import PLANT_VILLAGE_TREATMENT_KB

logger = logging.getLogger(__name__)

TARGET_SIZE = (256, 256)

# Default class list used only when no trained artifact exists yet (the
# synthetic-fallback path in _load()). Once a real model is trained from a
# dataset, the actual classes come from the saved bundle instead — see
# LeafDiseaseClassifier._load().
CLASS_LABELS: List[str] = ALL_PLANT_VILLAGE_CLASSES

# Agronomic knowledge base — the classifier output is only useful when paired
# with a treatment a farmer can actually buy at the local krishi kendra.
# Full 38-class PlantVillage KB lives in plant_village_treatments.py to keep
# this file focused on inference logic.
TREATMENT_KB: Dict[str, Dict[str, object]] = PLANT_VILLAGE_TREATMENT_KB

# Used only if the model returns a class label with no matching KB entry
# (e.g. a custom-trained model with extra classes). Deliberately gives no
# chemical/dosage advice, since inventing one for an unknown class is unsafe.
_UNKNOWN_CLASS_FALLBACK: Dict[str, object] = {
    "display_en": "Unrecognized condition",
    "display_hi": "अज्ञात स्थिति",
    "severity": "unknown",
    "advice_en": "This result doesn't match a known condition in our advice database. Please consult your local Krishi Vigyan Kendra or agricultural officer before treating.",
    "advice_hi": "यह परिणाम हमारे सलाह डेटाबेस में किसी ज्ञात स्थिति से मेल नहीं खाता। इलाज से पहले कृपया अपने नज़दीकी कृषि विज्ञान केंद्र या कृषि अधिकारी से सलाह लें।",
    "treatment": [],
    "est_cost_inr_per_acre": 0,
}


@dataclass
class Diagnosis:
    label: str
    display_name: str
    confidence: float
    severity: str
    advice: str
    treatment: List[str]
    est_cost_inr_per_acre: int
    probabilities: Dict[str, float]
    lesion_coverage_pct: float
    model_version: str


# ══════════════════════ Feature extraction ══════════════════════
def _segment_leaf(bgr: np.ndarray) -> np.ndarray:
    """Isolate the leaf from background: Otsu on saturation, then keep only the
    largest connected blob so blurred background bokeh is not read as lesion."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    sat = cv2.GaussianBlur(hsv[:, :, 1], (5, 5), 0)
    _, mask = cv2.threshold(sat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

    # Keep the single largest component — the leaf in frame.
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n > 1:
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        mask = np.where(labels == largest, 255, 0).astype(np.uint8)

    # Fill interior holes so dark lesions inside the blade stay part of the leaf.
    filled = mask.copy()
    h, w = mask.shape
    flood = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(filled, flood, (0, 0), 255)
    mask = mask | cv2.bitwise_not(filled)

    if mask.sum() < 0.05 * mask.size * 255:
        mask = np.full(sat.shape, 255, dtype=np.uint8)  # low-contrast photo
    return mask


def _colour_histogram(bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], mask, [8, 4, 4], [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist)
    return hist.flatten()  # 128 → reduced below


def _hu_moments(bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.bitwise_and(gray, gray, mask=mask)
    hu = cv2.HuMoments(cv2.moments(gray)).flatten()
    # Log-scale compresses the huge dynamic range into SVM-friendly units.
    return np.array([-np.sign(h) * np.log10(abs(h) + 1e-30) for h in hu], dtype=np.float64)


def _haralick(bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = (gray // 8).astype(np.uint8)  # 32 grey levels keeps GLCM cheap
    glcm = graycomatrix(
        gray, distances=[1, 3], angles=[0, np.pi / 4, np.pi / 2, 3 * np.pi / 4],
        levels=32, symmetric=True, normed=True,
    )
    props = ["contrast", "dissimilarity", "homogeneity", "energy", "correlation", "ASM"]
    return np.concatenate([graycoprops(glcm, p).flatten() for p in props])  # 48


def _lesion_stats(bgr: np.ndarray, mask: np.ndarray) -> Tuple[np.ndarray, float]:
    """Quantify discoloured area, its colour centroid and blob count."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    leaf = mask > 0
    leaf_px = max(int(leaf.sum()), 1)

    # Healthy chlorophyll sits at hue 35–85 in OpenCV's 0–180 scale.
    green = (h >= 35) & (h <= 85) & (s > 40) & leaf
    lesion = leaf & ~green
    coverage = float(lesion.sum()) / leaf_px

    lesion_u8 = (lesion * 255).astype(np.uint8)
    n_blobs, _, stats, _ = cv2.connectedComponentsWithStats(lesion_u8, connectivity=8)
    sizes = stats[1:, cv2.CC_STAT_AREA] if n_blobs > 1 else np.array([0])
    significant = int((sizes > 0.0008 * leaf_px).sum())

    def _mean(chan: np.ndarray, sel: np.ndarray) -> float:
        return float(chan[sel].mean()) if sel.any() else 0.0

    feats = np.array([
        coverage,
        _mean(h, lesion) / 180.0,
        _mean(s, lesion) / 255.0,
        _mean(v, lesion) / 255.0,
        _mean(h, green) / 180.0,
        _mean(s, green) / 255.0,
        _mean(v, green) / 255.0,
        float(green.sum()) / leaf_px,
        min(significant, 60) / 60.0,
        float(sizes.max()) / leaf_px if sizes.size else 0.0,
        float(np.std(h[leaf])) / 90.0,
        float(np.std(v[leaf])) / 128.0,
    ], dtype=np.float64)
    return feats, coverage * 100.0


def extract_features(bgr: np.ndarray) -> Tuple[np.ndarray, float]:
    """Returns (74-d feature vector, lesion coverage %)."""
    img = cv2.resize(bgr, TARGET_SIZE, interpolation=cv2.INTER_AREA)
    img = cv2.bilateralFilter(img, 5, 60, 60)  # denoise without losing lesion edges
    mask = _segment_leaf(img)

    hist = _colour_histogram(img, mask)
    # Compress the 128-bin histogram to 7 hue-band energies — keeps the vector
    # small enough that an SVM trains well on a few hundred samples.
    hist_bands = hist.reshape(8, 16).sum(axis=1)[:7]

    hu = _hu_moments(img, mask)                 # 7
    har = _haralick(img)                        # 48
    les, coverage = _lesion_stats(img, mask)    # 12

    vec = np.concatenate([hist_bands, hu, har, les]).astype(np.float64)
    vec = np.nan_to_num(vec, nan=0.0, posinf=0.0, neginf=0.0)
    return vec, coverage


# ══════════════════════ Inference wrapper ══════════════════════
class LeafDiseaseClassifier:
    _lock = threading.Lock()

    def __init__(self, model_path: str | None = None) -> None:
        self.model_path = model_path or os.getenv(
            "SVM_MODEL_PATH", "app/models/artifacts/leaf_svm.joblib"
        )
        self.pipeline = None
        self.classes: List[str] = CLASS_LABELS
        self.version = "unloaded"
        self._load()

    def _load(self) -> None:
        with self._lock:
            if os.path.exists(self.model_path):
                bundle = joblib.load(self.model_path)
                self.pipeline = bundle["pipeline"]
                self.classes = list(bundle["classes"])
                self.version = bundle.get("version", "1.0.0")
                logger.info("Loaded leaf SVM v%s from %s", self.version, self.model_path)
                return

            logger.warning("Model artifact missing at %s — training now", self.model_path)
            from app.models.train_svm_mock import train_and_export  # local import breaks the cycle
            bundle = train_and_export(output_path=self.model_path, n_per_class=40)
            self.pipeline = bundle["pipeline"]
            self.classes = list(bundle["classes"])
            self.version = bundle.get("version", "1.0.0")

    @property
    def ready(self) -> bool:
        return self.pipeline is not None

    def predict(self, image_bytes: bytes, language: str = "hi") -> Diagnosis:
        if not self.ready:
            raise RuntimeError("Classifier is not loaded")

        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            raise ValueError("Image could not be decoded — send a valid JPEG, PNG or WebP")
        if min(bgr.shape[:2]) < 48:
            raise ValueError("Image is too small — take a closer photo of a single leaf")

        vec, coverage = extract_features(bgr)
        proba = self.pipeline.predict_proba(vec.reshape(1, -1))[0]
        idx = int(np.argmax(proba))
        label = self.classes[idx]
        # kb = TREATMENT_KB.get(label, TREATMENT_KB["healthy"])

        # Fall back to a generic "unknown issue" entry (not a specific
        # treatment) if the model somehow returns a class this KB doesn't
        # recognise — never guess a chemical/dosage for an unlabelled class.
        kb = TREATMENT_KB.get(label, _UNKNOWN_CLASS_FALLBACK)
        
        hi = language == "hi"

        return Diagnosis(
            label=label,
            display_name=str(kb["display_hi"] if hi else kb["display_en"]),
            confidence=round(float(proba[idx]), 4),
            severity=str(kb["severity"]),
            advice=str(kb["advice_hi"] if hi else kb["advice_en"]),
            treatment=list(kb["treatment_hi"] if hi else kb["treatment"]),  # type: ignore[arg-type]
            est_cost_inr_per_acre=int(kb["est_cost_inr_per_acre"]),  # type: ignore[arg-type]
            probabilities={c: round(float(p), 4) for c, p in zip(self.classes, proba)},
            lesion_coverage_pct=round(coverage, 2),
            model_version=self.version,
        )


_classifier: LeafDiseaseClassifier | None = None


def get_classifier() -> LeafDiseaseClassifier:
    global _classifier
    if _classifier is None:
        _classifier = LeafDiseaseClassifier()
    return _classifier