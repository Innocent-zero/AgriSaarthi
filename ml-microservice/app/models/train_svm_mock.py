"""
Trains and exports the leaf-disease SVM.

Two modes:
  1. Synthetic (default) — procedurally renders leaf images with physically
     plausible lesion morphologies (rust pustules, concentric blight rings,
     mildew films, haloed bacterial spots, uniform chlorosis) and trains on the
     features actually extracted from those rendered pixels. This produces a
     real, measurable model rather than a hand-written lookup table.
  2. Real dataset — point --data-dir at a PlantVillage-style folder tree
     (one subfolder per class) to retrain on field photographs.

Usage:
    python -m app.models.train_svm_mock --samples 260
    python -m app.models.train_svm_mock --data-dir /data/plantvillage
"""
from __future__ import annotations

import argparse
import glob
import os
import time
from typing import Callable, Dict, List, Tuple

import cv2
import joblib
import numpy as np
from joblib import Parallel, delayed
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from app.services.disease_classifier import CLASS_LABELS, extract_features
from app.models.plant_village_labels import normalize_folder_name

RNG = np.random.default_rng(20260824)
CANVAS = (256, 256)
MODEL_VERSION = "1.0.0"


# ═════════════════ Procedural leaf synthesis ═════════════════
def _blank_leaf(base_hue: int, base_sat: int, base_val: int) -> np.ndarray:
    """Elliptical leaf blade with midrib, veins and natural colour noise."""
    h, w = CANVAS
    canvas = np.zeros((h, w, 3), dtype=np.uint8)
    canvas[:] = (28, 26, 24)  # dark soil backdrop

    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.ellipse(mask, (w // 2, h // 2), (int(w * 0.34), int(h * 0.44)),
                float(RNG.integers(-14, 14)), 0, 360, 255, -1)

    hsv = np.zeros((h, w, 3), dtype=np.uint8)
    hsv[:, :, 0] = base_hue
    hsv[:, :, 1] = base_sat
    hsv[:, :, 2] = base_val

    noise = RNG.normal(0, 9, (h, w)).astype(np.int16)
    hsv[:, :, 2] = np.clip(hsv[:, :, 2].astype(np.int16) + noise, 30, 255).astype(np.uint8)
    grad = np.linspace(-18, 18, w).astype(np.int16)[None, :]
    hsv[:, :, 2] = np.clip(hsv[:, :, 2].astype(np.int16) + grad, 30, 255).astype(np.uint8)

    leaf = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    canvas[mask > 0] = leaf[mask > 0]

    # Midrib + lateral veins add the texture signal Haralick keys on.
    cv2.line(canvas, (w // 2, int(h * 0.08)), (w // 2, int(h * 0.92)),
             (int(base_val * 0.55), int(base_val * 0.72), int(base_val * 0.5)), 3)
    for y in range(int(h * 0.16), int(h * 0.88), 18):
        off = int(RNG.integers(20, 60))
        cv2.line(canvas, (w // 2, y), (w // 2 - off, y - 14), (60, 96, 62), 1)
        cv2.line(canvas, (w // 2, y), (w // 2 + off, y - 14), (60, 96, 62), 1)

    return cv2.GaussianBlur(canvas, (3, 3), 0), mask


def _random_point(mask: np.ndarray) -> Tuple[int, int]:
    ys, xs = np.nonzero(mask)
    i = int(RNG.integers(0, len(xs)))
    return int(xs[i]), int(ys[i])


def synth_healthy() -> np.ndarray:
    img, _ = _blank_leaf(int(RNG.integers(48, 62)), int(RNG.integers(150, 205)), int(RNG.integers(110, 165)))
    return img


def synth_leaf_rust() -> np.ndarray:
    img, mask = _blank_leaf(int(RNG.integers(46, 58)), 175, 130)
    for _ in range(int(RNG.integers(45, 95))):
        x, y = _random_point(mask)
        r = int(RNG.integers(2, 5))
        cv2.circle(img, (x, y), r, (int(RNG.integers(20, 45)), int(RNG.integers(85, 125)), int(RNG.integers(180, 225))), -1)
        cv2.circle(img, (x, y), r + 1, (30, 110, 175), 1)  # chlorotic ring
    return img


def synth_early_blight() -> np.ndarray:
    img, mask = _blank_leaf(int(RNG.integers(44, 56)), 165, 125)
    for _ in range(int(RNG.integers(4, 9))):
        x, y = _random_point(mask)
        outer = int(RNG.integers(14, 30))
        cv2.circle(img, (x, y), outer, (28, 62, 96), -1)          # yellow halo
        for ring in range(outer - 4, 2, -5):                       # concentric rings
            shade = int(RNG.integers(28, 58))
            cv2.circle(img, (x, y), ring, (shade, shade + 22, shade + 40), 2)
        cv2.circle(img, (x, y), max(3, outer // 4), (18, 28, 44), -1)
    return img


def synth_powdery_mildew() -> np.ndarray:
    img, mask = _blank_leaf(int(RNG.integers(48, 60)), 160, 135)
    overlay = img.copy()
    for _ in range(int(RNG.integers(14, 30))):
        x, y = _random_point(mask)
        axes = (int(RNG.integers(10, 34)), int(RNG.integers(8, 26)))
        cv2.ellipse(overlay, (x, y), axes, float(RNG.integers(0, 180)), 0, 360, (238, 240, 238), -1)
    overlay = cv2.GaussianBlur(overlay, (11, 11), 0)
    return cv2.addWeighted(overlay, 0.55, img, 0.45, 0)


def synth_bacterial_spot() -> np.ndarray:
    img, mask = _blank_leaf(int(RNG.integers(46, 58)), 170, 128)
    for _ in range(int(RNG.integers(25, 55))):
        x, y = _random_point(mask)
        r = int(RNG.integers(3, 8))
        cv2.circle(img, (x, y), r + 3, (40, 178, 205), -1)   # bright yellow halo
        cv2.circle(img, (x, y), r, (34, 40, 46), -1)         # water-soaked centre
    return img


def synth_nitrogen_deficiency() -> np.ndarray:
    # Uniform chlorosis: hue shifts toward yellow, saturation drops, no lesions.
    img, _ = _blank_leaf(int(RNG.integers(26, 36)), int(RNG.integers(95, 145)), int(RNG.integers(150, 200)))
    h, w = CANVAS
    grad = np.tile(np.linspace(1.18, 0.86, h).reshape(h, 1), (1, w))  # older leaf yellower
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 0] = np.clip(hsv[:, :, 0] / grad, 15, 90)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


def synth_generic_lesion() -> np.ndarray:
    """Fallback synthesizer for classes with no hand-tuned lesion model
    (viral mottling, trunk rots, mite stippling, etc). Renders irregular
    blotchy discoloration — not a claim about what that disease actually
    looks like, just enough signal so the *synthetic-only* startup fallback
    trains without crashing. Never used once a real dataset is trained."""
    img, mask = _blank_leaf(int(RNG.integers(40, 60)), int(RNG.integers(120, 175)), int(RNG.integers(110, 170)))
    overlay = img.copy()
    for _ in range(int(RNG.integers(8, 20))):
        x, y = _random_point(mask)
        axes = (int(RNG.integers(6, 26)), int(RNG.integers(6, 22)))
        shade = (int(RNG.integers(20, 70)), int(RNG.integers(60, 120)), int(RNG.integers(70, 150)))
        cv2.ellipse(overlay, (x, y), axes, float(RNG.integers(0, 180)), 0, 360, shade, -1)
    overlay = cv2.GaussianBlur(overlay, (7, 7), 0)
    return cv2.addWeighted(overlay, 0.5, img, 0.5, 0)


# Hand-tuned synthesizers for the original 6 generic categories.
SYNTHESISERS = {
    "healthy": synth_healthy,
    "leaf_rust": synth_leaf_rust,
    "early_blight": synth_early_blight,
    "powdery_mildew": synth_powdery_mildew,
    "bacterial_spot": synth_bacterial_spot,
    "nitrogen_deficiency": synth_nitrogen_deficiency,
}


def _synthesizer_for(label: str) -> "Callable[[], np.ndarray]":
    """Dispatches any of the 38 PlantVillage class keys to the closest
    hand-tuned synthesizer by keyword, falling back to the generic one.
    This only matters for the zero-config startup fallback in
    disease_classifier.LeafDiseaseClassifier._load() — real accuracy always
    comes from training on an actual dataset via --data-dir."""
    if label in SYNTHESISERS:
        return SYNTHESISERS[label]
    if label.endswith("_healthy"):
        return synth_healthy
    if "rust" in label:
        return synth_leaf_rust
    if "blight" in label or "spot" in label and "bacterial" not in label:
        return synth_early_blight
    if "mildew" in label:
        return synth_powdery_mildew
    if "bacterial" in label:
        return synth_bacterial_spot
    return synth_generic_lesion


def _augment(img: np.ndarray) -> np.ndarray:
    if RNG.random() < 0.5:
        img = cv2.flip(img, int(RNG.integers(-1, 2)))
    angle = float(RNG.uniform(-18, 18))
    m = cv2.getRotationMatrix2D((CANVAS[1] / 2, CANVAS[0] / 2), angle, 1.0)
    img = cv2.warpAffine(img, m, CANVAS, borderMode=cv2.BORDER_REPLICATE)
    if RNG.random() < 0.6:  # simulate cheap phone camera exposure variance
        img = cv2.convertScaleAbs(img, alpha=float(RNG.uniform(0.82, 1.20)),
                                  beta=float(RNG.uniform(-18, 18)))
    return img


# ═════════════════ Dataset assembly ═════════════════
def build_synthetic_dataset(n_per_class: int) -> Tuple[np.ndarray, np.ndarray]:
    X: List[np.ndarray] = []
    y: List[str] = []
    for label in CLASS_LABELS:
        maker = _synthesizer_for(label)
        for _ in range(n_per_class):
            feats, _ = extract_features(_augment(maker()))
            X.append(feats)
            y.append(label)
    return np.vstack(X), np.array(y)


def _extract_one(path: str) -> np.ndarray | None:
    """Runs in a worker process — must be a top-level function so joblib can
    pickle it. Returns None (rather than raising) for unreadable files so one
    corrupt image doesn't kill the whole run."""
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        return None
    feats, _ = extract_features(img)
    return feats


def build_real_dataset(data_dir: str, cap_per_class: int, n_jobs: int = -1) -> Tuple[np.ndarray, np.ndarray]:
    """Reads images and extracts features in parallel across CPU cores
    (n_jobs=-1 uses all of them). Feature extraction — resize, denoise,
    HSV histogram, Hu moments, GLCM texture — is pure CPU work with no
    shared state between images, so this parallelizes cleanly and gives a
    roughly linear speedup with core count."""
    X: List[np.ndarray] = []
    y: List[str] = []
    skipped_folders: List[str] = []

    class_folders: List[Tuple[str, str]] = []  # (normalized_label, folder_path)
    for raw_folder_name in sorted(os.listdir(data_dir)):
        folder = os.path.join(data_dir, raw_folder_name)
        if not os.path.isdir(folder):
            continue
        label = normalize_folder_name(raw_folder_name) or (
            raw_folder_name if raw_folder_name in CLASS_LABELS else None
        )
        if label is None:
            skipped_folders.append(raw_folder_name)
            continue
        class_folders.append((label, folder))

    if skipped_folders:
        print(f"⚠ Skipped {len(skipped_folders)} unrecognized folder(s) (no matching class): {skipped_folders}")

    total_classes = len(class_folders)
    for i, (label, folder) in enumerate(class_folders, start=1):
        files: List[str] = []
        for ext in ("*.jpg", "*.jpeg", "*.png", "*.JPG"):
            files.extend(glob.glob(os.path.join(folder, ext)))
        files = files[:cap_per_class]

        print(f"[{i}/{total_classes}] {label}: processing {len(files)} images...", flush=True)
        started = time.time()

        results = Parallel(n_jobs=n_jobs, backend="loky")(
            delayed(_extract_one)(path) for path in files
        )

        n_ok = 0
        for feats in results:
            if feats is None:
                continue
            X.append(feats)
            y.append(label)
            n_ok += 1

        elapsed = time.time() - started
        print(f"    ✓ {n_ok}/{len(files)} images usable  ({elapsed:.1f}s)", flush=True)

    if not X:
        raise SystemExit(f"No readable images found under {data_dir}")
    return np.vstack(X), np.array(y)


# ═════════════════ Training ═════════════════
def train_and_export(
    output_path: str = "app/models/artifacts/leaf_svm.joblib",
    n_per_class: int = 40,
    data_dir: str | None = None,
    quiet: bool = False,
    n_jobs: int = -1,
) -> Dict[str, object]:
    started = time.time()
    if data_dir:
        X, y = build_real_dataset(data_dir, cap_per_class=n_per_class * 6, n_jobs=n_jobs)
    else:
        X, y = build_synthetic_dataset(n_per_class)

    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.22, stratify=y, random_state=42)

    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("svm", SVC(kernel="rbf", C=12.0, gamma="scale", probability=True,
                    class_weight="balanced", random_state=42)),
    ])
    pipeline.fit(X_tr, y_tr)

    accuracy = float(pipeline.score(X_te, y_te))
    report = classification_report(y_te, pipeline.predict(X_te), zero_division=0)

    if not quiet:
        print(f"\nFeature dimension : {X.shape[1]}")
        print(f"Samples           : {X.shape[0]}")
        print(f"Hold-out accuracy : {accuracy:.4f}")
        print(f"Training time     : {time.time() - started:.1f}s\n")
        print(report)

    bundle: Dict[str, object] = {
        "pipeline": pipeline,
        "classes": list(pipeline.classes_),
        "version": MODEL_VERSION,
        "accuracy": accuracy,
        "feature_dim": int(X.shape[1]),
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "real" if data_dir else "synthetic",
    }

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    joblib.dump(bundle, output_path, compress=3)
    size_kb = os.path.getsize(output_path) / 1024
    if not quiet:
        print(f"✓ Exported {output_path} ({size_kb:.0f} KB)")
    return bundle


def main() -> None:
    ap = argparse.ArgumentParser(description="Train the AgriSaarthi leaf-disease SVM")
    ap.add_argument("--samples", type=int, default=40, help="synthetic samples per class")
    ap.add_argument("--data-dir", type=str, default=None, help="PlantVillage-style directory")
    ap.add_argument("--out", type=str, default=os.getenv("SVM_MODEL_PATH", "app/models/artifacts/leaf_svm.joblib"))
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--jobs", type=int, default=-1,
                    help="CPU cores to use for real-dataset feature extraction (-1 = all cores, default)")
    args = ap.parse_args()
    train_and_export(output_path=args.out, n_per_class=args.samples,
                     data_dir=args.data_dir, quiet=args.quiet, n_jobs=args.jobs)


if __name__ == "__main__":
    # Required on Windows: joblib's "loky" backend spawns worker processes
    # that re-import this module, so all top-level code must sit behind this
    # guard or you'll get infinite process spawning / a multiprocessing crash.
    main()