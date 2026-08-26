import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { runMandiEngine, MandiEngineInput, engineHealth } from '../services/mandiEngineBridge';
import { mandiDiscovery } from '../services/mandiDiscoveryService';
import { geocoding } from '../services/geocodingService';
import { optionalAuth } from '../middleware/auth';

const router = Router();

const vehicleSchema = z.object({
  kmpl: z.number().positive().max(100).optional(),
  fuelPricePerLitre: z.number().positive().max(1000).optional(),
  capacityQuintals: z.number().min(0).max(10000).optional(),
  hireChargePerTrip: z.number().min(0).max(1000000).optional(),
  roadFactor: z.number().min(1).max(3).optional(),
  avgSpeedKmph: z.number().positive().max(120).optional(),
}).optional();

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
  vehicle: vehicleSchema,
  mandis: z.array(mandiSchema).min(1).max(60),
});

const autoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  crop: z.string().min(1).max(60),
  volumeQuintals: z.number().positive().max(100000),
  radiusKm: z.number().min(10).max(400).optional(),
  localPricePerQuintal: z.number().min(0).max(200000).optional(),
  state: z.string().max(60).optional(),
  district: z.string().max(60).optional(),
  vehicle: vehicleSchema,
});

/**
 * POST /api/v1/mandi/auto
 * Zero-input discovery: farm coordinates and a crop are enough.
 */
router.post('/auto', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = autoSchema.parse(req.body);
    const result = await mandiDiscovery.discover(body);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/mandi/optimize — manual candidate list → C++ engine. */
router.post('/auto', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = autoSchema.parse(req.body);
    const result = await mandiDiscovery.discover(body);
    res.json({ success: true as const, ...result });
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/mandi/locate?lat=&lon= — reverse geocode, used to prefill the UI. */
router.get('/locate', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z.object({
      lat: z.coerce.number().min(-90).max(90),
      lon: z.coerce.number().min(-180).max(180),
    }).parse(req.query);
    res.json({ success: true, location: await geocoding.reverse(q.lat, q.lon) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/mandi/engine-status */
router.get('/engine-status', async (_req: Request, res: Response) => {
  res.json({ success: true, engine: await engineHealth() });
});

export default router;