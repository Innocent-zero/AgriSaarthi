"""
Reorganise a raw, publicly-downloaded leaf dataset (e.g. PlantVillage,
Pandian's 39-class set) into the exact folder taxonomy this project's
classifier expects: healthy / leaf_rust / early_blight / powdery_mildew /
bacterial_spot / nitrogen_deficiency.

WHY THIS EXISTS
----------------
`train_svm_mock.py --data-dir` will happily train on whatever subfolder
names it finds — but disease_classifier.py's TREATMENT_KB only recognises
six exact label strings. Train directly on raw PlantVillage folder names
(e.g. "Tomato___Early_blight") and every prediction silently falls back to
"healthy" advice, because TREATMENT_KB.get(label, ...) never matches.
This script closes that gap by keyword-matching each raw class folder
into one of the six labels this app actually understands.

NITROGEN DEFICIENCY CAVEAT
---------------------------
Public leaf-*disease* datasets (PlantVillage, Pandian, etc.) generally do
NOT include a nutrient-deficiency class — deficiency isn't a pathogen, so
it's out of scope for most disease datasets. If no real images are found
for nitrogen_deficiency, this script falls back to this project's existing
procedural synthesiser for that one class only, and says so clearly in the
summary. Everything else in the output is real photographs.

USAGE
-----
    python -m app.models.prepare_real_dataset --source data/raw/PlantVillage --out data/leaf_disease

Then train on the result:
    python -m app.models.train_svm_mock --data-dir data/leaf_disease --samples 400
"""
from __future__ import annotations

import argparse
import os
import shutil
from collections import defaultdict
from typing import Dict, List

CLASS_LABELS = [
    "healthy",
    "leaf_rust",
    "early_blight",
    "powdery_mildew",
    "bacterial_spot",
    "nitrogen_deficiency",
]

# Substring → target label. Matched case-insensitively against each raw
# folder name. Order matters: more specific patterns are checked first so
# e.g. "healthy" doesn't accidentally swallow a folder that also mentions
# a disease in passing.
PATTERN_MAP: List[tuple[str, str]] = [
    ("rust", "leaf_rust"),
    ("early_blight", "early_blight"),
    ("earlyblight", "early_blight"),
    ("alternaria", "early_blight"),  # Alternaria leaf spot is early-blight-like
    ("powdery", "powdery_mildew"),
    ("mildew", "powdery_mildew"),
    ("bacterial", "bacterial_spot"),
    ("bacteria", "bacterial_spot"),
    ("healthy", "healthy"),
]

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG")


def classify_folder_name(name: str) -> str | None:
    lowered = name.lower()
    for pattern, label in PATTERN_MAP:
        if pattern in lowered:
            return label
    return None


def scan_source(source: str) -> Dict[str, List[str]]:
    """Walks `source` (any depth) for class-named folders and buckets image
    paths by target label. Handles both flat (source/ClassName/*.jpg) and
    nested (source/color/ClassName/*.jpg) dataset layouts."""
    buckets: Dict[str, List[str]] = defaultdict(list)
    unmatched: List[str] = []

    for root, dirs, files in os.walk(source):
        images = [f for f in files if f.endswith(IMAGE_EXTS)]
        if not images:
            continue
        folder_name = os.path.basename(root)
        label = classify_folder_name(folder_name)
        if label is None:
            unmatched.append(f"{folder_name} ({len(images)} images)")
            continue
        for f in images:
            buckets[label].append(os.path.join(root, f))

    if unmatched:
        print(f"⚠ {len(unmatched)} folders didn't match any known pattern and were skipped:")
        for u in unmatched[:15]:
            print(f"    - {u}")
        if len(unmatched) > 15:
            print(f"    ... and {len(unmatched) - 15} more")
        print("  If any of these should count toward a class, add a pattern to PATTERN_MAP.\n")

    return buckets


def synth_fallback_for_missing(label: str, out_dir: str, n: int) -> int:
    """Used for ANY class with no real images at all — reuses this
    project's own procedural generator so training still covers all 6
    classes, rather than silently shipping a model that can never predict
    a class your source dataset happened not to include (e.g. many
    datasets have no rust or powdery-mildew photos, or none for
    nitrogen_deficiency, which isn't a pathogen and rarely appears in
    public disease datasets at all)."""
    from app.models.train_svm_mock import SYNTHESISERS, _augment  # noqa: WPS433 (intentional local import)
    import cv2

    maker = SYNTHESISERS[label]
    os.makedirs(out_dir, exist_ok=True)
    for i in range(n):
        img = _augment(maker())
        cv2.imwrite(os.path.join(out_dir, f"synthetic_{i:04d}.png"), img)
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True, help="root of the downloaded raw dataset")
    ap.add_argument("--out", default="data/leaf_disease", help="output folder, organised by this app's 6 class names")
    ap.add_argument("--cap-per-class", type=int, default=1200, help="max real images to copy per class (keeps training fast)")
    ap.add_argument("--copy", action="store_true", help="copy files instead of the default symlink (use on Windows or across drives)")
    ap.add_argument("--synth-fallback-n", type=int, default=240, help="synthetic samples to generate for nitrogen_deficiency if no real images are found")
    args = ap.parse_args()

    if not os.path.isdir(args.source):
        raise SystemExit(f"Source folder not found: {args.source}")

    print(f"Scanning {args.source} ...")
    buckets = scan_source(args.source)

    os.makedirs(args.out, exist_ok=True)
    summary: Dict[str, int] = {}

    for label in CLASS_LABELS:
        paths = buckets.get(label, [])
        target_dir = os.path.join(args.out, label)
        os.makedirs(target_dir, exist_ok=True)

        if not paths:
            n = synth_fallback_for_missing(label, target_dir, args.synth_fallback_n)
            summary[label] = -n  # negative marks "synthetic, not real"
            continue

        chosen = paths[: args.cap_per_class]
        for src in chosen:
            dst = os.path.join(target_dir, f"{len(os.listdir(target_dir))}_{os.path.basename(src)}")
            try:
                if args.copy:
                    shutil.copy2(src, dst)
                else:
                    os.symlink(os.path.abspath(src), dst)
            except OSError:
                # symlink can fail without admin rights on Windows — fall back to copy
                shutil.copy2(src, dst)
        summary[label] = len(chosen)

    print("\n─── Dataset prepared ───")
    for label in CLASS_LABELS:
        n = summary.get(label, 0)
        if n < 0:
            print(f"  {label:22s}: {-n} images (SYNTHETIC — no real dataset had this class)")
        else:
            print(f"  {label:22s}: {n} images (real photographs)")
    print(f"\nOutput: {os.path.abspath(args.out)}")
    print("Next: python -m app.models.train_svm_mock --data-dir " + args.out)


if __name__ == "__main__":
    main()
