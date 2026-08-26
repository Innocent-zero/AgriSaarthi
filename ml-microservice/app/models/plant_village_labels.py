"""
Maps the PlantVillage dataset's raw folder names (as published — the
`Crop___Disease` convention with inconsistent spacing/punctuation) to the
clean, stable class keys used everywhere else in this app (CLASS_LABELS,
TREATMENT_KB, API responses).

Why this exists: PlantVillage folder names are messy and vary slightly
between mirrors ("Corn_(maize)___Common_rust_" with a trailing underscore,
"Pepper,_bell___Bacterial_spot" with a comma, etc). Training code should
never hard-code these strings inline — normalise once, here, so a re-export
of the dataset with slightly different folder punctuation still works.
"""
from __future__ import annotations

import re

# Raw PlantVillage folder name -> normalized class key.
# Covers all 38 standard classes across 14 crops.
PLANT_VILLAGE_CLASS_MAP: dict[str, str] = {
    "Apple___Apple_scab": "apple_scab",
    "Apple___Black_rot": "apple_black_rot",
    "Apple___Cedar_apple_rust": "apple_cedar_rust",
    "Apple___healthy": "apple_healthy",
    "Blueberry___healthy": "blueberry_healthy",
    "Cherry_(including_sour)___Powdery_mildew": "cherry_powdery_mildew",
    "Cherry_(including_sour)___healthy": "cherry_healthy",
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot": "corn_gray_leaf_spot",
    "Corn_(maize)___Common_rust_": "corn_common_rust",
    "Corn_(maize)___Northern_Leaf_Blight": "corn_northern_leaf_blight",
    "Corn_(maize)___healthy": "corn_healthy",
    "Grape___Black_rot": "grape_black_rot",
    "Grape___Esca_(Black_Measles)": "grape_esca",
    "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)": "grape_leaf_blight",
    "Grape___healthy": "grape_healthy",
    "Orange___Haunglongbing_(Citrus_greening)": "orange_citrus_greening",
    "Peach___Bacterial_spot": "peach_bacterial_spot",
    "Peach___healthy": "peach_healthy",
    "Pepper,_bell___Bacterial_spot": "pepper_bacterial_spot",
    "Pepper,_bell___healthy": "pepper_healthy",
    "Potato___Early_blight": "potato_early_blight",
    "Potato___Late_blight": "potato_late_blight",
    "Potato___healthy": "potato_healthy",
    "Raspberry___healthy": "raspberry_healthy",
    "Soybean___healthy": "soybean_healthy",
    "Squash___Powdery_mildew": "squash_powdery_mildew",
    "Strawberry___Leaf_scorch": "strawberry_leaf_scorch",
    "Strawberry___healthy": "strawberry_healthy",
    "Tomato___Bacterial_spot": "tomato_bacterial_spot",
    "Tomato___Early_blight": "tomato_early_blight",
    "Tomato___Late_blight": "tomato_late_blight",
    "Tomato___Leaf_Mold": "tomato_leaf_mold",
    "Tomato___Septoria_leaf_spot": "tomato_septoria_leaf_spot",
    "Tomato___Spider_mites Two-spotted_spider_mite": "tomato_spider_mites",
    "Tomato___Target_Spot": "tomato_target_spot",
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus": "tomato_yellow_leaf_curl_virus",
    "Tomato___Tomato_mosaic_virus": "tomato_mosaic_virus",
    "Tomato___healthy": "tomato_healthy",
}


def _fuzzy_key(name: str) -> str:
    """Collapse punctuation/case/whitespace differences so slightly different
    mirrors of the dataset ('Corn___Common_Rust' vs 'Corn_(maize)___Common_rust_')
    still resolve to the same bucket."""
    s = name.lower()
    s = re.sub(r"\(.*?\)", "", s)          # drop parenthetical botanical names
    s = re.sub(r"[^a-z0-9]+", "_", s)      # punctuation/spaces -> single underscore
    return s.strip("_")


_FUZZY_LOOKUP: dict[str, str] = {_fuzzy_key(raw): norm for raw, norm in PLANT_VILLAGE_CLASS_MAP.items()}

# All normalized class keys, in a stable order (used as CLASS_LABELS).
ALL_PLANT_VILLAGE_CLASSES: list[str] = sorted(set(PLANT_VILLAGE_CLASS_MAP.values()))


def normalize_folder_name(raw_folder_name: str) -> str | None:
    """Best-effort mapping of any PlantVillage-style folder name to a
    normalized class key. Returns None if nothing matches, so the caller can
    decide to skip unknown folders rather than silently mislabel them."""
    if raw_folder_name in PLANT_VILLAGE_CLASS_MAP:
        return PLANT_VILLAGE_CLASS_MAP[raw_folder_name]
    return _FUZZY_LOOKUP.get(_fuzzy_key(raw_folder_name))