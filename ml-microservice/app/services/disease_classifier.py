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


class NoLeafDetected(ValueError):
    """Raised when _leaf_presence_score() decides the image has no leaf in
    frame. Subclasses ValueError so it's caught by the same 400 handler as
    other input-validation failures in main.py, without changing that
    handler's behaviour."""

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
TREATMENT_KB: Dict[str, Dict[str, object]] = {
    "healthy": {
        "display_en": "Healthy leaf", "display_hi": "स्वस्थ पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [], "treatment_hi": [], "est_cost_inr_per_acre": 0,
    },
    "_unknown": {
        "display_en": "Disease detected — identification uncertain",
        "display_hi": "बीमारी मिली — पहचान अनिश्चित",
        "severity": "medium",
        "advice_en": "The leaf is not healthy, but the exact disease could not be identified with confidence. Take the leaf to your nearest Krishi Vigyan Kendra before buying any chemical.",
        "advice_hi": "पत्ती स्वस्थ नहीं है, पर बीमारी की पक्की पहचान नहीं हो सकी। कोई दवा खरीदने से पहले पत्ती नज़दीकी कृषि विज्ञान केंद्र ले जाएँ।",
        "treatment": [
            "Remove and destroy visibly affected leaves",
            "Avoid overhead irrigation until identified",
            "Do not spray a broad-spectrum chemical blindly",
        ],
        "treatment_hi": [
            "साफ़ दिख रही प्रभावित पत्तियाँ तोड़कर नष्ट करें",
            "पहचान होने तक ऊपर से पानी देना बंद रखें",
            "बिना पहचान के कोई भी दवा अंदाज़े से न छिड़कें",
        ],
        "est_cost_inr_per_acre": 0,
    },
    "early_blight": {
        "display_en": "Early blight",
        "display_hi": "अगेती झुलसा",
        "severity": "high",
        "advice_en": "Concentric brown lesions indicate early blight. Remove infected lower leaves and spray a protectant fungicide.",
        "advice_hi": "गोल भूरे धब्बे अगेती झुलसा दर्शाते हैं। नीचे की संक्रमित पत्तियाँ हटाएँ और फफूंदनाशक छिड़कें।",
        "treatment": [
            "Mancozeb 75% WP @ 2.5 g/litre",
            "Alternate with Chlorothalonil to prevent resistance",
            "Improve row spacing for airflow",
        ],
        "treatment_hi": [
            "मैंकोज़ेब 75% WP @ 2.5 ग्राम/लीटर",
            "प्रतिरोध रोकने के लिए क्लोरोथैलोनिल से बदल-बदलकर छिड़कें",
            "हवा के लिए कतारों की दूरी बढ़ाएँ",
        ],
        "est_cost_inr_per_acre": 380,
    },
    "powdery_mildew": {
        "display_en": "Powdery mildew",
        "display_hi": "चूर्णिल आसिता",
        "severity": "medium",
        "advice_en": "White powdery growth on the upper surface. It spreads fastest in dry days with humid nights.",
        "advice_hi": "पत्ती के ऊपर सफ़ेद पाउडर जैसा फैलाव। सूखे दिन और नम रात में तेज़ी से फैलता है।",
        "treatment": [
            "Wettable sulphur 80% WP @ 2 g/litre",
            "Or Hexaconazole 5% EC @ 1 ml/litre",
            "Spray in the evening to avoid leaf scorch",
        ],
        "treatment_hi": [
            "घुलनशील गंधक 80% WP @ 2 ग्राम/लीटर",
            "या हेक्साकोनाज़ोल 5% EC @ 1 मिली/लीटर",
            "पत्ती झुलसने से बचाने के लिए शाम को छिड़कें",
        ],
        "est_cost_inr_per_acre": 260,
    },
    "bacterial_spot": {
        "display_en": "Bacterial leaf spot",
        "display_hi": "जीवाणु पत्ती धब्बा",
        "severity": "high",
        "advice_en": "Water-soaked dark spots with yellow halos. Fungicides will not work — you need a copper-based bactericide.",
        "advice_hi": "पीले घेरे वाले गीले काले धब्बे। फफूंदनाशक बेअसर है — कॉपर आधारित दवा चाहिए।",
        "treatment": [
            "Copper oxychloride 50% WP @ 3 g/litre",
            "Add Streptomycin sulphate @ 0.1 g/litre where permitted",
            "Stop overhead irrigation immediately",
        ],
        "treatment_hi": [
            "कॉपर ऑक्सीक्लोराइड 50% WP @ 3 ग्राम/लीटर",
            "जहाँ अनुमति हो, स्ट्रेप्टोमाइसिन सल्फेट @ 0.1 ग्राम/लीटर मिलाएँ",
            "ऊपर से पानी देना तुरंत बंद करें",
        ],
        "est_cost_inr_per_acre": 450,
    },
    "late_blight": {
        "display_en": "Late blight", "display_hi": "पछेती झुलसा",
        "severity": "high",
        "advice_en": "Late blight spreads explosively in cool humid weather and can destroy a potato or tomato crop within days. Spray within 24 hours.",
        "advice_hi": "पछेती झुलसा ठंडे-नम मौसम में बहुत तेज़ी से फैलता है और आलू-टमाटर की फसल कुछ ही दिनों में बर्बाद कर सकता है। 24 घंटे में छिड़काव करें।",
        "treatment": [
            "Metalaxyl 8% + Mancozeb 64% WP @ 2.5 g/litre",
            "Repeat after 7–10 days if humid weather continues",
            "Destroy infected plant debris, do not compost it",
        ],
        "treatment_hi": [
            "मेटालैक्सिल 8% + मैंकोज़ेब 64% WP @ 2.5 ग्राम/लीटर",
            "नम मौसम रहे तो 7–10 दिन बाद दोबारा छिड़कें",
            "संक्रमित अवशेष नष्ट करें, खाद में न डालें",
        ],
        "est_cost_inr_per_acre": 520,
    },
    "septoria_leaf_spot": {
        "display_en": "Septoria leaf spot", "display_hi": "सेप्टोरिया पत्ती धब्बा",
        "severity": "high",
        "advice_en": "Small dark spots with pale centres, starting on lower leaves and moving upward. Remove the lowest affected leaves and spray.",
        "advice_hi": "हल्के बीच वाले छोटे काले धब्बे, नीचे की पत्तियों से शुरू होकर ऊपर बढ़ते हैं। सबसे नीचे की प्रभावित पत्तियाँ हटाएँ और छिड़काव करें।",
        "treatment": [
            "Chlorothalonil 75% WP @ 2 g/litre",
            "Remove and destroy lower infected leaves",
            "Mulch to stop soil splash onto leaves",
        ],
        "treatment_hi": [
            "क्लोरोथैलोनिल 75% WP @ 2 ग्राम/लीटर",
            "नीचे की संक्रमित पत्तियाँ तोड़कर नष्ट करें",
            "मिट्टी के छींटे रोकने के लिए पलवार बिछाएँ",
        ],
        "est_cost_inr_per_acre": 400,
    },
    "leaf_mold": {
        "display_en": "Leaf mould", "display_hi": "पत्ती फफूंद",
        "severity": "medium",
        "advice_en": "Yellow patches above with olive-grey mould underneath. It thrives in still, humid air, so ventilation matters as much as spraying.",
        "advice_hi": "ऊपर पीले धब्बे और नीचे जैतूनी-भूरी फफूंद। रुकी हुई नम हवा में बढ़ता है, इसलिए हवा का बहाव दवा जितना ही ज़रूरी है।",
        "treatment": [
            "Copper oxychloride 50% WP @ 3 g/litre",
            "Increase spacing and prune lower leaves for airflow",
            "Water at the base, never over the canopy",
        ],
        "treatment_hi": [
            "कॉपर ऑक्सीक्लोराइड 50% WP @ 3 ग्राम/लीटर",
            "दूरी बढ़ाएँ और नीचे की पत्तियाँ छाँटें ताकि हवा चले",
            "जड़ में पानी दें, ऊपर से कभी नहीं",
        ],
        "est_cost_inr_per_acre": 350,
    },
    "target_spot": {
        "display_en": "Target spot", "display_hi": "लक्ष्य धब्बा",
        "severity": "medium",
        "advice_en": "Brown lesions with concentric rings resembling a target. Manage like early blight with a protectant fungicide.",
        "advice_hi": "गोल छल्लों वाले भूरे धब्बे, निशाने जैसे दिखते हैं। अगेती झुलसा की तरह सुरक्षात्मक फफूंदनाशक से नियंत्रण करें।",
        "treatment": [
            "Mancozeb 75% WP @ 2.5 g/litre",
            "Remove crop debris after harvest",
            "Rotate with a non-solanaceous crop next season",
        ],
        "treatment_hi": [
            "मैंकोज़ेब 75% WP @ 2.5 ग्राम/लीटर",
            "कटाई के बाद फसल अवशेष हटाएँ",
            "अगले मौसम में सोलेनेसी के अलावा दूसरी फसल लें",
        ],
        "est_cost_inr_per_acre": 380,
    },
    "spider_mites": {
        "display_en": "Two-spotted spider mites", "display_hi": "मकड़ी कीट (माइट)",
        "severity": "medium",
        "advice_en": "These are mites, not a fungus — fungicide will not work. Look for fine webbing and stippled leaves, worst in hot dry spells.",
        "advice_hi": "यह फफूंद नहीं, मकड़ी कीट है — फफूंदनाशक बेअसर रहेगा। बारीक जाला और चित्तीदार पत्तियाँ देखें, गर्म-सूखे मौसम में सबसे ज़्यादा।",
        "treatment": [
            "Spiromesifen 22.9% SC @ 1 ml/litre, or wettable sulphur @ 3 g/litre",
            "Spray the underside of leaves, where mites live",
            "Raise humidity with light irrigation to slow them",
        ],
        "treatment_hi": [
            "स्पाइरोमेसिफेन 22.9% SC @ 1 मिली/लीटर, या घुलनशील गंधक @ 3 ग्राम/लीटर",
            "पत्ती के नीचे की तरफ़ छिड़कें, कीट वहीं रहते हैं",
            "हल्की सिंचाई से नमी बढ़ाएँ ताकि प्रकोप धीमा हो",
        ],
        "est_cost_inr_per_acre": 460,
    },
    "mosaic_virus": {
        "display_en": "Mosaic virus", "display_hi": "मोज़ेक विषाणु",
        "severity": "high",
        "advice_en": "This is a virus. No spray can cure it — money spent on fungicide is wasted. Remove infected plants to protect the rest of the field.",
        "advice_hi": "यह विषाणु रोग है। कोई भी छिड़काव इसे ठीक नहीं कर सकता — फफूंदनाशक पर पैसा बर्बाद होगा। बाकी खेत बचाने के लिए संक्रमित पौधे उखाड़ दें।",
        "treatment": [
            "Uproot and burn infected plants immediately",
            "Wash hands and tools before touching healthy plants",
            "Use certified virus-free seed next season",
        ],
        "treatment_hi": [
            "संक्रमित पौधे तुरंत उखाड़कर जला दें",
            "स्वस्थ पौधों को छूने से पहले हाथ और औज़ार धोएँ",
            "अगले मौसम में प्रमाणित विषाणु-मुक्त बीज लें",
        ],
        "est_cost_inr_per_acre": 0,
    },
    "yellow_leaf_curl_virus": {
        "display_en": "Yellow leaf curl virus", "display_hi": "पीला पत्ती मरोड़ विषाणु",
        "severity": "high",
        "advice_en": "A virus spread by whitefly. The plant cannot be cured, so control the whitefly to stop it reaching healthy plants.",
        "advice_hi": "सफ़ेद मक्खी से फैलने वाला विषाणु। पौधा ठीक नहीं हो सकता, इसलिए सफ़ेद मक्खी रोकें ताकि यह स्वस्थ पौधों तक न पहुँचे।",
        "treatment": [
            "Remove infected plants from the field",
            "Diafenthiuron 50% WP @ 1 g/litre against whitefly",
            "Install yellow sticky traps at 10 per acre",
        ],
        "treatment_hi": [
            "संक्रमित पौधे खेत से हटा दें",
            "सफ़ेद मक्खी के लिए डायफेंथियुरॉन 50% WP @ 1 ग्राम/लीटर",
            "प्रति एकड़ 10 पीले चिपचिपे जाल लगाएँ",
        ],
        "est_cost_inr_per_acre": 540,
    },
    "northern_leaf_blight": {
        "display_en": "Northern leaf blight", "display_hi": "उत्तरी पत्ती झुलसा",
        "severity": "high",
        "advice_en": "Long grey-green cigar-shaped lesions on maize leaves. Spray before it reaches the leaves above the cob.",
        "advice_hi": "मक्का की पत्तियों पर लंबे भूरे-हरे सिगार जैसे धब्बे। भुट्टे के ऊपर की पत्तियों तक पहुँचने से पहले छिड़काव करें।",
        "treatment": [
            "Mancozeb 75% WP @ 2.5 g/litre at first appearance",
            "Or Propiconazole 25% EC @ 1 ml/litre",
            "Rotate crops and plough in residue",
        ],
        "treatment_hi": [
            "पहला लक्षण दिखते ही मैंकोज़ेब 75% WP @ 2.5 ग्राम/लीटर",
            "या प्रोपिकोनाज़ोल 25% EC @ 1 मिली/लीटर",
            "फसल चक्र अपनाएँ और अवशेष जोतकर मिलाएँ",
        ],
        "est_cost_inr_per_acre": 430,
    },
    "gray_leaf_spot": {
        "display_en": "Grey leaf spot", "display_hi": "धूसर पत्ती धब्बा",
        "severity": "high",
        "advice_en": "Rectangular grey lesions running along maize leaf veins. Worst in continuous maize with heavy residue.",
        "advice_hi": "मक्का की पत्ती की शिराओं के साथ आयताकार धूसर धब्बे। लगातार मक्का और अधिक अवशेष वाले खेतों में सबसे ज़्यादा।",
        "treatment": [
            "Azoxystrobin 23% SC @ 1 ml/litre",
            "Plough in residue rather than leaving it on the surface",
            "Avoid maize after maize on the same plot",
        ],
        "treatment_hi": [
            "एज़ोक्सिस्ट्रोबिन 23% SC @ 1 मिली/लीटर",
            "अवशेष सतह पर छोड़ने के बजाय जोतकर मिलाएँ",
            "एक ही खेत में लगातार मक्का न लें",
        ],
        "est_cost_inr_per_acre": 480,
    },
    "common_rust": {
        "display_en": "Common rust", "display_hi": "सामान्य रतुआ",
        "severity": "medium",
        "advice_en": "Reddish-brown pustules on both leaf surfaces. Usually manageable, but spray if it reaches the upper leaves before tasselling.",
        "advice_hi": "पत्ती के दोनों तरफ़ लाल-भूरे फफोले। आमतौर पर नियंत्रित रहता है, पर नर मंजरी आने से पहले ऊपरी पत्तियों तक पहुँचे तो छिड़काव करें।",
        "treatment": [
            "Propiconazole 25% EC @ 1 ml/litre",
            "Prefer rust-tolerant hybrids next season",
        ],
        "treatment_hi": [
            "प्रोपिकोनाज़ोल 25% EC @ 1 मिली/लीटर",
            "अगले मौसम में रतुआ सहनशील संकर किस्म चुनें",
        ],
        "est_cost_inr_per_acre": 400,
    },
    "scab": {
        "display_en": "Apple scab", "display_hi": "सेब का स्कैब",
        "severity": "high",
        "advice_en": "Olive-brown velvety spots on leaves and fruit. Spray from green-tip stage; once fruit is marked the crop loses market value.",
        "advice_hi": "पत्तियों और फल पर जैतूनी-भूरे मखमली धब्बे। हरी कली अवस्था से छिड़काव करें; फल पर निशान पड़ने के बाद बाज़ार भाव गिर जाता है।",
        "treatment": [
            "Dodine 65% WP @ 0.75 g/litre at green tip",
            "Mancozeb 75% WP @ 2.5 g/litre in later sprays",
            "Rake and destroy fallen leaves in winter",
        ],
        "treatment_hi": [
            "हरी कली अवस्था पर डोडीन 65% WP @ 0.75 ग्राम/लीटर",
            "बाद के छिड़कावों में मैंकोज़ेब 75% WP @ 2.5 ग्राम/लीटर",
            "सर्दियों में गिरी पत्तियाँ बटोरकर नष्ट करें",
        ],
        "est_cost_inr_per_acre": 620,
    },
    "black_rot": {
        "display_en": "Black rot", "display_hi": "काला सड़न",
        "severity": "high",
        "advice_en": "Brown leaf lesions and shrivelled dark fruit. Cankered wood carries the fungus over winter, so pruning is part of the cure.",
        "advice_hi": "भूरे पत्ती धब्बे और सिकुड़े काले फल। रोगग्रस्त लकड़ी में फफूंद सर्दी भर बनी रहती है, इसलिए छँटाई इलाज का हिस्सा है।",
        "treatment": [
            "Prune out and burn cankered wood in winter",
            "Mancozeb 75% WP @ 2.5 g/litre from bud break",
            "Remove mummified fruit from the plant and ground",
        ],
        "treatment_hi": [
            "सर्दियों में रोगग्रस्त लकड़ी छाँटकर जला दें",
            "कली फूटने से मैंकोज़ेब 75% WP @ 2.5 ग्राम/लीटर",
            "सूखे-सिकुड़े फल पौधे और ज़मीन दोनों से हटाएँ",
        ],
        "est_cost_inr_per_acre": 580,
    },
    "cedar_rust": {
        "display_en": "Cedar apple rust", "display_hi": "सीडर सेब रतुआ",
        "severity": "medium",
        "advice_en": "Bright orange spots on apple leaves. The fungus needs nearby juniper or cedar to complete its cycle.",
        "advice_hi": "सेब की पत्तियों पर चमकीले नारंगी धब्बे। इस फफूंद को चक्र पूरा करने के लिए पास में जुनिपर या सीडर चाहिए।",
        "treatment": [
            "Myclobutanil 10% WP @ 1 g/litre from pink bud",
            "Remove juniper or cedar within a few hundred metres if possible",
        ],
        "treatment_hi": [
            "गुलाबी कली से मायक्लोबुटानिल 10% WP @ 1 ग्राम/लीटर",
            "हो सके तो कुछ सौ मीटर के भीतर के जुनिपर या सीडर हटाएँ",
        ],
        "est_cost_inr_per_acre": 520,
    },
    "esca": {
        "display_en": "Esca (black measles)", "display_hi": "एस्का (काला खसरा)",
        "severity": "high",
        "advice_en": "A trunk disease of grapevine. No spray cures it — manage by pruning practice and removing dead wood.",
        "advice_hi": "अंगूर की तने की बीमारी। कोई छिड़काव इसे ठीक नहीं करता — छँटाई के तरीके और सूखी लकड़ी हटाकर नियंत्रित करें।",
        "treatment": [
            "Prune in dry weather and seal large cuts",
            "Remove and burn dead wood and severely affected vines",
            "Disinfect pruning tools between vines",
        ],
        "treatment_hi": [
            "सूखे मौसम में छँटाई करें और बड़े कटान सील करें",
            "सूखी लकड़ी और बुरी तरह प्रभावित बेलें हटाकर जलाएँ",
            "हर बेल के बाद छँटाई के औज़ार कीटाणुरहित करें",
        ],
        "est_cost_inr_per_acre": 0,
    },
    "leaf_blight": {
        "display_en": "Leaf blight", "display_hi": "पत्ती झुलसा",
        "severity": "medium",
        "advice_en": "Irregular brown patches spreading across the leaf. Improve airflow and apply a protectant fungicide.",
        "advice_hi": "पत्ती पर फैलते अनियमित भूरे धब्बे। हवा का बहाव बढ़ाएँ और सुरक्षात्मक फफूंदनाशक डालें।",
        "treatment": [
            "Mancozeb 75% WP @ 2.5 g/litre",
            "Remove severely affected leaves",
            "Avoid overhead irrigation",
        ],
        "treatment_hi": [
            "मैंकोज़ेब 75% WP @ 2.5 ग्राम/लीटर",
            "बुरी तरह प्रभावित पत्तियाँ हटाएँ",
            "ऊपर से सिंचाई न करें",
        ],
        "est_cost_inr_per_acre": 380,
    },
    "leaf_scorch": {
        "display_en": "Leaf scorch", "display_hi": "पत्ती झुलसन",
        "severity": "medium",
        "advice_en": "Purple-bordered spots merging into scorched margins on strawberry. Renovate the bed after harvest.",
        "advice_hi": "स्ट्रॉबेरी पर बैंगनी किनारे वाले धब्बे जो मिलकर झुलसे किनारे बनाते हैं। कटाई के बाद क्यारी की सफ़ाई करें।",
        "treatment": [
            "Captan 50% WP @ 2 g/litre",
            "Mow and remove old foliage after harvest",
            "Improve drainage and spacing",
        ],
        "treatment_hi": [
            "कैप्टान 50% WP @ 2 ग्राम/लीटर",
            "कटाई के बाद पुरानी पत्तियाँ काटकर हटाएँ",
            "जल निकासी और दूरी सुधारें",
        ],
        "est_cost_inr_per_acre": 420,
    },
    "citrus_greening": {
        "display_en": "Citrus greening (HLB)", "display_hi": "नींबू हरापन रोग (HLB)",
        "severity": "high",
        "advice_en": "A bacterial disease spread by citrus psyllid. Infected trees cannot be cured and remain a source for the whole orchard.",
        "advice_hi": "सिट्रस सिल्ला से फैलने वाला जीवाणु रोग। संक्रमित पेड़ ठीक नहीं होते और पूरे बाग़ के लिए संक्रमण का स्रोत बने रहते हैं।",
        "treatment": [
            "Remove and destroy confirmed infected trees",
            "Control psyllid with Imidacloprid 17.8% SL @ 0.5 ml/litre",
            "Plant only certified disease-free saplings",
        ],
        "treatment_hi": [
            "पुष्ट संक्रमित पेड़ हटाकर नष्ट करें",
            "इमिडाक्लोप्रिड 17.8% SL @ 0.5 मिली/लीटर से सिल्ला नियंत्रित करें",
            "केवल प्रमाणित रोगमुक्त पौध लगाएँ",
        ],
        "est_cost_inr_per_acre": 600,
    },
    # keep your existing entries, renamed:
    #   leaf_rust → "rust"  (only if your data has a plain 'rust' class)
    #   early_blight, powdery_mildew, bacterial_spot, nitrogen_deficiency
    #   stay as-is — their keys already match the PlantVillage suffixes.
}

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

