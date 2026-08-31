/**
 * Centralised internal-service URLs.
 *
 * Nothing else in the gateway should read `process.env.ML_SERVICE_URL`
 * directly — that's how the ML service ended up wired with three different
 * fallback ports (8000 in data.routes.ts, 8010 in schemes.routes.ts and
 * alerts.routes.ts) across three different files. Import ML_SERVICE_URL
 * from here instead.
 */

// Must match ML_SERVICE_PORT in your .env (this project runs it on 8010 —
// see .env / ml-microservice/.env and the Makefile's `ml`/`dev` targets).
export const ML_SERVICE_URL = (process.env.ML_SERVICE_URL || 'http://127.0.0.1:8010').replace(/\/$/, '');