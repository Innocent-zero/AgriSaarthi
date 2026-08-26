/**
 * Scheme eligibility and recommendation.
 *
 * Answers "what should this farmer apply for right now" rather than "tell me
 * about scheme X". Relevance is scored from the farm profile plus live
 * conditions — a solar pump scheme matters more to someone running a diesel
 * pump in a dry week, and crop insurance matters most inside the enrolment
 * window before sowing.
 *
 * Scoring is deterministic and explainable: every recommendation carries the
 * reasons that produced it. Details come from the RAG knowledge base, so the
 * text a farmer reads is grounded in scheme documents rather than generated.
 */
import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { swytchcode } from '../services/swytchcodeService';
import { optionalAuth } from '../middleware/auth';

const router = Router();

const ML = () => process.env.ML_SERVICE_URL || 'http://127.0.0.1:8010';

const bodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  crop: z.string().max(60).optional(),
  areaHa: z.number().positive().max(10000).optional(),
  state: z.string().max(60).optional(),
  language: z.enum(['hi', 'en']).default('hi'),
  // Optional self-reported context. Absent means "unknown", never "no".
  hasKcc: z.boolean().optional(),
  hasInsurance: z.boolean().optional(),
  hasSoilCard: z.boolean().optional(),
  irrigationSource: z.enum(['diesel', 'electric', 'canal', 'rainfed', 'solar']).optional(),
  landOwned: z.boolean().optional(),
});

type Urgency = 'act_now' | 'this_season' | 'anytime';

interface Recommendation {
  schemeId: string;
  titleCode: string;
  benefitCode: string;
  urgency: Urgency;
  score: number;
  reasonCodes: Array<{ code: string; params?: Record<string, string | number> }>;
  actionCode: string;
  portalUrl: string;
  estValueCode?: string;
  estValueParams?: Record<string, string | number>;
}

/** Kharif and rabi enrolment windows, by month index (0 = January). */
const KHARIF_ENROL = [5, 6];        // Jun–Jul
const RABI_ENROL = [10, 11];        // Nov–Dec
const KHARIF_CROPS = ['rice', 'paddy', 'maize', 'cotton', 'soybean', 'sugarcane'];
const RABI_CROPS = ['wheat', 'mustard', 'potato', 'gram', 'barley'];