# PlantVillage labels are <crop>_<disease>. Treatment depends on the pathogen,
# not the crop, so resolve the disease portion and key advice on that.
CROP_PREFIXES = (
    "apple", "blueberry", "cherry", "corn", "grape", "orange", "peach",
    "pepper", "potato", "raspberry", "soybean", "squash", "strawberry", "tomato",
)

CROP_DISPLAY = {
    "apple": ("Apple", "सेब"), "blueberry": ("Blueberry", "ब्लूबेरी"),
    "cherry": ("Cherry", "चेरी"), "corn": ("Maize", "मक्का"),
    "grape": ("Grape", "अंगूर"), "orange": ("Orange", "संतरा"),
    "peach": ("Peach", "आड़ू"), "pepper": ("Chilli/Capsicum", "मिर्च"),
    "potato": ("Potato", "आलू"), "raspberry": ("Raspberry", "रसभरी"),
    "soybean": ("Soybean", "सोयाबीन"), "squash": ("Squash", "कद्दू"),
    "strawberry": ("Strawberry", "स्ट्रॉबेरी"), "tomato": ("Tomato", "टमाटर"),
}


def split_label(label: str) -> tuple[str, str]:
    """'tomato_late_blight' → ('tomato', 'late_blight')."""
    for crop in CROP_PREFIXES:
        if label.startswith(crop + "_"):
            return crop, label[len(crop) + 1:]
    return "", label

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


