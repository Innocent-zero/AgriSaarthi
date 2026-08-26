/**
 * Farm Risk Analytics.
 *
 * Composes satellite vegetation state, live weather, soil profile and market
 * spread into scored risk factors plus a weighted composite index.
 *
 * Vegetation carries the most weight because NDVI is an observation of the
 * actual field, whereas every other factor is an inference about conditions
 * the field is exposed to. When NDVI is unavailable its weight is redistributed
 * across the remaining factors rather than silently scoring zero.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { swytchcode } from '../services/swytchcodeService';
import { sentinelHub, NdviPoint } from '../services/sentinelHubServices';
import { optionalAuth } from '../middleware/auth';

const router = Router();

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const bodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  crop: z.string().max(60).optional(),
  state: z.string().max(60).optional(),
  boundary: z.array(pointSchema).max(60).optional(),
});

type Band = 'low' | 'moderate' | 'high' | 'severe';

interface Factor {
  key: string;
  score: number;
  band: Band;
  weight: number;
  detail: { code: string; params?: Record<string, string | number> };
  evidence?: string;
}

const band = (s: number): Band =>
  s >= 75 ? 'severe' : s >= 50 ? 'high' : s >= 25 ? 'moderate' : 'low';

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const BASE_WEIGHTS: Record<string, number> = {
  'risk.factor.vegetation': 0.26,
  'risk.factor.trend': 0.14,
  'risk.factor.rain': 0.14,
  'risk.factor.drought': 0.12,
  'risk.factor.heat': 0.11,
  'risk.factor.disease': 0.13,
  'risk.factor.wind': 0.06,
  'risk.factor.price': 0.04,
};

router.post('/assess', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = bodySchema.parse(req.body);
    const centre = { lat: q.lat, lon: q.lon };

    // Fetch in parallel — NDVI is the slow one and must not serialise behind soil.
    const [wx, soil, ndvi] = await Promise.all([
      swytchcode.getWeather(q.lat, q.lon),
      swytchcode.getSoil(q.lat, q.lon),
      sentinelHub.getNdviAnalysis(centre, q.boundary),
    ]);

    const week = wx.daily.slice(0, 7);
    const rain7 = week.reduce((s, d) => s + d.rainMm, 0);
    const maxTemp = Math.max(0, ...week.map((d) => d.tMaxC));
    const maxWind = Math.max(0, ...week.map((d) => d.windMaxKmh));
    const humid = wx.current.humidityPct;
    const temp = wx.current.temperatureC;

    const factors: Factor[] = [];
    const w = { ...BASE_WEIGHTS };

    // ── 1. Vegetation vigour, from the NDVI anomaly ──
    if (ndvi.available && !ndvi.mixedPixels && ndvi.anomalyZ !== null && ndvi.baselineSamples >= 2) {
      // point in the calendar. −2σ is a serious departure from normal.
      const z = ndvi.anomalyZ;
      const score = clamp(z >= 0 ? Math.max(0, 12 - z * 8) : Math.min(100, -z * 34));
      factors.push({
        key: 'risk.factor.vegetation',
        score,
        band: band(score),
        weight: w['risk.factor.vegetation'],
        detail: score >= 50
          ? { code: 'risk.detail.vegLow', params: { z: z.toFixed(1) } }
          : { code: 'risk.detail.vegNormal' },
        evidence: `NDVI ${ndvi.current?.mean.toFixed(3)} vs ${ndvi.baselineMean?.toFixed(3)} baseline (${ndvi.baselineSamples} prior observations)`,
      });
    } else if (ndvi.available && ndvi.current) {
      // History too thin for an anomaly — fall back to absolute vigour, which
      // is cruder because it ignores growth stage.
      const m = ndvi.current.mean;
      const score = clamp(m >= 0.6 ? 8 : m >= 0.45 ? 25 : m >= 0.3 ? 50 : m >= 0.2 ? 70 : 88);
      factors.push({
        key: 'risk.factor.vegetation',
        score,
        band: band(score),
        weight: w['risk.factor.vegetation'],
        detail: { code: 'risk.detail.vegAbsolute', params: { ndvi: m.toFixed(2) } },
        evidence: `NDVI ${m.toFixed(3)}, no multi-year baseline yet`,
      });
    } else {
      delete w['risk.factor.vegetation'];
      delete w['risk.factor.trend'];
    }

    // ── 2. Vegetation trend ──
    if (ndvi.available && ndvi.trendPerInterval !== null) {
      const slope = ndvi.trendPerInterval;
      const dropPct = ndvi.dropFromPeakPct ?? 0;
      // A falling slope matters most when it compounds a drop from peak.
      const slopeScore = slope < 0 ? Math.min(100, -slope * 900) : 0;
      const dropScore = dropPct > 15 ? Math.min(100, (dropPct - 15) * 2.2) : 0;
      const score = clamp(Math.max(slopeScore, dropScore));
      factors.push({
        key: 'risk.factor.trend',
        score,
        band: band(score),
        weight: w['risk.factor.trend'] ?? 0,
        detail: score >= 50
          ? { code: 'risk.detail.trendFalling', params: { drop: dropPct.toFixed(0) } }
          : { code: 'risk.detail.trendStable' },
        evidence: `slope ${slope.toFixed(4)}/interval, ${dropPct.toFixed(0)}% below season peak`,
      });
    }

    // ── 3. Excess rain / waterlogging ──
    const drainage = soil.clayPct >= 35 ? 1.35 : soil.sandPct >= 60 ? 0.7 : 1;
    const rainScore = clamp((rain7 / 90) * 100 * drainage);
    const textureLabel = soil.texture ? soil.texture.replace('soil.', '') : 'unknown texture';
    factors.push({
      key: 'risk.factor.rain',
      score: rainScore,
      band: band(rainScore),
      weight: w['risk.factor.rain'],
      detail: rainScore >= 40
        ? { code: 'wx.delayUrea', params: { rain: rain7.toFixed(0) } }
        : { code: 'risk.detail.rainOk' },
      evidence: `${rain7.toFixed(0)} mm forecast over 7 days on ${textureLabel}`,
    });

    // ── 4. Moisture stress ──
    const dryScore = rain7 < 5
      ? clamp((maxTemp - 28) * 6 * (soil.sandPct >= 60 ? 1.3 : 1))
      : 0;
    factors.push({
      key: 'risk.factor.drought',
      score: dryScore,
      band: band(dryScore),
      weight: w['risk.factor.drought'],
      detail: dryScore >= 40 ? { code: 'wx.irrigateEarly' } : { code: 'risk.detail.moistureOk' },
      evidence: `${rain7.toFixed(0)} mm rain, peak ${maxTemp.toFixed(0)}°C`,
    });

    // ── 5. Heat stress ──
    const heat = clamp((maxTemp - 33) * 12);
    factors.push({
      key: 'risk.factor.heat',
      score: heat,
      band: band(heat),
      weight: w['risk.factor.heat'],
      detail: heat >= 40 ? { code: 'wx.heatStress' } : { code: 'risk.detail.heatOk' },
      evidence: `peak ${maxTemp.toFixed(0)}°C this week`,
    });

    // ── 6. Fungal disease pressure ──
    const inBand = temp >= 22 && temp <= 32;
    let disease = clamp(inBand ? (humid - 55) * 2.2 + (rain7 > 20 ? 15 : 0) : (humid - 75) * 1.4);
    // Canopy density raises humidity at leaf level, so a dense crop under
    // humid conditions carries more disease pressure than the air reading alone.
    if (ndvi.current && ndvi.current.mean > 0.6 && disease > 20) disease = clamp(disease * 1.2);
    factors.push({
      key: 'risk.factor.disease',
      score: disease,
      band: band(disease),
      weight: w['risk.factor.disease'],
      detail: disease >= 40 ? { code: 'wx.blightRisk' } : { code: 'risk.detail.diseaseOk' },
      evidence: `${humid.toFixed(0)}% humidity at ${temp.toFixed(0)}°C`,
    });

    // ── 7. Wind damage ──
    const wind = clamp((maxWind - 15) * 3.2);
    factors.push({
      key: 'risk.factor.wind',
      score: wind,
      band: band(wind),
      weight: w['risk.factor.wind'],
      detail: wind >= 40
        ? { code: 'wx.windNoSpray', params: { wind: maxWind.toFixed(0) } }
        : { code: 'risk.detail.windOk' },
      evidence: `peak gusts ${maxWind.toFixed(0)} km/h`,
    });

    // ── 8. Price volatility ──
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
      } catch { /* market feed is optional here */ }
    }
    factors.push({
      key: 'risk.factor.price',
      score: priceScore,
      band: band(priceScore),
      weight: w['risk.factor.price'],
      detail: priceScore >= 40
        ? { code: 'risk.detail.priceVolatile', params: { spread: spreadPct.toFixed(0) } }
        : { code: 'risk.detail.priceStable' },
      evidence: `${spreadPct.toFixed(0)}% spread across markets`,
    });

    // ── Composite: renormalise so a missing factor redistributes its weight ──
    const active = factors.filter((f) => w[f.key] !== undefined);
    const totalWeight = active.reduce((s, f) => s + (w[f.key] ?? 0), 0) || 1;
    const overall = clamp(
      active.reduce((s, f) => s + f.score * ((w[f.key] ?? 0) / totalWeight), 0),
    );

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
      ndvi: {
        available: ndvi.available,
        reason: ndvi.reason,
        current: ndvi.current,
        baselineMean: ndvi.baselineMean,
        anomaly: ndvi.anomaly,
        anomalyZ: ndvi.anomalyZ,
        trendPerInterval: ndvi.trendPerInterval,
        dropFromPeakPct: ndvi.dropFromPeakPct,
        seasonPeak: ndvi.seasonPeak,
        // Last ~18 intervals is roughly six months — enough to draw a curve
        // without shipping three years of points to a 2G client.
        sparkline: ndvi.series.slice(-18).map((p: NdviPoint) => ({
          date: p.from, mean: p.mean, validPixelPct: p.validPixelPct,
        })),
      },
      context: {
        rain7Mm: Number(rain7.toFixed(1)),
        maxTempC: Number(maxTemp.toFixed(1)),
        maxWindKmh: Number(maxWind.toFixed(1)),
        humidityPct: humid,
        textureCode: soil.texture,
        priceSpreadPct: Number(spreadPct.toFixed(1)),
      },
      assessedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;