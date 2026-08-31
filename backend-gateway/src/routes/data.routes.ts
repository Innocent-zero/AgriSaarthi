import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';
import { z } from 'zod';
import { swytchcode } from '../services/swytchcodeService';
import { optionalAuth } from '../middleware/auth';
import { sentinelHub } from '../services/sentinelHubServices';
import { ML_SERVICE_URL } from '../config/services';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG or WebP images are accepted'));
  },
});

/** Shared handler for the "ML service isn't reachable" case across every proxy route below. */
function handleMlProxyError(err: unknown, res: Response, next: NextFunction): void {
  if (axios.isAxiosError(err) && err.code === 'ECONNREFUSED') {
    res.status(503).json({
      success: false,
      error: 'Knowledge service is not running. Start it with: make ml',
      code: 'ML_SERVICE_DOWN',
    });
    return;
  }
  next(err);
}

const coordSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

/** GET /api/v1/data/weather?lat=&lon= */
router.get('/weather', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lat, lon } = coordSchema.parse(req.query);
    res.json({ success: true, weather: await swytchcode.getWeather(lat, lon) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/data/soil?lat=&lon= */
router.get('/soil', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lat, lon } = coordSchema.parse(req.query);
    res.json({ success: true, soil: await swytchcode.getSoil(lat, lon) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/data/prices?state=&commodity=&district= */
router.get('/prices', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z
      .object({
        state: z.string().min(1),
        commodity: z.string().min(1),
        district: z.string().optional(),
      })
      .parse(req.query);
    const tickers = await swytchcode.getMandiPrices(q.state, q.commodity, q.district);
    res.json({ success: true, count: tickers.length, tickers });
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/data/diagnose — multipart image → SVM microservice. */
router.post('/diagnose', optionalAuth, upload.single('image'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No image uploaded under field "image"' });
      return;
    }
    const form = new FormData();
    form.append('image', req.file.buffer, {
      filename: req.file.originalname || 'leaf.jpg',
      contentType: req.file.mimetype,
    });
    if (req.body?.crop) form.append('crop', String(req.body.crop));
    if (req.body?.language) form.append('language', String(req.body.language));

    const { data } = await axios.post(`${ML_SERVICE_URL}/api/v1/diagnose`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
      maxBodyLength: Infinity,
    });
    res.json(data);
  } catch (err) {
    handleMlProxyError(err, res, next);
  }
});

// Fallback used whenever a caller (frontend, or an LLM-generated action)
// sends a missing/blank/too-short query. Never reject the request outright
// for this — degrade to a broad scheme search instead, in both languages.
const GENERIC_SCHEME_QUERY: Record<'hi' | 'en', string> = {
  hi: 'किसानों के लिए सरकारी योजनाएं और लाभ',
  en: 'government schemes and benefits for farmers',
};

const schemeQuerySchema = z.object({
  query: z.string().trim().max(300).optional().default(''),
  state: z.string().trim().max(60).optional(),
  language: z.enum(['hi', 'en']).default('hi'),
}).transform((v) => ({
  ...v,
  query: v.query.length >= 2 ? v.query : GENERIC_SCHEME_QUERY[v.language],
}));

/** POST /api/v1/data/schemes — Tavily live RAG proxy. */
router.post('/schemes', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = schemeQuerySchema.parse(req.body);
    const { data } = await axios.post(`${ML_SERVICE_URL}/api/v1/schemes`, body, { timeout: 35000 });
    res.json(data);
  } catch (err) {
    handleMlProxyError(err, res, next);
  }
});

const ragQuerySchema = z.object({
  query: z.string().trim().max(300).optional().default(''),
  language: z.enum(['hi', 'en']).default('hi'),
  schemeId: z.string().max(40).optional(),
  k: z.number().int().min(1).max(8).default(4),
}).transform((v) => ({
  ...v,
  query: v.query.length >= 2 ? v.query : GENERIC_SCHEME_QUERY[v.language],
}));

/** POST /api/v1/data/rag — direct knowledge-base query. */
router.post('/rag', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = ragQuerySchema.parse(req.body);

    const { data } = await axios.post(`${ML_SERVICE_URL}/api/v1/rag/query`, {
      query: body.query,
      language: body.language,
      scheme_id: body.schemeId,
      k: body.k,
    }, { timeout: 20000 });

    res.json(data);
  } catch (err) {
    handleMlProxyError(err, res, next);
  }
});

/** POST /api/v1/data/pmfby/claim-check — grounded eligibility screen. */
router.post('/pmfby/claim-check', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      cause: z.string().min(2).max(200),
      eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      estimatedLossPct: z.number().min(0).max(100),
      language: z.enum(['hi', 'en']).default('hi'),
    }).parse(req.body);

    const { data } = await axios.post(`${ML_SERVICE_URL}/api/v1/pmfby/claim-check`, {
      cause: body.cause,
      event_date: body.eventDate,
      estimated_loss_pct: body.estimatedLossPct,
      language: body.language,
    }, { timeout: 20000 });

    res.json(data);
  } catch (err) {
    handleMlProxyError(err, res, next);
  }
});

/** POST /api/v1/data/ndvi/event — observed pre/post NDVI around a damage date. */
router.post('/ndvi/event', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      boundary: z.array(z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      })).max(60).optional(),
    }).parse(req.body);

    const pair = await sentinelHub.getEventPair(
      { lat: body.lat, lon: body.lon },
      body.boundary,
      body.eventDate,
    );

    res.json({ success: true, ...pair });
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/data/pmfby/report — streams the generated PDF back to the PWA. */
router.post('/pmfby/report', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await axios.post(`${ML_SERVICE_URL}/api/v1/pmfby/report`, req.body, {
      responseType: 'arraybuffer',
      timeout: 45000,
      headers: { 'Content-Type': 'application/json' },
    });
    const filename = `PMFBY_Claim_${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(response.data));
  } catch (err) {
    handleMlProxyError(err, res, next);
  }
});

export default router;