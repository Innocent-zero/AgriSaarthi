import { Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';

export interface FarmerClaims {
  sub: string;
  phone: string;
  name?: string;
  district?: string;
  lang?: 'hi' | 'en';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      farmer?: FarmerClaims;
    }
  }
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET is missing or too short (min 16 chars)');
  }
  return s;
}

export function issueToken(claims: FarmerClaims): string {
  const opts: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'],
    issuer: 'agrisaarthi',
  };
  return jwt.sign(claims, secret(), opts);
}

/** Hard gate — 401 when no valid bearer token is present. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing bearer token' });
    return;
  }
  try {
    req.farmer = jwt.verify(header.slice(7), secret(), { issuer: 'agrisaarthi' }) as FarmerClaims;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/**
 * Soft gate — attaches claims when present but never blocks.
 * Used on advisory endpoints so a farmer with a stale offline token still
 * receives weather and price guidance.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.farmer = jwt.verify(header.slice(7), secret(), { issuer: 'agrisaarthi' }) as FarmerClaims;
    } catch { /* ignore — treated as anonymous */ }
  }
  next();
}

/** Shared-secret gate for n8n → gateway webhooks. */
export function verifyWebhookSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.N8N_WEBHOOK_SECRET;
  const provided = req.header('x-agri-webhook-secret');
  if (!expected) {
    res.status(503).json({ success: false, error: 'Webhook secret not configured' });
    return;
  }
  if (provided !== expected) {
    res.status(403).json({ success: false, error: 'Invalid webhook signature' });
    return;
  }
  next();
}