"""
Treatment knowledge base for the 38 PlantVillage crop-disease classes.

Kept as a separate module from disease_classifier.py so the (large) advice
content doesn't clutter the inference/feature-extraction logic. Every entry
follows the same schema as the original hand-written TREATMENT_KB:
display name (en/hi), severity, advice (en/hi), treatment steps, and an
estimated per-acre cost in INR.

NOTE ON SCOPE: this app targets Indian smallholder farmers, so a few
PlantVillage crops that are not commonly grown in India (blueberry,
raspberry) still get a minimal, honest entry — mainly a "healthy, no action"
message — rather than being silently dropped, since the model may still
legitimately classify an image into one of these buckets.
"""
from __future__ import annotations

from typing import Dict

PLANT_VILLAGE_TREATMENT_KB: Dict[str, Dict[str, object]] = {

    # ───────────────────────── Apple ─────────────────────────
    "apple_scab": {
        "display_en": "Apple scab",
        "display_hi": "सेब का स्कैब रोग",
        "severity": "high",
        "advice_en": "Olive-green to black velvety spots on leaves and fruit. Fungus overwinters in fallen leaves, so sanitation matters as much as spraying.",
        "advice_hi": "पत्तियों और फलों पर जैतूनी-हरे से काले मखमली धब्बे। कवक गिरी हुई पत्तियों में सर्दी बिताता है, इसलिए सफाई भी छिड़काव जितनी ज़रूरी है।",
        "treatment": [
            "Captan 50% WP @ 2.5 g/litre from bud-break, every 10–14 days",
            "Or Myclobutanil 10% WP @ 1 g/litre",
            "Rake and destroy fallen leaves after harvest to cut next season's spore source",
        ],
        "est_cost_inr_per_acre": 950,
    },
    "apple_black_rot": {
        "display_en": "Apple black rot",
        "display_hi": "सेब का काला सड़न रोग",
        "severity": "high",
        "advice_en": "Purple-bordered leaf spots and rotting fruit with concentric rings. The fungus survives in dead wood, so pruning out cankers is essential.",
        "advice_hi": "बैंगनी किनारे वाले पत्ती धब्बे और फल पर गोल छल्लेदार सड़न। कवक मृत लकड़ी में जीवित रहता है, इसलिए संक्रमित शाखाएँ काटना ज़रूरी है।",
        "treatment": [
            "Prune and burn cankered/dead wood in dormant season",
            "Captan 50% WP @ 2.5 g/litre or Thiophanate-methyl @ 1 g/litre",
            "Remove mummified fruit left on the tree",
        ],
        "est_cost_inr_per_acre": 900,
    },
    "apple_cedar_rust": {
        "display_en": "Cedar apple rust",
        "display_hi": "सेब का देवदार रतुआ",
        "severity": "medium",
        "advice_en": "Bright orange-yellow spots on leaves. This disease needs a nearby juniper/cedar host to complete its cycle each year.",
        "advice_hi": "पत्तियों पर चमकीले नारंगी-पीले धब्बे। यह रोग हर साल पास के जुनिपर/देवदार पेड़ पर निर्भर करता है।",
        "treatment": [
            "Myclobutanil 10% WP @ 1 g/litre at pink-bud stage, repeat after 10 days",
            "Remove any junipers within 100–150 m if practical",
            "Choose rust-resistant apple varieties for new planting",
        ],
        "est_cost_inr_per_acre": 700,
    },
    "apple_healthy": {
        "display_en": "Healthy apple leaf",
        "display_hi": "स्वस्थ सेब की पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },

    # ───────────────────────── Blueberry ─────────────────────────
    "blueberry_healthy": {
        "display_en": "Healthy blueberry leaf",
        "display_hi": "स्वस्थ ब्लूबेरी पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },

    # ───────────────────────── Cherry ─────────────────────────
    "cherry_powdery_mildew": {
        "display_en": "Cherry powdery mildew",
        "display_hi": "चेरी की चूर्णिल आसिता",
        "severity": "medium",
        "advice_en": "White powdery patches on leaves and shoot tips, worse in warm dry weather with high humidity at night.",
        "advice_hi": "पत्तियों और नई टहनियों पर सफ़ेद पाउडर जैसा फैलाव, गर्म सूखे दिन और नम रात में बदतर होता है।",
        "treatment": [
            "Wettable sulphur 80% WP @ 2 g/litre",
            "Or Myclobutanil 10% WP @ 1 g/litre",
            "Prune for open canopy to improve airflow",
        ],
        "est_cost_inr_per_acre": 650,
    },
    "cherry_healthy": {
        "display_en": "Healthy cherry leaf",
        "display_hi": "स्वस्थ चेरी पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },

    # ───────────────────────── Corn / Maize ─────────────────────────
    "corn_gray_leaf_spot": {
        "display_en": "Corn gray leaf spot",
        "display_hi": "मक्का का धूसर पत्ती धब्बा",
        "severity": "high",
        "advice_en": "Rectangular tan-to-gray lesions running parallel to leaf veins. Spreads fast in humid, continuous-corn fields.",
        "advice_hi": "पत्ती की नसों के समांतर आयताकार धूसर-भूरे धब्बे। नम मौसम और लगातार मक्का बोने वाले खेतों में तेज़ी से फैलता है।",
        "treatment": [
            "Azoxystrobin 23% SC @ 1 ml/litre or Propiconazole 25% EC @ 1 ml/litre",
            "Rotate with a non-host crop for at least one season",
            "Choose resistant hybrids where available",
        ],
        "est_cost_inr_per_acre": 480,
    },
    "corn_common_rust": {
        "display_en": "Corn common rust",
        "display_hi": "मक्का का सामान्य रतुआ",
        "severity": "medium",
        "advice_en": "Small cinnamon-brown pustules scattered on both leaf surfaces. Usually manageable if caught before tasseling.",
        "advice_hi": "पत्ती के दोनों तरफ़ छोटे दालचीनी-भूरे दाने। बालियाँ निकलने से पहले पकड़ में आ जाए तो नियंत्रण आसान है।",
        "treatment": [
            "Propiconazole 25% EC @ 1 ml/litre, full coverage",
            "Repeat after 12–15 days if pustules continue to appear",
        ],
        "est_cost_inr_per_acre": 420,
    },
    "corn_northern_leaf_blight": {
        "display_en": "Corn northern leaf blight",
        "display_hi": "मक्का का उत्तरी पत्ती झुलसा",
        "severity": "high",
        "advice_en": "Long, cigar-shaped gray-green lesions on lower leaves first, moving upward. Can cause serious yield loss if it reaches the ear leaf before grain fill.",
        "advice_hi": "निचली पत्तियों पर लंबे सिगार-आकार के धूसर-हरे धब्बे, ऊपर की ओर बढ़ते हैं। दाना भरने से पहले भुट्टे की पत्ती तक पहुँचे तो भारी नुकसान।",
        "treatment": [
            "Mancozeb 75% WP @ 2.5 g/litre at first sign, repeat after 10 days",
            "Rotate crops and plough under residue after harvest",
        ],
        "est_cost_inr_per_acre": 500,
    },
    "corn_healthy": {
        "display_en": "Healthy corn leaf",
        "display_hi": "स्वस्थ मक्का पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },

    # ───────────────────────── Grape ─────────────────────────
    "grape_black_rot": {
        "display_en": "Grape black rot",
        "display_hi": "अंगूर का काला सड़न रोग",
        "severity": "high",
        "advice_en": "Brown circular leaf spots with black fruiting dots, and berries that shrivel into hard black mummies.",
        "advice_hi": "भूरे गोल पत्ती धब्बे जिनमें काले बिंदु होते हैं, और फल सूखकर काली सख्त गुठली बन जाते हैं।",
        "treatment": [
            "Mancozeb 75% WP @ 2.5 g/litre from bud-break through fruit-set",
            "Or Myclobutanil 10% WP @ 1 g/litre",
            "Remove and destroy mummified berries and infected canes",
        ],
        "est_cost_inr_per_acre": 850,
    },
    "grape_esca": {
        "display_en": "Grape esca (black measles)",
        "display_hi": "अंगूर का एस्का रोग (काला मीज़ल्स)",
        "severity": "high",
        "advice_en": "Tiger-stripe leaf discoloration and dark spotted berries. This is a trunk-wood disease — there is no effective spray once inside the vine.",
        "advice_hi": "पत्तियों पर धारीदार रंग और फलों पर काले धब्बे। यह तने की लकड़ी का रोग है — बेल के अंदर पहुँचने पर कोई असरदार दवा नहीं है।",
        "treatment": [
            "Prune out and destroy visibly affected wood in dry weather",
            "Protect pruning cuts with a wound sealant to block new infection",
            "Avoid over-irrigation and vine stress, which worsens symptom expression",
        ],
        "est_cost_inr_per_acre": 300,
    },
    "grape_leaf_blight": {
        "display_en": "Grape leaf blight (Isariopsis leaf spot)",
        "display_hi": "अंगूर का पत्ती झुलसा (इसारियोप्सिस धब्बा)",
        "severity": "medium",
        "advice_en": "Angular brown spots on leaves that can merge and cause early defoliation, weakening the vine before harvest.",
        "advice_hi": "पत्तियों पर कोणीय भूरे धब्बे जो मिलकर समय से पहले पत्तियाँ गिरा सकते हैं, जिससे बेल कमज़ोर होती है।",
        "treatment": [
            "Mancozeb 75% WP @ 2.5 g/litre, repeat every 10–14 days in wet weather",
            "Improve canopy airflow through timely leaf/shoot thinning",
        ],
        "est_cost_inr_per_acre": 500,
    },
    "grape_healthy": {
        "display_en": "Healthy grape leaf",
        "display_hi": "स्वस्थ अंगूर पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },

    # ───────────────────────── Orange ─────────────────────────
    "orange_citrus_greening": {
        "display_en": "Citrus greening (Huanglongbing)",
        "display_hi": "साइट्रस ग्रीनिंग (हुआंगलोंगबिंग)",
        "severity": "high",
        "advice_en": "Blotchy yellow mottling on leaves and lopsided, bitter fruit. This bacterial disease has no cure — it spreads via the Asian citrus psyllid insect and management is about slowing spread, not curing the tree.",
        "advice_hi": "पत्तियों पर धब्बेदार पीलापन और टेढ़े-मेढ़े कड़वे फल। इस जीवाणु रोग का कोई इलाज नहीं है — यह साइट्रस सिल्ला कीट से फैलता है, प्रबंधन का मतलब फैलाव रोकना है, इलाज नहीं।",
        "treatment": [
            "Remove and destroy confirmed infected trees to protect the rest of the orchard",
            "Control the Asian citrus psyllid vector with recommended insecticides",
            "Source new saplings only from certified disease-free nurseries",
        ],
        "est_cost_inr_per_acre": 600,
    },

    # ───────────────────────── Peach ─────────────────────────
    "peach_bacterial_spot": {
        "display_en": "Peach bacterial spot",
        "display_hi": "आड़ू का जीवाणु धब्बा रोग",
        "severity": "high",
        "advice_en": "Small dark angular spots on leaves and fruit, often with a yellow halo. Fungicides will not work — you need a copper-based bactericide, and repeated overhead watering makes it worse.",
        "advice_hi": "पत्तियों और फल पर छोटे कोणीय काले धब्बे, अक्सर पीले घेरे के साथ। फफूंदनाशक बेअसर है — कॉपर आधारित दवा चाहिए, और बार-बार ऊपर से सिंचाई इसे बढ़ाती है।",
        "treatment": [
            "Copper oxychloride 50% WP @ 3 g/litre at dormant and early bloom",
            "Avoid overhead irrigation; switch to drip if possible",
        ],
        "est_cost_inr_per_acre": 450,
    },
    "peach_healthy": {
        "display_en": "Healthy peach leaf",
        "display_hi": "स्वस्थ आड़ू पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },

    # ───────────────────────── Pepper (bell) ─────────────────────────
    "pepper_bacterial_spot": {
        "display_en": "Bell pepper bacterial spot",
        "display_hi": "शिमला मिर्च का जीवाणु धब्बा",
        "severity": "high",
        "advice_en": "Water-soaked dark spots with yellow halos on leaves, and raised scabby spots on fruit. Needs a copper-based bactericide, not a fungicide.",
        "advice_hi": "पत्तियों पर पीले घेरे वाले गीले काले धब्बे, फल पर उभरे खुरदुरे धब्बे। फफूंदनाशक नहीं, कॉपर आधारित दवा चाहिए।",
        "treatment": [
            "Copper oxychloride 50% WP @ 3 g/litre",
            "Add Streptomycin sulphate @ 0.1 g/litre where locally permitted",
            "Stop overhead irrigation immediately",
        ],
        "est_cost_inr_per_acre": 450,
    },
    "pepper_healthy": {
        "display_en": "Healthy bell pepper leaf",
        "display_hi": "स्वस्थ शिमला मिर्च पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },

    # ───────────────────────── Potato ─────────────────────────
    "potato_early_blight": {
        "display_en": "Potato early blight",
        "display_hi": "आलू का अगेती झुलसा",
        "severity": "high",
        "advice_en": "Concentric brown target-like rings on older leaves first. Remove infected lower leaves and start protectant sprays early.",
        "advice_hi": "पुरानी पत्तियों पर पहले गोल भूरे छल्लेदार धब्बे दिखते हैं। संक्रमित निचली पत्तियाँ हटाएँ और जल्दी छिड़काव शुरू करें।",
        "treatment": [
            "Mancozeb 75% WP @ 2.5 g/litre",
            "Alternate with Chlorothalonil to prevent resistance",
            "Improve row spacing for airflow",
        ],
        "est_cost_inr_per_acre": 380,
    },
    "potato_late_blight": {
        "display_en": "Potato late blight",
        "display_hi": "आलू का पछेती झुलसा",
        "severity": "high",
        "advice_en": "Dark water-soaked patches that spread fast in cool, wet weather and can destroy a field within days. This is the most urgent potato disease — spray immediately, don't wait.",
        "advice_hi": "ठंडे नम मौसम में तेज़ी से फैलने वाले गहरे गीले धब्बे, कुछ ही दिनों में पूरा खेत बर्बाद कर सकता है। यह आलू की सबसे गंभीर बीमारी है — तुरंत छिड़काव करें।",
        "treatment": [
            "Metalaxyl + Mancozeb combination @ 2.5 g/litre immediately",
            "Repeat every 7 days in continued wet/humid weather",
            "Destroy any volunteer potato plants and cull piles that can carry the disease over",
        ],
        "est_cost_inr_per_acre": 550,
    },
    "potato_healthy": {
        "display_en": "Healthy potato leaf",
        "display_hi": "स्वस्थ आलू पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },

    # ───────────────────────── Raspberry ─────────────────────────
    "raspberry_healthy": {
        "display_en": "Healthy raspberry leaf",
        "display_hi": "स्वस्थ रास्पबेरी पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },

    # ───────────────────────── Soybean ─────────────────────────
    "soybean_healthy": {
        "display_en": "Healthy soybean leaf",
        "display_hi": "स्वस्थ सोयाबीन पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },

    # ───────────────────────── Squash ─────────────────────────
    "squash_powdery_mildew": {
        "display_en": "Squash powdery mildew",
        "display_hi": "कद्दू की चूर्णिल आसिता",
        "severity": "medium",
        "advice_en": "White powdery coating on leaves, spreading fast in warm dry days with humid nights.",
        "advice_hi": "पत्तियों पर सफ़ेद पाउडर जैसा लेप, गर्म सूखे दिन और नम रात में तेज़ी से फैलता है।",
        "treatment": [
            "Wettable sulphur 80% WP @ 2 g/litre",
            "Or Hexaconazole 5% EC @ 1 ml/litre",
            "Spray in the evening to avoid leaf scorch",
        ],
        "est_cost_inr_per_acre": 260,
    },

    # ───────────────────────── Strawberry ─────────────────────────
    "strawberry_leaf_scorch": {
        "display_en": "Strawberry leaf scorch",
        "display_hi": "स्ट्रॉबेरी पत्ती झुलसा",
        "severity": "medium",
        "advice_en": "Small purple spots that merge into scorched, dried-looking patches on older leaves.",
        "advice_hi": "छोटे बैंगनी धब्बे जो पुरानी पत्तियों पर मिलकर झुलसे हुए सूखे धब्बे बनाते हैं।",
        "treatment": [
            "Captan 50% WP @ 2.5 g/litre or Myclobutanil 10% WP @ 1 g/litre",
            "Remove and destroy old infected leaves after harvest",
            "Avoid overhead irrigation late in the day",
        ],
        "est_cost_inr_per_acre": 400,
    },
    "strawberry_healthy": {
        "display_en": "Healthy strawberry leaf",
        "display_hi": "स्वस्थ स्ट्रॉबेरी पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },

    # ───────────────────────── Tomato ─────────────────────────
    "tomato_bacterial_spot": {
        "display_en": "Tomato bacterial spot",
        "display_hi": "टमाटर का जीवाणु धब्बा",
        "severity": "high",
        "advice_en": "Water-soaked dark spots with yellow halos. Fungicides will not work — you need a copper-based bactericide.",
        "advice_hi": "पीले घेरे वाले गीले काले धब्बे। फफूंदनाशक बेअसर है — कॉपर आधारित दवा चाहिए।",
        "treatment": [
            "Copper oxychloride 50% WP @ 3 g/litre",
            "Add Streptomycin sulphate @ 0.1 g/litre where permitted",
            "Stop overhead irrigation immediately",
        ],
        "est_cost_inr_per_acre": 450,
    },
    "tomato_early_blight": {
        "display_en": "Tomato early blight",
        "display_hi": "टमाटर का अगेती झुलसा",
        "severity": "high",
        "advice_en": "Concentric brown lesions indicate early blight. Remove infected lower leaves and spray a protectant fungicide.",
        "advice_hi": "गोल भूरे धब्बे अगेती झुलसा दर्शाते हैं। नीचे की संक्रमित पत्तियाँ हटाएँ और फफूंदनाशक छिड़कें।",
        "treatment": [
            "Mancozeb 75% WP @ 2.5 g/litre",
            "Alternate with Chlorothalonil to prevent resistance",
            "Improve row spacing for airflow",
        ],
        "est_cost_inr_per_acre": 380,
    },
    "tomato_late_blight": {
        "display_en": "Tomato late blight",
        "display_hi": "टमाटर का पछेती झुलसा",
        "severity": "high",
        "advice_en": "Dark greasy patches that spread very fast in cool, wet weather. This is the most destructive tomato disease — treat as an emergency.",
        "advice_hi": "ठंडे नम मौसम में बहुत तेज़ी से फैलने वाले गहरे चिकने धब्बे। यह टमाटर की सबसे विनाशकारी बीमारी है — तुरंत कार्रवाई करें।",
        "treatment": [
            "Metalaxyl + Mancozeb combination @ 2.5 g/litre immediately",
            "Repeat every 7 days in continued wet weather",
            "Remove and destroy infected plants to stop spread to neighbours",
        ],
        "est_cost_inr_per_acre": 550,
    },
    "tomato_leaf_mold": {
        "display_en": "Tomato leaf mold",
        "display_hi": "टमाटर की पत्ती फफूंद",
        "severity": "medium",
        "advice_en": "Pale yellow patches on top of the leaf with olive-green velvety mold underneath. Common in polyhouses/greenhouses with poor ventilation.",
        "advice_hi": "पत्ती के ऊपर हल्के पीले धब्बे और नीचे जैतूनी-हरा मखमली फफूंद। पॉलीहाउस/ग्रीनहाउस में हवा की कमी होने पर आम है।",
        "treatment": [
            "Chlorothalonil 75% WP @ 2 g/litre",
            "Increase ventilation and reduce humidity inside the structure",
            "Avoid wetting foliage when watering",
        ],
        "est_cost_inr_per_acre": 400,
    },
    "tomato_septoria_leaf_spot": {
        "display_en": "Tomato Septoria leaf spot",
        "display_hi": "टमाटर का सेप्टोरिया पत्ती धब्बा",
        "severity": "medium",
        "advice_en": "Many small circular spots with dark borders and gray centers, starting on lower leaves and moving up.",
        "advice_hi": "कई छोटे गोल धब्बे, गहरे किनारे और स्लेटी बीच वाले, नीचे की पत्तियों से शुरू होकर ऊपर बढ़ते हैं।",
        "treatment": [
            "Chlorothalonil 75% WP @ 2 g/litre or Mancozeb 75% WP @ 2.5 g/litre",
            "Remove lower infected leaves and mulch to reduce soil splash",
        ],
        "est_cost_inr_per_acre": 380,
    },
    "tomato_spider_mites": {
        "display_en": "Tomato spider mite damage",
        "display_hi": "टमाटर पर मकड़ी माइट का नुकसान",
        "severity": "medium",
        "advice_en": "Fine yellow stippling and faint webbing on leaf undersides — this is an insect/mite pest, not a fungus, so fungicides won't help.",
        "advice_hi": "पत्ती के नीचे महीन पीले धब्बे और हल्का जाला — यह कीट/माइट का नुकसान है, फफूंद नहीं, इसलिए फफूंदनाशक काम नहीं करेगा।",
        "treatment": [
            "Spray with a miticide such as Abamectin @ 0.5 ml/litre or Spiromesifen @ 1 ml/litre",
            "Ensure good coverage on the underside of leaves where mites live",
            "Avoid excess nitrogen, which encourages mite outbreaks",
        ],
        "est_cost_inr_per_acre": 420,
    },
    "tomato_target_spot": {
        "display_en": "Tomato target spot",
        "display_hi": "टमाटर का लक्ष्य धब्बा रोग",
        "severity": "medium",
        "advice_en": "Brown lesions with concentric target-like rings, on leaves, stems and fruit alike.",
        "advice_hi": "पत्तियों, तनों और फलों पर भूरे धब्बे जिनमें गोल लक्ष्य जैसे छल्ले होते हैं।",
        "treatment": [
            "Azoxystrobin 23% SC @ 1 ml/litre or Mancozeb 75% WP @ 2.5 g/litre",
            "Improve airflow through pruning and spacing",
        ],
        "est_cost_inr_per_acre": 450,
    },
    "tomato_yellow_leaf_curl_virus": {
        "display_en": "Tomato yellow leaf curl virus",
        "display_hi": "टमाटर पीला पत्ती मोड़ विषाणु रोग",
        "severity": "high",
        "advice_en": "Upward curling, yellowing leaves and stunted growth. This is a virus spread by whiteflies — there is no cure, so the fight is against the insect vector, not the plant.",
        "advice_hi": "पत्तियाँ ऊपर की ओर मुड़ती और पीली पड़ती हैं, पौधा बौना रह जाता है। यह विषाणु सफेद मक्खी से फैलता है — कोई इलाज नहीं, कीट को रोकना ही उपाय है।",
        "treatment": [
            "Remove and destroy infected plants immediately to reduce virus source",
            "Control whitefly with yellow sticky traps and recommended insecticides",
            "Use virus-resistant tomato varieties in future plantings",
        ],
        "est_cost_inr_per_acre": 350,
    },
    "tomato_mosaic_virus": {
        "display_en": "Tomato mosaic virus",
        "display_hi": "टमाटर मोज़ेक विषाणु रोग",
        "severity": "high",
        "advice_en": "Mottled light and dark green patches on leaves with distorted growth. No chemical cures a virus — focus on preventing spread through tools and hands.",
        "advice_hi": "पत्तियों पर हल्के-गहरे हरे धब्बेदार पैटर्न और बढ़वार में बिगाड़। कोई दवा विषाणु को ठीक नहीं करती — फैलाव रोकने पर ध्यान दें।",
        "treatment": [
            "Remove and destroy infected plants",
            "Disinfect hands and tools with soap or diluted bleach between plants",
            "Avoid handling healthy plants after touching tobacco products (a related virus source)",
        ],
        "est_cost_inr_per_acre": 250,
    },
    "tomato_healthy": {
        "display_en": "Healthy tomato leaf",
        "display_hi": "स्वस्थ टमाटर पत्ती",
        "severity": "none",
        "advice_en": "No disease detected. Continue your normal schedule and scout again in 5–7 days.",
        "advice_hi": "कोई बीमारी नहीं मिली। सामान्य कार्यक्रम जारी रखें और 5–7 दिन बाद दोबारा जाँचें।",
        "treatment": [],
        "est_cost_inr_per_acre": 0,
    },
}
