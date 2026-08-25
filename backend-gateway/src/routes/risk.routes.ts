/**
 * Farm Risk Analytics.
 *
 * Composes the live weather feed, soil profile and market spread into six
 * scored risk factors plus a weighted overall index. Every string is a
 * translation code — no prose crosses the wire.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { swytchcode } from '../services/swytchcodeService';
import { optionalAuth } from '../middleware/auth';

const router = Router();

const schema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  crop: z.string().max(60).optional(),
  state: z.string().max(60).optional(),
});

type Band = 'low' | 'moderate' | 'high' | 'severe';

interface Factor {
  key: string;          // translation code for the factor name
  score: number;        // 0–100
  band: Band;
  detail: { code: string; params?: Record<string, string | number> };
}

const band = (s: number): Band =>
  s >= 75 ? 'severe' : s >= 50 ? 'high' : s >= 25 ? 'moderate' : 'low';

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

router.get('/assess', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = schema.parse(req.query);
    const wx = await swytchcode.getWeather(q.lat, q.lon);
    const soil = await swytchcode.getSoil(q.lat, q.lon);

    const week = wx.daily.slice(0, 7);
    const rain7 = week.reduce((s, d) => s + d.rainMm, 0);
    const maxTemp = Math.max(0, ...week.map((d) => d.tMaxC));
    const maxWind = Math.max(0, ...week.map((d) => d.windMaxKmh));
    const humid = wx.current.humidityPct;
    const temp = wx.current.temperatureC;

    const factors: Factor[] = [];

    // 1. Excess rain / waterlogging — clay soils drain poorly, so they score higher.
    const drainagePenalty = soil.clayPct >= 35 ? 1.35 : soil.sandPct >= 60 ? 0.7 : 1;
    factors.push({
      key: 'risk.factor.rain',
      score: clamp((rain7 / 90) * 100 * drainagePenalty),
      band: band(clamp((rain7 / 90) * 100 * drainagePenalty)),
      detail: { code: 'wx.delayUrea', params: { rain: rain7.toFixed(0) } },
    });

    // 2. Moisture stress — dry week plus heat, worse on sandy soil.
    const dryScore = rain7 < 5 ? clamp((maxTemp - 28) * 6 * (soil.sandPct >= 60 ? 1.3 : 1)) : 0;
    factors.push({
      key: 'risk.factor.drought',
      score: dryScore,
      band: band(dryScore),
      detail: { code: 'wx.irrigateEarly' },
    });

    // 3. Heat stress
    const heat = clamp((maxTemp - 33) * 12);
    factors.push({
      key: 'risk.factor.heat',
      score: heat,
      band: band(heat),
      detail: { code: 'wx.heatStress' },
    });

    // 4. Wind damage
    const wind = clamp((maxWind - 15) * 3.2);
    factors.push({
      key: 'risk.factor.wind',
      score: wind,
      band: band(wind),
      detail: { code: 'wx.windNoSpray', params: { wind: maxWind.toFixed(0) } },
    });

    // 5. Fungal pressure — humidity in the 22–32 °C band is the danger zone.
    const inBand = temp >= 22 && temp <= 32;
    const disease = clamp(inBand ? (humid - 55) * 2.2 + (rain7 > 20 ? 15 : 0) : (humid - 75) * 1.4);
    factors.push({
      key: 'risk.factor.disease',
      score: disease,
      band: band(disease),
      detail: { code: 'wx.blightRisk' },
    });

    // 6. Price volatility — spread across live/seed tickers for this crop.
    let priceScore = 0;
    let spreadPct = 0;
    if (q.crop && q.state) {
      try {
        const tickers = await swytchcode.getMandiPrices(q.state, q.crop);
        const modal = tickers.map((t) => t.modalPrice).filter((p) => p > 0);
        if (modal.length >= 2) {
          const lo = Math.min(...modal);
          const hi = Math.max(...modal);
          spreadPct = ((hi - lo) / lo) * 100;
          priceScore = clamp(spreadPct * 4);
        }
      } catch { /* market feed is optional for the risk view */ }
    }
    factors.push({
      key: 'risk.factor.price',
      score: priceScore,
      band: band(priceScore),
      detail: { code: 'mandi.verdict.ok' },
    });

    // Weighted composite — weather dominates because it is the near-term threat.
    const weights: Record<string, number> = {
      'risk.factor.rain': 0.22,
      'risk.factor.drought': 0.18,
      'risk.factor.heat': 0.16,
      'risk.factor.wind': 0.12,
      'risk.factor.disease': 0.22,
      'risk.factor.price': 0.10,
    };
    const overall = clamp(
      factors.reduce((s, f) => s + f.score * (weights[f.key] ?? 0), 0),
    );

    // Top three actionable items, highest risk first.
    const actions = [...factors]
      .filter((f) => f.score >= 25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((f) => f.detail);

    res.json({
      success: true,
      overall,
      overallBand: band(overall),
      factors: factors.sort((a, b) => b.score - a.score),
      actions: actions.length ? actions : [{ code: 'wx.stable' }],
      context: {
        rain7Mm: Number(rain7.toFixed(1)),
        maxTempC: Number(maxTemp.toFixed(1)),
        maxWindKmh: Number(maxWind.toFixed(1)),
        humidityPct: humid,
        textureCode: soil.textureCode,
        priceSpreadPct: Number(spreadPct.toFixed(1)),
      },
      assessedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;