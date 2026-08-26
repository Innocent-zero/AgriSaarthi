import dotenv from 'dotenv';
import path from 'path';

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
});
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import axios from 'axios';

import { initRedis, redisStatus, closeRedis } from './config/redis';
import { engineHealth, MandiEngineError } from './services/mandiEngineBridge';
import { lyzrAgent } from './services/lyzrAgent';
import agentRoutes from './routes/agent.routes';
import mandiRoutes from './routes/mandi.routes';
import alertRoutes from './routes/alerts.routes';
import dataRoutes from './routes/data.routes';
import riskRoutes from './routes/risk.routes';
import schemeRoutes from './routes/schemes.routes';

const app = express();
const PORT = Number(process.env.GATEWAY_PORT || process.env.PORT || 8080);

// ── Security & parsing ──

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api/v1/agent', agentRoutes);
app.use('/api/v1/mandi', mandiRoutes);
app.use('/api/v1/alerts', alertRoutes);
app.use('/api/v1/data', dataRoutes);
app.use('/api/v1/risk', riskRoutes);
app.use('/api/v1/schemes', schemeRoutes);
// ── CORS ──
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not permitted by CORS policy`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-agri-webhook-secret'],
  }),
);

// ── Rate limiting ──
app.use(
  '/api/v1',
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    max: Number(process.env.RATE_LIMIT_MAX || 240),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/alerts/webhook'),
    message: { success: false, error: 'Too many requests — please wait a moment.' },
  }),
);

// ── Health ──

app.get('/health', async (_req: Request, res: Response) => {
  const engine = await engineHealth();
  res.json({
    status: 'ok',
    service: 'agrisaarthi-gateway',
    version: '1.0.0-local',
    uptimeSeconds: Math.round(process.uptime()),
    redis: redisStatus(),
    mandiEngine: engine.available ? 'ready' : 'unavailable',
    integrations: {
      lyzr: lyzrAgent.configured
        ? `configured (${lyzrAgent.creditsRemaining} credits left)`
        : 'local planner only',
      orchestrator: 'local rule-based planner',
      dataExecution: 'direct (Open-Meteo, SoilGrids)',
      mandiFeed: process.env.DATA_GOV_IN_API_KEY ? 'data.gov.in' : 'demo seed data',
      n8n: Boolean(process.env.N8N_WEBHOOK_SECRET),
      mlService: Boolean(process.env.ML_SERVICE_URL),
    },
    timestamp: new Date().toISOString(),
  });
});

// ── Routes ──
app.use('/api/v1/agent', agentRoutes);
app.use('/api/v1/mandi', mandiRoutes);
app.use('/api/v1/alerts', alertRoutes);
app.use('/api/v1/data', dataRoutes);
app.use('/api/v1/risk', riskRoutes);


// ── 404 ──
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ── Centralised error handler ──
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof MandiEngineError) {
    const status = err.code === 'ENGINE_REJECTED_INPUT' ? 400 : 503;
    res.status(status).json({ success: false, error: err.message, code: err.code });
    return;
  }
  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? 502;
    console.error('[upstream]', status, err.config?.url, err.message);
    res.status(status >= 400 && status < 600 ? status : 502).json({
      success: false,
      error: 'Upstream service error',
      detail: err.message,
    });
    return;
  }
  console.error('[error]', err.stack || err.message);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Bootstrap ──
initRedis();

const server = app.listen(PORT, '0.0.0.0', async () => {
  const engine = await engineHealth();
  console.log(`
╔══════════════════════════════════════════════════╗
║  AgriSaarthi Gateway  ·  port ${String(PORT).padEnd(19)}║
║  MODE: LOCAL (no Lyzr / Swytchcode keys needed)  ║
╠══════════════════════════════════════════════════╣
║  redis        : ${redisStatus().padEnd(33)}║
║  mandi engine : ${(engine.available ? 'ready' : 'MISSING (run: make engine)').padEnd(33)}║
║  orchestrator : ${'local rule-based planner'.padEnd(33)}║
║  weather/soil : ${'direct: Open-Meteo, SoilGrids'.padEnd(33)}║
║  mandi feed   : ${(process.env.DATA_GOV_IN_API_KEY ? 'data.gov.in' : 'demo seed data').padEnd(33)}║
╚══════════════════════════════════════════════════╝`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[${signal}] shutting down…`);
  server.close(async () => {
    await closeRedis();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

export default app;