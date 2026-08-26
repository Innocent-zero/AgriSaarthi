"""
Seed corpus of Indian agricultural scheme knowledge.

Each scheme is broken into retrievable sections. Sections are the retrieval
unit because a farmer's question ("how long do I have to report hail damage?")
maps to one section, not to a whole scheme document.

Every section carries English and Hindi text so retrieval and answers work in
both languages without a translation layer.

IMPORTANT: figures below reflect the scheme rules as documented in the
operational guidelines, but government notifications change them. Before any
public deployment, ingest the current official PDFs with:

    python -m app.scripts.ingest --pdf-dir data/scheme_pdfs

which supplements (and can supersede) this seed content.
"""
from __future__ import annotations

from typing import Any, Dict, List

SCHEMES: List[Dict[str, Any]] = [
    # ═══════════════════════════════ PMFBY ═══════════════════════════════
    {
        "scheme_id": "pmfby",
        "title_en": "Pradhan Mantri Fasal Bima Yojana (PMFBY)",
        "title_hi": "प्रधानमंत्री फसल बीमा योजना (PMFBY)",
        "source_url": "https://pmfby.gov.in",
        "official": True,
        "aliases": [
            "pmfby", "fasal bima", "crop insurance", "फसल बीमा", "बीमा", "insurance",
            "claim", "दावा", "मुआवजा", "compensation", "बीमा योजना",
        ],
        "sections": [
            {
                "section_id": "pmfby.overview",
                "heading_en": "What PMFBY covers",
                "heading_hi": "PMFBY में क्या शामिल है",
                "text_en": (
                    "PMFBY is the national crop insurance scheme. It covers yield losses from "
                    "non-preventable natural risks across the crop cycle. Coverage includes "
                    "prevented sowing when adverse weather stops planting, standing crop losses "
                    "from drought, dry spells, flood, inundation, widespread pest and disease "
                    "attack, landslide, natural fire and lightning, storm, hailstorm, cyclone, "
                    "typhoon, tempest, hurricane and tornado. It also covers post-harvest losses "
                    "for crops left in cut-and-spread condition in the field, and localised "
                    "calamities affecting individual fields. Losses from war, nuclear risk, "
                    "malicious damage, theft, and damage by domestic or wild animals are excluded."
                ),
                "text_hi": (
                    "PMFBY राष्ट्रीय फसल बीमा योजना है। यह पूरे फसल चक्र में प्राकृतिक आपदाओं से होने वाले "
                    "उपज नुकसान को कवर करती है। इसमें शामिल है: खराब मौसम के कारण बुवाई न हो पाना, "
                    "खड़ी फसल में सूखा, अल्पवृष्टि, बाढ़, जलभराव, व्यापक कीट व रोग प्रकोप, भूस्खलन, "
                    "प्राकृतिक आग व बिजली गिरना, तूफान, ओलावृष्टि, चक्रवात और बवंडर। कटाई के बाद खेत में "
                    "सुखाने के लिए फैली फसल का नुकसान और अलग-अलग खेतों की स्थानीय आपदाएँ भी शामिल हैं। "
                    "युद्ध, परमाणु जोखिम, जानबूझकर नुकसान, चोरी और पालतू या जंगली जानवरों से नुकसान शामिल नहीं है।"
                ),
                "keywords": ["coverage", "risks", "what is covered", "कवर", "जोखिम", "शामिल"],
            },
            {
                "section_id": "pmfby.premium",
                "heading_en": "How much premium the farmer pays",
                "heading_hi": "किसान कितना प्रीमियम देता है",
                "text_en": (
                    "The farmer's share of premium is capped by crop season. For Kharif food "
                    "grain and oilseed crops the farmer pays a maximum of 2 percent of the sum "
                    "insured. For Rabi food grain and oilseed crops the maximum is 1.5 percent. "
                    "For annual commercial and annual horticultural crops the maximum is 5 percent, "
                    "in both Kharif and Rabi. The balance of the actuarial premium is shared "
                    "between the central and state governments. The farmer never pays more than "
                    "these capped rates regardless of the actuarial rate quoted by the insurer."
                ),
                "text_hi": (
                    "किसान का प्रीमियम हिस्सा फसल के मौसम के अनुसार सीमित है। खरीफ की खाद्यान्न और "
                    "तिलहन फसलों पर किसान बीमित राशि का अधिकतम 2 प्रतिशत देता है। रबी की खाद्यान्न और "
                    "तिलहन फसलों पर अधिकतम 1.5 प्रतिशत। वार्षिक व्यावसायिक और बागवानी फसलों पर खरीफ और "
                    "रबी दोनों में अधिकतम 5 प्रतिशत। बाकी प्रीमियम केंद्र और राज्य सरकार मिलकर देती हैं। "
                    "बीमा कंपनी की दर चाहे जो हो, किसान इन सीमाओं से ज़्यादा कभी नहीं देता।"
                ),
                "keywords": ["premium", "cost", "2%", "1.5%", "5%", "प्रीमियम", "कितना पैसा", "खर्च"],
            },
            {
                "section_id": "pmfby.intimation",
                "heading_en": "The 72-hour reporting rule",
                "heading_hi": "72 घंटे की सूचना का नियम",
                "text_en": (
                    "For localised calamities and post-harvest losses, the farmer must intimate "
                    "the loss within 72 hours of the event. Intimation can be given through the "
                    "Crop Insurance App, the National Crop Insurance Portal, the insurance "
                    "company's toll-free number, the bank branch, the Common Service Centre, or "
                    "the local agriculture department office. The intimation must state the "
                    "survey number, the crop affected, the cause of loss and the extent of damage. "
                    "Missing the 72-hour window is the single most common reason claims are "
                    "rejected. After intimation, a joint survey by the insurer and the state "
                    "agriculture department is conducted, normally within seven days."
                ),
                "text_hi": (
                    "स्थानीय आपदा और कटाई के बाद के नुकसान की सूचना किसान को घटना के 72 घंटे के भीतर "
                    "देनी होती है। सूचना क्रॉप इंश्योरेंस ऐप, राष्ट्रीय फसल बीमा पोर्टल, बीमा कंपनी के "
                    "टोल-फ्री नंबर, बैंक शाखा, कॉमन सर्विस सेंटर या स्थानीय कृषि विभाग कार्यालय से दी जा "
                    "सकती है। सूचना में खसरा नंबर, प्रभावित फसल, नुकसान का कारण और नुकसान की मात्रा "
                    "बतानी होती है। 72 घंटे की समय-सीमा चूकना दावा खारिज होने का सबसे आम कारण है। "
                    "सूचना के बाद बीमा कंपनी और कृषि विभाग मिलकर आमतौर पर सात दिन में सर्वे करते हैं।"
                ),
                "keywords": [
                    "72 hours", "report", "intimation", "deadline", "how to claim",
                    "72 घंटे", "सूचना", "दावा कैसे", "समय सीमा",
                ],
            },
            {
                "section_id": "pmfby.localised",
                "heading_en": "Localised calamities and individual assessment",
                "heading_hi": "स्थानीय आपदा और व्यक्तिगत आकलन",
                "text_en": (
                    "Localised calamity means damage to isolated fields rather than a whole notified "
                    "area. The recognised localised perils are hailstorm, landslide, inundation, "
                    "cloud burst and natural fire due to lightning. For these, loss is assessed on "
                    "an individual farm basis rather than by the area approach, so a single farmer "
                    "whose field was hit can claim even if neighbouring fields were untouched. "
                    "This is why hail damage to one plot is claimable. Individual assessment "
                    "requires the 72-hour intimation and a field survey."
                ),
                "text_hi": (
                    "स्थानीय आपदा का अर्थ है पूरे अधिसूचित क्षेत्र के बजाय अलग-अलग खेतों को नुकसान। "
                    "मान्य स्थानीय आपदाएँ हैं: ओलावृष्टि, भूस्खलन, जलभराव, बादल फटना और बिजली गिरने से "
                    "प्राकृतिक आग। इनमें नुकसान का आकलन क्षेत्र के आधार पर नहीं, बल्कि हर खेत का अलग "
                    "किया जाता है। इसलिए जिस किसान का खेत प्रभावित हुआ है वह दावा कर सकता है, भले ही "
                    "पड़ोसी खेत सुरक्षित हों। ओलावृष्टि से एक खेत का नुकसान इसी कारण दावा योग्य है। "
                    "व्यक्तिगत आकलन के लिए 72 घंटे में सूचना और खेत का सर्वे ज़रूरी है।"
                ),
                "keywords": [
                    "hailstorm", "hail", "localised", "individual", "landslide", "inundation",
                    "ओला", "ओलावृष्टि", "स्थानीय", "भूस्खलन", "जलभराव",
                ],
            },
            {
                "section_id": "pmfby.postharvest",
                "heading_en": "Post-harvest losses",
                "heading_hi": "कटाई के बाद का नुकसान",
                "text_en": (
                    "Crops that have been harvested and left in the field in cut-and-spread "
                    "condition for drying are covered for up to 14 days from harvesting. The "
                    "covered perils in this window are cyclone, cyclonic rain and unseasonal rain. "
                    "Assessment is on an individual farm basis, and the 72-hour intimation rule "
                    "applies. Crops moved to a threshing floor, storage or market are no longer "
                    "covered under this provision."
                ),
                "text_hi": (
                    "कटाई के बाद सुखाने के लिए खेत में फैली फसल कटाई से 14 दिन तक कवर रहती है। "
                    "इस अवधि में चक्रवात, चक्रवाती वर्षा और बेमौसम बारिश से नुकसान शामिल है। आकलन हर "
                    "खेत का अलग होता है और 72 घंटे में सूचना देने का नियम लागू रहता है। खलिहान, भंडार "
                    "या मंडी में पहुँचाई गई फसल इस प्रावधान में कवर नहीं होती।"
                ),
                "keywords": [
                    "post harvest", "14 days", "unseasonal rain", "drying", "cut and spread",
                    "कटाई के बाद", "14 दिन", "बेमौसम बारिश", "सुखाना",
                ],
            },
            {
                "section_id": "pmfby.assessment",
                "heading_en": "How the claim amount is calculated",
                "heading_hi": "दावे की राशि कैसे तय होती है",
                "text_en": (
                    "For widespread calamities the area approach applies. A threshold yield is "
                    "fixed as the average yield of the best five of the last seven years, "
                    "multiplied by the indemnity level notified for that crop and area, which is "
                    "70, 80 or 90 percent. Actual yield is measured through Crop Cutting "
                    "Experiments conducted in the notified insurance unit. If actual yield falls "
                    "below the threshold yield, the claim is the shortfall divided by the threshold "
                    "yield, multiplied by the sum insured. For prevented sowing, the payout is 25 "
                    "percent of the sum insured and the insurance cover then terminates. Where "
                    "mid-season adversity is declared, an on-account payment of up to 25 percent "
                    "of the likely claim may be released in advance."
                ),
                "text_hi": (
                    "व्यापक आपदा में क्षेत्र आधारित तरीका लागू होता है। सीमा उपज पिछले सात वर्षों में से "
                    "सर्वोत्तम पाँच वर्षों की औसत उपज को उस फसल और क्षेत्र के लिए अधिसूचित क्षतिपूर्ति "
                    "स्तर (70, 80 या 90 प्रतिशत) से गुणा करके तय होती है। वास्तविक उपज अधिसूचित बीमा "
                    "इकाई में फसल कटाई प्रयोगों से मापी जाती है। यदि वास्तविक उपज सीमा उपज से कम है तो "
                    "दावा = (कमी ÷ सीमा उपज) × बीमित राशि। बुवाई न हो पाने पर बीमित राशि का 25 प्रतिशत "
                    "मिलता है और उसके बाद बीमा कवर समाप्त हो जाता है। मध्य-मौसम प्रतिकूलता घोषित होने पर "
                    "संभावित दावे का 25 प्रतिशत तक अग्रिम भुगतान जारी हो सकता है।"
                ),
                "keywords": [
                    "how much claim", "threshold yield", "indemnity", "crop cutting", "calculation",
                    "कितना मिलेगा", "सीमा उपज", "क्षतिपूर्ति", "गणना",
                ],
            },
            {
                "section_id": "pmfby.enrolment",
                "heading_en": "Who can enrol and what documents are needed",
                "heading_hi": "कौन नामांकन कर सकता है और कौन से दस्तावेज़ चाहिए",
                "text_en": (
                    "Enrolment is voluntary for all farmers. Both loanee farmers who have taken a "
                    "crop loan and non-loanee farmers can enrol, including sharecroppers and "
                    "tenant farmers where the state permits. Documents required are Aadhaar, a "
                    "bank passbook or cancelled cheque showing account and IFSC, land records such "
                    "as the khasra or khatauni, and for tenants a sowing certificate or tenancy "
                    "agreement. Enrolment cut-off dates are notified by season and are typically "
                    "about a month before the end of the sowing window, so applying early matters. "
                    "Enrolment can be done at a bank branch, a Common Service Centre, through an "
                    "authorised insurance intermediary, or on the National Crop Insurance Portal."
                ),
                "text_hi": (
                    "नामांकन सभी किसानों के लिए स्वैच्छिक है। फसल ऋण लेने वाले और न लेने वाले, दोनों "
                    "प्रकार के किसान नामांकन कर सकते हैं। जहाँ राज्य अनुमति देता है वहाँ बटाईदार और "
                    "किरायेदार किसान भी शामिल हैं। ज़रूरी दस्तावेज़: आधार, बैंक पासबुक या रद्द चेक "
                    "(खाता और IFSC सहित), भूमि रिकॉर्ड जैसे खसरा-खतौनी, और किरायेदारों के लिए बुवाई "
                    "प्रमाणपत्र या पट्टा समझौता। नामांकन की अंतिम तिथि हर मौसम के लिए अधिसूचित होती है "
                    "और आमतौर पर बुवाई अवधि समाप्त होने से लगभग एक महीने पहले होती है, इसलिए जल्दी "
                    "आवेदन करना ज़रूरी है। नामांकन बैंक शाखा, कॉमन सर्विस सेंटर, अधिकृत बीमा मध्यस्थ "
                    "या राष्ट्रीय फसल बीमा पोर्टल से किया जा सकता है।"
                ),
                "keywords": [
                    "enrol", "apply", "documents", "eligibility", "tenant", "sharecropper",
                    "नामांकन", "आवेदन", "दस्तावेज़", "पात्रता", "बटाईदार",
                ],
            },
            {
                "section_id": "pmfby.grievance",
                "heading_en": "If the claim is rejected or delayed",
                "heading_hi": "दावा खारिज या देर होने पर",
                "text_en": (
                    "If a claim is rejected or payment is delayed, the farmer can escalate to the "
                    "District Level Monitoring Committee, then the State Level Coordination "
                    "Committee on Crop Insurance. Complaints can also be filed on the National "
                    "Crop Insurance Portal grievance module or the Krishi Rakshak Portal and "
                    "helpline. Insurers are required to settle admitted claims within a stipulated "
                    "period after receipt of yield data, and delays beyond that attract interest "
                    "payable to the farmer. Keep the intimation reference number, survey report "
                    "copy and premium receipt, as these are the primary evidence in any dispute."
                ),
                "text_hi": (
                    "दावा खारिज होने या भुगतान में देरी होने पर किसान जिला स्तरीय निगरानी समिति और फिर "
                    "राज्य स्तरीय फसल बीमा समन्वय समिति में शिकायत कर सकता है। शिकायत राष्ट्रीय फसल बीमा "
                    "पोर्टल के शिकायत मॉड्यूल या कृषि रक्षक पोर्टल और हेल्पलाइन पर भी दर्ज हो सकती है। "
                    "बीमा कंपनियों को उपज डेटा मिलने के बाद निर्धारित अवधि में स्वीकृत दावों का भुगतान "
                    "करना होता है, और इससे अधिक देरी पर किसान को ब्याज देना पड़ता है। सूचना संदर्भ संख्या, "
                    "सर्वे रिपोर्ट की प्रति और प्रीमियम रसीद संभालकर रखें — विवाद में यही मुख्य प्रमाण हैं।"
                ),
                "keywords": [
                    "rejected", "delay", "complaint", "grievance", "not received",
                    "खारिज", "देरी", "शिकायत", "नहीं मिला",
                ],
            },
        ],
    },

    # ═══════════════════════════════ PM-KISAN ═══════════════════════════════
    {
        "scheme_id": "pmkisan",
        "title_en": "PM-KISAN (Pradhan Mantri Kisan Samman Nidhi)",
        "title_hi": "पीएम-किसान सम्मान निधि",
        "source_url": "https://pmkisan.gov.in",
        "official": True,
        "aliases": [
            "pm kisan", "pm-kisan", "kisan samman nidhi", "samman nidhi", "6000",
            "सम्मान निधि", "किसान निधि", "किस्त", "installment",
        ],
        "sections": [
            {
                "section_id": "pmkisan.benefit",
                "heading_en": "What you receive",
                "heading_hi": "आपको क्या मिलता है",
                "text_en": (
                    "PM-KISAN provides income support of 6,000 rupees per year to eligible "
                    "land-holding farmer families. It is paid in three equal instalments of 2,000 "
                    "rupees each, roughly every four months, transferred directly into the "
                    "Aadhaar-seeded bank account of the beneficiary. There is no application fee "
                    "and no intermediary is needed. Payment status can be checked on the PM-KISAN "
                    "portal using the registration number, Aadhaar number or mobile number."
                ),
                "text_hi": (
                    "पीएम-किसान पात्र भूमिधारक किसान परिवारों को हर साल 6,000 रुपये की आय सहायता देती है। "
                    "यह 2,000 रुपये की तीन बराबर किस्तों में, लगभग हर चार महीने पर, सीधे लाभार्थी के "
                    "आधार से जुड़े बैंक खाते में भेजी जाती है। कोई आवेदन शुल्क नहीं है और किसी बिचौलिये "
                    "की ज़रूरत नहीं। भुगतान की स्थिति पीएम-किसान पोर्टल पर पंजीकरण संख्या, आधार संख्या "
                    "या मोबाइल नंबर से देखी जा सकती है।"
                ),
                "keywords": ["6000", "2000", "installment", "amount", "किस्त", "राशि", "कितना"],
            },
            {
                "section_id": "pmkisan.ekyc",
                "heading_en": "eKYC is mandatory",
                "heading_hi": "eKYC अनिवार्य है",
                "text_en": (
                    "eKYC is mandatory to receive instalments. It can be completed through OTP-based "
                    "eKYC on the PM-KISAN portal, biometric eKYC at a Common Service Centre, or "
                    "face-authentication eKYC through the PM-KISAN mobile app. Instalments are "
                    "withheld until eKYC is complete. Two other common reasons for a stopped "
                    "instalment are the bank account not being Aadhaar-seeded, and land records "
                    "not having been verified by the state. All three can be checked under the "
                    "beneficiary status page on the portal."
                ),
                "text_hi": (
                    "किस्त पाने के लिए eKYC अनिवार्य है। यह पीएम-किसान पोर्टल पर OTP आधारित eKYC, "
                    "कॉमन सर्विस सेंटर पर बायोमेट्रिक eKYC, या पीएम-किसान मोबाइल ऐप से चेहरा प्रमाणीकरण "
                    "eKYC द्वारा पूरी हो सकती है। eKYC पूरी होने तक किस्त रोक दी जाती है। किस्त रुकने के "
                    "दो और आम कारण हैं: बैंक खाता आधार से न जुड़ा होना, और राज्य द्वारा भूमि रिकॉर्ड का "
                    "सत्यापन न होना। तीनों की जाँच पोर्टल के लाभार्थी स्थिति पेज पर की जा सकती है।"
                ),
                "keywords": [
                    "ekyc", "kyc", "not received", "installment stopped", "pending",
                    "केवाईसी", "किस्त नहीं आई", "रुकी", "लंबित",
                ],
            },
            {
                "section_id": "pmkisan.eligibility",
                "heading_en": "Who is excluded",
                "heading_hi": "कौन पात्र नहीं है",
                "text_en": (
                    "All land-holding farmer families are eligible, subject to exclusions. Excluded "
                    "categories include institutional land holders; former and present holders of "
                    "constitutional posts; serving or retired officers and employees of central or "
                    "state government, public sector undertakings and autonomous bodies, other than "
                    "multi-tasking and Class IV staff; all persons who paid income tax in the last "
                    "assessment year; and retired pensioners with a monthly pension of 10,000 rupees "
                    "or more, other than multi-tasking and Class IV staff. Professionals such as "
                    "doctors, engineers, lawyers, chartered accountants and architects registered "
                    "with professional bodies and practising are also excluded."
                ),
                "text_hi": (
                    "सभी भूमिधारक किसान परिवार पात्र हैं, कुछ अपवादों के साथ। अपात्र श्रेणियों में शामिल हैं: "
                    "संस्थागत भूमिधारक; संवैधानिक पदों पर रहे या रह चुके व्यक्ति; केंद्र या राज्य सरकार, "
                    "सार्वजनिक उपक्रमों और स्वायत्त निकायों के सेवारत या सेवानिवृत्त अधिकारी-कर्मचारी "
                    "(मल्टी-टास्किंग और चतुर्थ श्रेणी कर्मचारियों को छोड़कर); पिछले निर्धारण वर्ष में आयकर "
                    "देने वाले सभी व्यक्ति; और 10,000 रुपये या अधिक मासिक पेंशन पाने वाले सेवानिवृत्त "
                    "पेंशनभोगी (मल्टी-टास्किंग और चतुर्थ श्रेणी को छोड़कर)। पेशेवर निकायों में पंजीकृत और "
                    "कार्यरत डॉक्टर, इंजीनियर, वकील, चार्टर्ड अकाउंटेंट और वास्तुकार भी अपात्र हैं।"
                ),
                "keywords": [
                    "eligible", "eligibility", "who can apply", "excluded", "income tax",
                    "पात्र", "पात्रता", "कौन ले सकता", "अपात्र", "आयकर",
                ],
            },
            {
                "section_id": "pmkisan.apply",
                "heading_en": "How to register",
                "heading_hi": "पंजीकरण कैसे करें",
                "text_en": (
                    "Registration can be done through the New Farmer Registration link on the "
                    "PM-KISAN portal, at a Common Service Centre, or through the village revenue "
                    "officer or nodal officer appointed by the state. Required details are Aadhaar "
                    "number, bank account details with IFSC, and land record particulars including "
                    "survey or khasra number and area. The state government verifies land records "
                    "before the first instalment is released, so registration and first payment "
                    "are usually separated by one payment cycle."
                ),
                "text_hi": (
                    "पंजीकरण पीएम-किसान पोर्टल के नए किसान पंजीकरण लिंक से, कॉमन सर्विस सेंटर पर, या "
                    "राज्य द्वारा नियुक्त पटवारी/नोडल अधिकारी के माध्यम से किया जा सकता है। ज़रूरी "
                    "जानकारी: आधार संख्या, IFSC सहित बैंक खाता विवरण, और खसरा नंबर व रकबा सहित भूमि "
                    "रिकॉर्ड। पहली किस्त जारी होने से पहले राज्य सरकार भूमि रिकॉर्ड का सत्यापन करती है, "
                    "इसलिए पंजीकरण और पहले भुगतान के बीच आमतौर पर एक भुगतान चक्र का अंतर रहता है।"
                ),
                "keywords": ["register", "apply", "new farmer", "पंजीकरण", "आवेदन", "नया किसान"],
            },
        ],
    },

    # ═══════════════════════════════ KCC ═══════════════════════════════
    {
        "scheme_id": "kcc",
        "title_en": "Kisan Credit Card (KCC)",
        "title_hi": "किसान क्रेडिट कार्ड (KCC)",
        "source_url": "https://www.myscheme.gov.in",
        "official": True,
        "aliases": [
            "kcc", "kisan credit card", "crop loan", "farm loan", "किसान क्रेडिट कार्ड",
            "ऋण", "कर्ज", "लोन", "ब्याज",
        ],
        "sections": [
            {
                "section_id": "kcc.benefit",
                "heading_en": "Interest rate and subvention",
                "heading_hi": "ब्याज दर और छूट",
                "text_en": (
                    "KCC provides short-term crop loans at a concessional rate through the interest "
                    "subvention scheme. Under the modified interest subvention scheme, short-term "
                    "crop loans up to 3 lakh rupees carry an effective interest rate of 7 percent "
                    "per annum for the farmer. Farmers who repay promptly on or before the due date "
                    "receive an additional prompt repayment incentive of 3 percent, bringing the "
                    "effective rate down to 4 percent per annum. The prompt repayment incentive is "
                    "lost if the loan becomes overdue, so repaying on time roughly halves the "
                    "interest cost."
                ),
                "text_hi": (
                    "KCC ब्याज सहायता योजना के तहत रियायती दर पर अल्पकालिक फसल ऋण देता है। संशोधित "
                    "ब्याज सहायता योजना के अंतर्गत 3 लाख रुपये तक के अल्पकालिक फसल ऋण पर किसान के लिए "
                    "प्रभावी ब्याज दर 7 प्रतिशत वार्षिक है। नियत तिथि तक समय पर चुकाने वाले किसानों को "
                    "3 प्रतिशत की अतिरिक्त शीघ्र भुगतान प्रोत्साहन छूट मिलती है, जिससे प्रभावी दर घटकर "
                    "4 प्रतिशत वार्षिक रह जाती है। ऋण अतिदेय होने पर यह छूट समाप्त हो जाती है, इसलिए "
                    "समय पर भुगतान ब्याज लागत लगभग आधी कर देता है।"
                ),
                "keywords": [
                    "interest", "rate", "4%", "7%", "subvention", "3 lakh",
                    "ब्याज", "दर", "छूट", "3 लाख",
                ],
            },
            {
                "section_id": "kcc.collateral",
                "heading_en": "Collateral-free limit",
                "heading_hi": "बिना गारंटी की सीमा",
                "text_en": (
                    "Collateral-free agricultural loans are available up to a limit set by the "
                    "Reserve Bank of India, which banks apply as the security-free threshold for "
                    "KCC. Above that limit banks may take a charge on the land or other security. "
                    "Banks cannot insist on collateral below the notified threshold, and a farmer "
                    "asked for security on a small KCC limit should raise it with the branch "
                    "manager or the bank's grievance channel."
                ),
                "text_hi": (
                    "भारतीय रिज़र्व बैंक द्वारा तय सीमा तक कृषि ऋण बिना गारंटी उपलब्ध है, और बैंक इसी को "
                    "KCC के लिए बिना प्रतिभूति की सीमा मानते हैं। इससे ऊपर बैंक भूमि या अन्य प्रतिभूति पर "
                    "भार ले सकते हैं। अधिसूचित सीमा से नीचे बैंक गारंटी पर ज़ोर नहीं दे सकते। छोटी KCC "
                    "सीमा पर प्रतिभूति माँगे जाने पर किसान शाखा प्रबंधक या बैंक की शिकायत व्यवस्था में "
                    "इसे उठा सकता है।"
                ),
                "keywords": [
                    "collateral", "security", "guarantee", "without land",
                    "गारंटी", "प्रतिभूति", "बिना जमीन",
                ],
            },
            {
                "section_id": "kcc.scope",
                "heading_en": "What KCC can be used for",
                "heading_hi": "KCC किन कामों में इस्तेमाल हो सकता है",
                "text_en": (
                    "KCC covers cultivation expenses including seed, fertiliser, pesticide and "
                    "labour, post-harvest expenses, produce marketing loans, consumption needs of "
                    "the farm household, working capital for farm asset maintenance, and investment "
                    "credit for allied activities. Allied activities explicitly covered include "
                    "dairy, poultry, fisheries and animal husbandry, so a farmer with livestock can "
                    "obtain a KCC even without significant crop area."
                ),
                "text_hi": (
                    "KCC में शामिल है: बीज, खाद, कीटनाशक और मजदूरी सहित खेती का खर्च, कटाई के बाद का "
                    "खर्च, उपज विपणन ऋण, किसान परिवार की उपभोग ज़रूरतें, कृषि संपत्ति के रखरखाव के लिए "
                    "कार्यशील पूँजी, और संबद्ध गतिविधियों के लिए निवेश ऋण। संबद्ध गतिविधियों में डेयरी, "
                    "मुर्गीपालन, मत्स्यपालन और पशुपालन स्पष्ट रूप से शामिल हैं, इसलिए पशुधन रखने वाला "
                    "किसान बड़ी फसल भूमि के बिना भी KCC ले सकता है।"
                ),
                "keywords": [
                    "use", "purpose", "dairy", "fisheries", "poultry", "allied",
                    "उपयोग", "डेयरी", "मत्स्य", "मुर्गी", "पशुपालन",
                ],
            },
        ],
    },

    # ═══════════════════════════════ Soil Health Card ═══════════════════════════════
    {
        "scheme_id": "shc",
        "title_en": "Soil Health Card Scheme",
        "title_hi": "मृदा स्वास्थ्य कार्ड योजना",
        "source_url": "https://soilhealth.dac.gov.in",
        "official": True,
        "aliases": [
            "soil health card", "soil test", "shc", "मृदा स्वास्थ्य", "मिट्टी जांच",
            "मिट्टी परीक्षण", "soil testing",
        ],
        "sections": [
            {
                "section_id": "shc.benefit",
                "heading_en": "What the Soil Health Card gives you",
                "heading_hi": "मृदा स्वास्थ्य कार्ड से क्या मिलता है",
                "text_en": (
                    "The Soil Health Card reports the nutrient status of a farmer's plot and gives "
                    "crop-wise fertiliser recommendations based on that specific soil. The card "
                    "covers twelve parameters including nitrogen, phosphorus, potassium, sulphur, "
                    "the micronutrients zinc, iron, copper, manganese and boron, along with pH, "
                    "electrical conductivity and organic carbon. Using the card means applying what "
                    "the soil actually needs rather than a blanket dose, which typically reduces "
                    "fertiliser spend while maintaining or improving yield."
                ),
                "text_hi": (
                    "मृदा स्वास्थ्य कार्ड किसान के खेत की पोषक स्थिति बताता है और उसी मिट्टी के आधार पर "
                    "फसलवार खाद की सिफारिश देता है। कार्ड में बारह मानक शामिल हैं: नाइट्रोजन, फॉस्फोरस, "
                    "पोटैशियम, सल्फर, सूक्ष्म पोषक तत्व जिंक, आयरन, कॉपर, मैंगनीज और बोरॉन, तथा pH, "
                    "विद्युत चालकता और जैविक कार्बन। कार्ड के अनुसार खाद डालने का अर्थ है अंदाज़े की जगह "
                    "मिट्टी की असली ज़रूरत के हिसाब से डालना, जिससे आमतौर पर खाद का खर्च घटता है और उपज "
                    "बनी रहती है या बढ़ती है।"
                ),
                "keywords": [
                    "soil test", "nutrients", "npk", "recommendation", "free",
                    "मिट्टी जांच", "पोषक", "सिफारिश", "मुफ्त",
                ],
            },
            {
                "section_id": "shc.apply",
                "heading_en": "How to get a soil test done",
                "heading_hi": "मिट्टी की जाँच कैसे कराएँ",
                "text_en": (
                    "Soil samples are collected through the state agriculture department, Krishi "
                    "Vigyan Kendras, or soil testing laboratories notified under the scheme. The "
                    "farmer can request sampling at the block agriculture office or through the "
                    "village agriculture extension worker. Samples should be taken before sowing "
                    "and from multiple points across the plot at a depth of about 15 centimetres, "
                    "then mixed to form one composite sample. The card is issued to the farmer "
                    "after laboratory analysis and can also be downloaded from the Soil Health "
                    "Card portal."
                ),
                "text_hi": (
                    "मिट्टी के नमूने राज्य कृषि विभाग, कृषि विज्ञान केंद्र, या योजना के तहत अधिसूचित मृदा "
                    "परीक्षण प्रयोगशालाओं द्वारा लिए जाते हैं। किसान ब्लॉक कृषि कार्यालय या ग्राम कृषि "
                    "विस्तार कर्मी के माध्यम से नमूना लेने का अनुरोध कर सकता है। नमूने बुवाई से पहले, खेत "
                    "के कई हिस्सों से लगभग 15 सेंटीमीटर गहराई से लेकर मिलाकर एक संयुक्त नमूना बनाना "
                    "चाहिए। प्रयोगशाला जाँच के बाद कार्ड किसान को दिया जाता है और मृदा स्वास्थ्य कार्ड "
                    "पोर्टल से डाउनलोड भी किया जा सकता है।"
                ),
                "keywords": [
                    "how to apply", "sample", "where", "kvk",
                    "कैसे कराएँ", "नमूना", "कहाँ", "केवीके",
                ],
            },
        ],
    },

    # ═══════════════════════════════ PM-KUSUM ═══════════════════════════════
    {
        "scheme_id": "kusum",
        "title_en": "PM-KUSUM (Solar Pumps and Grid-Connected Solar)",
        "title_hi": "पीएम-कुसुम (सौर पंप और ग्रिड सौर ऊर्जा)",
        "source_url": "https://pmkusum.mnre.gov.in",
        "official": True,
        "aliases": [
            "kusum", "solar pump", "solar", "सौर पंप", "सोलर", "कुसुम", "सिंचाई पंप",
        ],
        "sections": [
            {
                "section_id": "kusum.components",
                "heading_en": "The three components",
                "heading_hi": "योजना के तीन घटक",
                "text_en": (
                    "PM-KUSUM has three components. Component A supports decentralised "
                    "ground-mounted grid-connected solar power plants set up by farmers on barren "
                    "or fallow land, with the power sold to the distribution company. Component B "
                    "supports standalone solar agriculture pumps replacing diesel pumps in "
                    "off-grid areas. Component C supports solarisation of existing grid-connected "
                    "agriculture pumps, allowing the farmer to use solar power for irrigation and "
                    "sell surplus to the grid. Farmers should identify which component fits their "
                    "situation before applying, since the application route differs."
                ),
                "text_hi": (
                    "पीएम-कुसुम के तीन घटक हैं। घटक A में किसान बंजर या परती भूमि पर विकेंद्रीकृत "
                    "ग्रिड-संबद्ध सौर संयंत्र लगाते हैं और बिजली वितरण कंपनी को बेचते हैं। घटक B में "
                    "ऑफ-ग्रिड क्षेत्रों में डीज़ल पंप की जगह स्टैंडअलोन सौर कृषि पंप लगाए जाते हैं। "
                    "घटक C में मौजूदा ग्रिड-संबद्ध कृषि पंपों का सौरीकरण होता है, जिससे किसान सिंचाई के "
                    "लिए सौर ऊर्जा इस्तेमाल कर सके और अतिरिक्त बिजली ग्रिड को बेच सके। आवेदन का रास्ता "
                    "अलग होता है, इसलिए आवेदन से पहले अपने लिए सही घटक तय करें।"
                ),
                "keywords": [
                    "solar pump", "component", "diesel", "irrigation",
                    "सौर पंप", "घटक", "डीज़ल", "सिंचाई",
                ],
            },
            {
                "section_id": "kusum.apply",
                "heading_en": "Subsidy and how to apply",
                "heading_hi": "सब्सिडी और आवेदन",
                "text_en": (
                    "Central financial assistance and state subsidy together cover a substantial "
                    "share of the cost, with the farmer contributing the balance, often through a "
                    "bank loan. The exact central and state shares vary by component and by state, "
                    "so the applicable figure must be confirmed with the state nodal agency. "
                    "Applications are made through the state renewable energy development agency "
                    "or the state nodal agency portal, not directly to the central ministry. "
                    "Benefits are typically substantial for farmers currently running diesel pumps, "
                    "because the recurring diesel cost disappears."
                ),
                "text_hi": (
                    "केंद्रीय वित्तीय सहायता और राज्य सब्सिडी मिलकर लागत का बड़ा हिस्सा वहन करती हैं, "
                    "बाकी किसान देता है, अक्सर बैंक ऋण के माध्यम से। केंद्र और राज्य का सटीक हिस्सा घटक "
                    "और राज्य के अनुसार बदलता है, इसलिए लागू आँकड़ा राज्य नोडल एजेंसी से पुष्टि करना "
                    "ज़रूरी है। आवेदन राज्य अक्षय ऊर्जा विकास एजेंसी या राज्य नोडल एजेंसी पोर्टल से किया "
                    "जाता है, सीधे केंद्रीय मंत्रालय को नहीं। डीज़ल पंप चला रहे किसानों के लिए लाभ आमतौर "
                    "पर बहुत बड़ा होता है, क्योंकि डीज़ल का लगातार खर्च समाप्त हो जाता है।"
                ),
                "keywords": [
                    "subsidy", "how much", "apply", "nodal agency",
                    "सब्सिडी", "कितनी", "आवेदन", "नोडल एजेंसी",
                ],
            },
        ],
    },

    # ═══════════════════════════════ eNAM ═══════════════════════════════
    {
        "scheme_id": "enam",
        "title_en": "e-NAM (National Agriculture Market)",
        "title_hi": "ई-नाम (राष्ट्रीय कृषि बाज़ार)",
        "source_url": "https://enam.gov.in",
        "official": True,
        "aliases": [
            "enam", "e-nam", "national agriculture market", "online mandi",
            "ई-नाम", "ऑनलाइन मंडी", "राष्ट्रीय कृषि बाज़ार",
        ],
        "sections": [
            {
                "section_id": "enam.benefit",
                "heading_en": "What e-NAM does for a seller",
                "heading_hi": "बेचने वाले किसान के लिए ई-नाम",
                "text_en": (
                    "e-NAM is an online trading platform linking APMC mandis across states into a "
                    "single market. A farmer bringing produce to an integrated mandi has the lot "
                    "assayed for quality, after which buyers from other mandis and states can bid "
                    "online. This widens the buyer pool beyond the local traders present that day, "
                    "which typically improves price discovery. Payment is made directly to the "
                    "farmer's bank account. Registration is free and is done at the integrated "
                    "mandi or on the e-NAM portal with Aadhaar and bank account details."
                ),
                "text_hi": (
                    "ई-नाम एक ऑनलाइन व्यापार मंच है जो देशभर की APMC मंडियों को एक बाज़ार में जोड़ता है। "
                    "एकीकृत मंडी में उपज लाने पर लॉट की गुणवत्ता जाँच होती है, जिसके बाद दूसरी मंडियों और "
                    "राज्यों के खरीदार ऑनलाइन बोली लगा सकते हैं। इससे खरीदारों का दायरा उस दिन मौजूद "
                    "स्थानीय व्यापारियों से आगे बढ़ जाता है और आमतौर पर बेहतर भाव मिलता है। भुगतान सीधे "
                    "किसान के बैंक खाते में होता है। पंजीकरण मुफ्त है और एकीकृत मंडी या ई-नाम पोर्टल पर "
                    "आधार और बैंक खाता विवरण से किया जाता है।"
                ),
                "keywords": [
                    "enam", "online selling", "better price", "auction", "bidding",
                    "ऑनलाइन बेचना", "अच्छा भाव", "नीलामी", "बोली",
                ],
            },
        ],
    },
]