def _leaf_presence_score(bgr: np.ndarray) -> float:
    """
    Cheap, dependency-free "is there a leaf in this photo at all" gate, run
    before the SVM ever sees the image. Reuses the same Otsu-on-saturation
    segmentation as extract_features() rather than adding a second model.

    Combines two signals so a single false positive doesn't let a non-leaf
    photo through:
      - segmented area fraction: how much of the frame the largest coherent
        blob covers (a photo of a wall/sky/person rarely produces a single
        large, leaf-shaped saturated region)
      - vegetation-hue fraction: share of pixels whose hue falls in the
        green→yellow→brown band that covers healthy and diseased foliage,
        which a wall, skin tone, sky, or fabric will not populate.
    """
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    sat = cv2.GaussianBlur(hsv[:, :, 1], (5, 5), 0)
    _, raw_mask = cv2.threshold(sat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    raw_mask = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    raw_mask = cv2.morphologyEx(raw_mask, cv2.MORPH_OPEN, kernel, iterations=1)

    n, labels, stats, _ = cv2.connectedComponentsWithStats(raw_mask, connectivity=8)
    if n <= 1:
        area_frac = 0.0
        blob_mask = np.zeros_like(raw_mask)
    else:
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        area_frac = float(stats[largest, cv2.CC_STAT_AREA]) / float(raw_mask.size)
        blob_mask = np.where(labels == largest, 255, 0).astype(np.uint8)

    # OpenCV hue is 0–179 for 0–358°. 15–100 covers yellow-green through
    # green to olive/brown — healthy leaf, dried leaf, and most common
    # lesion discoloration all fall inside it.
    hue = hsv[:, :, 0]
    veg_pixels = ((hue >= 15) & (hue <= 100) & (sat > 35))
    veg_frac_of_blob = (
        float(np.count_nonzero(veg_pixels & (blob_mask > 0))) / float(np.count_nonzero(blob_mask))
        if np.count_nonzero(blob_mask) > 0 else 0.0
    )
    veg_frac_of_frame = float(np.count_nonzero(veg_pixels)) / float(hue.size)

    # Weighted blend: a large, vegetation-colored blob scores highest; a
    # smaller blob that's still strongly vegetation-colored (close-up leaf
    # edge filling most of the frame) still passes via veg_frac_of_frame.
    return min(1.0, 0.45 * area_frac + 0.35 * veg_frac_of_blob + 0.20 * veg_frac_of_frame)


LEAF_PRESENCE_THRESHOLD = float(os.getenv("LEAF_PRESENCE_THRESHOLD", "0.12"))


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

        leaf_score = _leaf_presence_score(bgr)
        if leaf_score < LEAF_PRESENCE_THRESHOLD:
            raise NoLeafDetected("No leaf detected. Please upload a clear photo of a plant leaf.")

        vec, coverage = extract_features(bgr)
        proba = self.pipeline.predict_proba(vec.reshape(1, -1))[0]
        idx = int(np.argmax(proba))
        label = self.classes[idx]
        hi = language == "hi"

        crop_key, disease_key = split_label(label)
        kb = TREATMENT_KB.get(disease_key)

        if kb is None:
            # Unknown pathogen: say so honestly rather than defaulting to
            # "healthy", which would tell a farmer with a diseased crop to
            # do nothing.
            kb = TREATMENT_KB["_unknown"]

        crop_label = ""
        if crop_key:
            crop_label = CROP_DISPLAY.get(crop_key, (crop_key.title(), crop_key))[1 if hi else 0]

        base_name = str(kb["display_hi"] if hi else kb["display_en"])
        display = f"{crop_label} — {base_name}" if crop_label else base_name

        return Diagnosis(
            label=label,
            display_name=display,
            confidence=round(float(proba[idx]), 4),
            severity=str(kb["severity"]),
            advice=str(kb["advice_hi"] if hi else kb["advice_en"]),
            treatment=list(kb["treatment_hi"] if hi else kb["treatment"]),
            est_cost_inr_per_acre=int(kb["est_cost_inr_per_acre"]),
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