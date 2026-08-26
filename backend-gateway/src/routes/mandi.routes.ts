import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { runMandiEngine, MandiEngineInput, engineHealth } from '../services/mandiEngineBridge';
import { swytchcode } from '../services/swytchcodeService';
import { optionalAuth } from '../middleware/auth';

const router = Router();

const mandiSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().min(1).max(120),
  district: z.string().max(80).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  distanceKm: z.number().min(0).max(2000).optional(),
  pricePerQuintal: z.number().positive().max(200000),
  handlingFee: z.number().min(0).max(100000).optional(),
  loadingChargePerQuintal: z.number().min(0).max(5000).optional(),
  commissionPct: z.number().min(0).max(25).optional(),
});

const optimizeSchema = z.object({
  origin: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  volumeQuintals: z.number().positive().max(100000),
  crop: z.string().max(60).optional(),
  localPricePerQuintal: z.number().min(0).max(200000).optional(),
  vehicle: z
    .object({
      kmpl: z.number().positive().max(100).optional(),
      fuelPricePerLitre: z.number().positive().max(1000).optional(),
      capacityQuintals: z.number().min(0).max(10000).optional(),
      hireChargePerTrip: z.number().min(0).max(1000000).optional(),
      roadFactor: z.number().min(1).max(3).optional(),
      avgSpeedKmph: z.number().positive().max(120).optional(),
    })
    .optional(),
  mandis: z.array(mandiSchema).min(1).max(60),
});

const discoverSchema = z.object({
  origin: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  volumeQuintals: z.number().positive().max(100000),
  crop: z.string().min(1).max(60),
  state: z.string().min(1).max(60),
  district: z.string().max(60).optional(),
  localPricePerQuintal: z.number().min(0).max(200000).optional(),
  vehicle: optimizeSchema.shape.vehicle,
});

/** POST /api/v1/mandi/optimize — explicit candidate list → C++ engine. */
router.post('/optimize', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = optimizeSchema.parse(req.body) as MandiEngineInput;
    const result = await runMandiEngine(input);
    res.json({ ...result, success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/mandi/discover
 * Pulls live APMC tickers via Swytchcode, geocodes nothing (uses reported
 * district centroids when coordinates are absent), then ranks through C++.
 */
router.post('/discover', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = discoverSchema.parse(req.body);
    const tickers = await swytchcode.getMandiPrices(body.state, body.crop, body.district);

    if (tickers.length === 0) {
      res.status(404).json({
        success: false,
        error: `No live price feed found for ${body.crop} in ${body.state}. Enter mandi rates manually to compare.`,
      });
      return;
    }

    // Deduplicate by market, keeping the highest modal price of the day.
    const byMarket = new Map<string, (typeof tickers)[number]>();
    for (const t of tickers) {
      const prev = byMarket.get(t.market);
      if (!prev || t.modalPrice > prev.modalPrice) byMarket.set(t.market, t);
    }

    const engineInput: MandiEngineInput = {
      origin: body.origin,
      volumeQuintals: body.volumeQuintals,
      crop: body.crop,
      localPricePerQuintal: body.localPricePerQuintal,
      vehicle: body.vehicle,
      mandis: Array.from(byMarket.values())
        .slice(0, 25)
        .map((t, i) => ({
          id: `apmc_${i + 1}`,
          name: t.market,
          district: t.district,
          pricePerQuintal: t.modalPrice,
          handlingFee: 150,
          loadingChargePerQuintal: 12,
          commissionPct: 1.5,
          // Without APMC coordinates the engine needs a distance hint; the UI
          // lets the farmer correct it, and corrections flow back through /optimize.
          distanceKm: undefined,
        })),
    };

    const result = await runMandiEngine(engineInput);
    res.json({
      ...result,
      success: true,
      note: 'Distances default to 0 km until you set each mandi distance. Adjust and re-run for exact net profit.',
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/mandi/engine-status */
router.get('/engine-status', async (_req: Request, res: Response) => {
  res.json({ success: true, engine: await engineHealth() });
});

export default router;