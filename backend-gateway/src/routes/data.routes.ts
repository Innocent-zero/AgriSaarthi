import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';
import { z } from 'zod';
import { swytchcode } from '../services/swytchcodeService';
import { optionalAuth } from '../middleware/auth';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG or WebP images are accepted'));
  },
});

const ML = () => process.env.ML_SERVICE_URL || 'http://localhost:8000';

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

    const { data } = await axios.post(`${ML()}/api/v1/diagnose`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
      maxBodyLength: Infinity,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/data/schemes — Tavily live RAG proxy. */
router.post('/schemes', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z
      .object({
        query: z.string().min(2).max(300),
        state: z.string().max(60).optional(),
        language: z.enum(['hi', 'en']).default('hi'),
      })
      .parse(req.body);
    const { data } = await axios.post(`${ML()}/api/v1/schemes`, body, { timeout: 35000 });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/data/pmfby/report — streams the generated PDF back to the PWA. */
router.post('/pmfby/report', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await axios.post(`${ML()}/api/v1/pmfby/report`, req.body, {
      responseType: 'arraybuffer',
      timeout: 45000,
      headers: { 'Content-Type': 'application/json' },
    });
    const filename = `PMFBY_Claim_${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(response.data));
  } catch (err) {
    next(err);
  }
});

export default router;