router.post('/recommend', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = bodySchema.parse(req.body);
    const month = new Date().getMonth();
    const cropLower = (q.crop ?? '').toLowerCase();

    // Live conditions sharpen the ranking — a dry week makes irrigation
    // schemes more urgent than they would be in the abstract.
    let rain7 = 0;
    let maxTemp = 0;
    try {
      const wx = await swytchcode.getWeather(q.lat, q.lon);
      const week = wx.daily.slice(0, 7);
      rain7 = week.reduce((s, d) => s + d.rainMm, 0);
      maxTemp = Math.max(0, ...week.map((d) => d.tMaxC));
    } catch { /* weather is a modifier, not a requirement */ }

    const recs: Recommendation[] = [];

    // ── PM-KISAN — applies to essentially every landholding farmer ──
    {
      const reasons: Recommendation['reasonCodes'] = [
        { code: 'scheme.reason.allLandholders' },
      ];
      let score = 70;
      if (q.landOwned === false) {
        score = 20;
        reasons.push({ code: 'scheme.reason.needsLandRecord' });
      }
      recs.push({
        schemeId: 'pmkisan',
        titleCode: 'scheme.pmkisan.title',
        benefitCode: 'scheme.pmkisan.benefit',
        urgency: 'anytime',
        score,
        reasonCodes: reasons,
        actionCode: 'scheme.pmkisan.action',
        portalUrl: 'https://pmkisan.gov.in',
        estValueCode: 'scheme.value.perYear',
        estValueParams: { amount: '6,000' },
      });
    }

    // ── PMFBY — sharply time-bound, so the window drives the score ──
    {
      const isKharifCrop = KHARIF_CROPS.some((c) => cropLower.includes(c));
      const isRabiCrop = RABI_CROPS.some((c) => cropLower.includes(c));
      const inKharifWindow = KHARIF_ENROL.includes(month);
      const inRabiWindow = RABI_ENROL.includes(month);
      const inWindow = (isKharifCrop && inKharifWindow) || (isRabiCrop && inRabiWindow)
        || (!q.crop && (inKharifWindow || inRabiWindow));

      const reasons: Recommendation['reasonCodes'] = [];
      let score = 55;
      let urgency: Urgency = 'this_season';

      if (inWindow) {
        score = 95;
        urgency = 'act_now';
        reasons.push({ code: 'scheme.reason.enrolWindowOpen' });
      } else {
        reasons.push({ code: 'scheme.reason.enrolWindowClosed' });
      }

      if (q.hasInsurance === true) {
        score -= 45;
        reasons.push({ code: 'scheme.reason.alreadyInsured' });
      }
      if (q.crop) {
        reasons.push({
          code: 'scheme.reason.premiumCap',
          params: { crop: q.crop, pct: isRabiCrop ? '1.5' : '2' },
        });
      }

      recs.push({
        schemeId: 'pmfby',
        titleCode: 'scheme.pmfby.title',
        benefitCode: 'scheme.pmfby.benefit',
        urgency,
        score,
        reasonCodes: reasons,
        actionCode: 'scheme.pmfby.action',
        portalUrl: 'https://pmfby.gov.in',
        estValueCode: 'scheme.value.premiumPct',
        estValueParams: { pct: isRabiCrop ? '1.5' : '2' },
      });
    }

    // ── KCC ──
    {
      const reasons: Recommendation['reasonCodes'] = [
        { code: 'scheme.reason.cheapCredit' },
      ];
      let score = 72;
      if (q.hasKcc === true) {
        score = 15;
        reasons.push({ code: 'scheme.reason.alreadyHasKcc' });
      } else if (KHARIF_ENROL.includes(month) || RABI_ENROL.includes(month)) {
        score = 88;
        reasons.push({ code: 'scheme.reason.sowingCostsAhead' });
      }
      recs.push({
        schemeId: 'kcc',
        titleCode: 'scheme.kcc.title',
        benefitCode: 'scheme.kcc.benefit',
        urgency: score >= 85 ? 'act_now' : 'this_season',
        score,
        reasonCodes: reasons,
        actionCode: 'scheme.kcc.action',
        portalUrl: 'https://www.myscheme.gov.in',
        estValueCode: 'scheme.value.interestRate',
        estValueParams: { rate: '4' },
      });
    }

    // ── Soil Health Card ──
    {
      const reasons: Recommendation['reasonCodes'] = [
        { code: 'scheme.reason.freeSoilTest' },
      ];
      let score = 60;
      if (q.hasSoilCard === true) {
        score = 10;
        reasons.push({ code: 'scheme.reason.alreadyHasCard' });
      } else if (KHARIF_ENROL.includes(month) || RABI_ENROL.includes(month)) {
        // Sampling must happen before sowing to be useful this season.
        score = 80;
        reasons.push({ code: 'scheme.reason.testBeforeSowing' });
      }
      recs.push({
        schemeId: 'shc',
        titleCode: 'scheme.shc.title',
        benefitCode: 'scheme.shc.benefit',
        urgency: score >= 75 ? 'act_now' : 'anytime',
        score,
        reasonCodes: reasons,
        actionCode: 'scheme.shc.action',
        portalUrl: 'https://soilhealth.dac.gov.in',
        estValueCode: 'scheme.value.free',
      });
    }

    // ── PM-KUSUM — most valuable to diesel pump users ──
    {
      const reasons: Recommendation['reasonCodes'] = [];
      let score = 45;

      if (q.irrigationSource === 'diesel') {
        score = 90;
        reasons.push({ code: 'scheme.reason.dieselCostly' });
      } else if (q.irrigationSource === 'solar') {
        score = 5;
        reasons.push({ code: 'scheme.reason.alreadySolar' });
      } else if (q.irrigationSource === 'electric') {
        score = 65;
        reasons.push({ code: 'scheme.reason.solariseExisting' });
      } else {
        reasons.push({ code: 'scheme.reason.cutIrrigationCost' });
      }

      if (rain7 < 5 && maxTemp > 33 && q.irrigationSource !== 'solar') {
        score += 8;
        reasons.push({ code: 'scheme.reason.dryWeekAhead', params: { rain: rain7.toFixed(0) } });
      }

      recs.push({
        schemeId: 'kusum',
        titleCode: 'scheme.kusum.title',
        benefitCode: 'scheme.kusum.benefit',
        urgency: score >= 85 ? 'this_season' : 'anytime',
        score: Math.min(100, score),
        reasonCodes: reasons,
        actionCode: 'scheme.kusum.action',
        portalUrl: 'https://pmkusum.mnre.gov.in',
        estValueCode: 'scheme.value.subsidy',
      });
    }

    // ── e-NAM — worth it when local price spread is wide ──
    {
      const reasons: Recommendation['reasonCodes'] = [];
      let score = 50;

      if (q.crop && q.state) {
        try {
          const tickers = await swytchcode.getMandiPrices(q.state, q.crop);
          const modal = tickers.map((t) => t.modalPrice).filter((p) => p > 0);
          if (modal.length >= 2) {
            const lo = Math.min(...modal);
            const hi = Math.max(...modal);
            const spread = ((hi - lo) / lo) * 100;
            if (spread > 8) {
              score = 78;
              reasons.push({ code: 'scheme.reason.wideSpread', params: { spread: spread.toFixed(0) } });
            }
          }
        } catch { /* optional signal */ }
      }
      if (reasons.length === 0) reasons.push({ code: 'scheme.reason.moreBuyers' });

      recs.push({
        schemeId: 'enam',
        titleCode: 'scheme.enam.title',
        benefitCode: 'scheme.enam.benefit',
        urgency: 'anytime',
        score,
        reasonCodes: reasons,
        actionCode: 'scheme.enam.action',
        portalUrl: 'https://enam.gov.in',
        estValueCode: 'scheme.value.free',
      });
    }

    recs.sort((a, b) => b.score - a.score);

    res.json({
      success: true,
      recommendations: recs,
      context: {
        month,
        crop: q.crop,
        rain7Mm: Number(rain7.toFixed(1)),
        inEnrolmentWindow: KHARIF_ENROL.includes(month) || RABI_ENROL.includes(month),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/schemes/detail — grounded answer about one scheme. */
router.post('/detail', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      schemeId: z.string().min(2).max(40),
      question: z.string().min(2).max(300).optional(),
      language: z.enum(['hi', 'en']).default('hi'),
    }).parse(req.body);

    const query = body.question
      || `${body.schemeId} eligibility documents how to apply benefit amount`;

    const { data } = await axios.post(`${ML()}/api/v1/rag/query`, {
      query,
      language: body.language,
      scheme_id: body.schemeId,
      k: 4,
    }, { timeout: 20000 });

    res.json(data);
  } catch (err) {
    if (axios.isAxiosError(err) && err.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: 'Knowledge service is not running.',
        code: 'ML_SERVICE_DOWN',
      });
      return;
    }
    next(err);
  }
});

export default router;