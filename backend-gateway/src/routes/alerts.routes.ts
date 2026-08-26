/**
 * n8n integration.
 *  ← inbound : n8n posts monitoring events; gateway enriches with live weather
 *              and returns a farmer-ready alert payload for downstream SMS/IVR.
 *  → outbound: gateway dispatches alerts into an n8n workflow webhook.
 */
import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { swytchcode } from '../services/swytchcodeService';
import { verifyWebhookSecret, requireAuth } from '../middleware/auth';
import { cacheSet, cacheGet } from '../config/redis';

const router = Router();

const eventSchema = z.object({
  eventType: z.enum(['weather_scan', 'price_scan', 'ndvi_anomaly', 'irrigation_due']),
  farmId: z.string().min(1).max(64),
  phone: z.string().regex(/^[6-9]\d{9}$/).optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  crop: z.string().max(60).optional(),
  language: z.enum(['hi', 'en']).default('hi'),
  payload: z.record(z.unknown()).optional(),
});

type Severity = 'info' | 'warning' | 'critical';

interface Alert {
  severity: Severity;
  title: string;
  body: string;
  channel: 'push' | 'sms' | 'ivr';
  actionWidget?: string;
}

async function buildWeatherAlerts(lat: number, lon: number, hi: boolean): Promise<Alert[]> {
  const wx = await swytchcode.getWeather(lat, lon);
  const alerts: Alert[] = [];
  const next48 = wx.daily.slice(0, 2);
  const rain48 = next48.reduce((s, d) => s + d.rainMm, 0);
  const maxWind = Math.max(0, ...wx.daily.slice(0, 2).map((d) => d.windMaxKmh));
  const maxTemp = Math.max(0, ...wx.daily.slice(0, 3).map((d) => d.tMaxC));

  if (rain48 >= 25) {
    alerts.push({
      severity: 'critical',
      title: hi ? 'भारी बारिश की चेतावनी' : 'Heavy rain warning',
      body: hi
        ? `48 घंटे में ${rain48.toFixed(0)} मिमी बारिश। खाद और छिड़काव रोकें, खेत की नाली साफ़ करें।`
        : `${rain48.toFixed(0)} mm expected in 48 hours. Halt fertiliser and spraying, clear field drainage now.`,
      channel: 'sms',
      actionWidget: 'weather_card',
    });
  } else if (rain48 >= 8) {
    alerts.push({
      severity: 'warning',
      title: hi ? 'बारिश आ रही है' : 'Rain incoming',
      body: hi
        ? 'यूरिया 48 घंटे टालें — नहीं तो बह जाएगा और पैसा बर्बाद होगा।'
        : 'Delay urea by 48 hours — it will wash off and the spend is wasted.',
      channel: 'push',
      actionWidget: 'weather_card',
    });
  }
  if (maxWind >= 30) {
    alerts.push({
      severity: 'warning',
      title: hi ? 'तेज़ हवा' : 'High wind',
      body: hi ? 'छिड़काव न करें — दवा उड़ जाएगी।' : 'Do not spray — chemical drift will waste the dose.',
      channel: 'push',
    });
  }
  if (maxTemp >= 41) {
    alerts.push({
      severity: 'warning',
      title: hi ? 'लू का असर' : 'Heat stress',
      body: hi
        ? 'सुबह जल्दी हल्की सिंचाई करें, दाना भरने पर असर पड़ सकता है।'
        : 'Apply a light early-morning irrigation to protect grain filling.',
      channel: 'push',
    });
  }
  return alerts;
}

/** POST /api/v1/alerts/webhook — inbound from n8n (shared-secret protected). */
router.post('/webhook', verifyWebhookSecret, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const evt = eventSchema.parse(req.body);
    const hi = evt.language === 'hi';
    let alerts: Alert[] = [];

    switch (evt.eventType) {
      case 'weather_scan':
      case 'irrigation_due':
        alerts = await buildWeatherAlerts(evt.lat, evt.lon, hi);
        break;

      case 'price_scan': {
        const state = String(evt.payload?.state ?? '');
        const crop = evt.crop ?? String(evt.payload?.commodity ?? '');
        const threshold = Number(evt.payload?.thresholdPerQuintal ?? 0);
        if (state && crop) {
          const tickers = await swytchcode.getMandiPrices(state, crop);
          const best = tickers.sort((a, b) => b.modalPrice - a.modalPrice)[0];
          if (best && best.modalPrice > threshold) {
            alerts.push({
              severity: 'info',
              title: hi ? 'अच्छा भाव मिला' : 'Better price available',
              body: hi
                ? `${best.market} में ${crop} ₹${best.modalPrice}/क्विंटल। ढुलाई घटाकर असली कमाई ऐप में देखें।`
                : `${crop} is ₹${best.modalPrice}/quintal at ${best.market}. Check net earnings after transport in the app.`,
              channel: 'sms',
              actionWidget: 'mandi_profit',
            });
          }
        }
        break;
      }

      case 'ndvi_anomaly': {
        const drop = Number(evt.payload?.ndviDropPct ?? 0);
        alerts.push({
          severity: drop >= 25 ? 'critical' : 'warning',
          title: hi ? 'खेत की सेहत गिरी' : 'Field health decline',
          body: hi
            ? `सैटेलाइट में हरियाली ${drop.toFixed(0)}% घटी है। पत्तियों की जाँच करें और ज़रूरत हो तो PMFBY दावा बनाएँ।`
            : `Satellite greenness dropped ${drop.toFixed(0)}%. Scout the leaves and file a PMFBY claim if damage is confirmed.`,
          channel: 'ivr',
          actionWidget: drop >= 25 ? 'pmfby_report' : 'leaf_diagnostic',
        });
        break;
      }
    }

    const record = {
      farmId: evt.farmId,
      eventType: evt.eventType,
      alerts,
      receivedAt: new Date().toISOString(),
    };
    await cacheSet(`alerts:${evt.farmId}`, record, 86400);

    res.json({ success: true, dispatched: alerts.length, ...record });
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/alerts/:farmId — pulled by the PWA on reconnect. */
router.get('/:farmId', requireAuth, async (req: Request, res: Response) => {
  const cached = await cacheGet(`alerts:${req.params.farmId}`);
  res.json({ success: true, alerts: cached ?? { farmId: req.params.farmId, alerts: [] } });
});

/** POST /api/v1/alerts/dispatch — push an alert outward into an n8n workflow. */
router.post('/dispatch', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const url = process.env.N8N_ALERT_DISPATCH_URL;
    if (!url) {
      res.status(503).json({ success: false, error: 'N8N_ALERT_DISPATCH_URL is not configured' });
      return;
    }
    const { data } = await axios.post(
      url,
      { ...req.body, farmer: req.farmer, sentAt: new Date().toISOString() },
      { timeout: 10000, headers: { 'x-agri-webhook-secret': process.env.N8N_WEBHOOK_SECRET ?? '' } },
    );
    res.json({ success: true, workflowResponse: data });
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/alerts/refresh-kb — n8n cron target for the nightly crawl. */
router.post('/refresh-kb', verifyWebhookSecret, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data } = await axios.post(
      `${process.env.ML_SERVICE_URL || 'http://127.0.0.1:8010'}/api/v1/rag/refresh`,
      {},
      { timeout: 180000 },
    );
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
});

export default router;