import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { lyzrAgent, AgentContext } from '../services/lyzrAgent';
import { optionalAuth, issueToken } from '../middleware/auth';

const router = Router();

const querySchema = z.object({
  message: z.string().min(1, 'message is required').max(1200),
  sessionId: z.string().min(4).max(64).optional(),
  context: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    crop: z.string().max(60).optional(),
    areaHa: z.number().positive().max(10000).optional(),
    state: z.string().max(60).optional(),
    district: z.string().max(60).optional(),
    language: z.enum(['hi', 'en']).default('hi'),
    farmerName: z.string().max(80).optional(),
  }),
});

const tokenSchema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
  name: z.string().max(80).optional(),
  district: z.string().max(60).optional(),
  lang: z.enum(['hi', 'en']).default('hi'),
});

/** Dev/demo token issuance. Replace with an OTP provider before public launch. */
router.post('/auth/token', (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = tokenSchema.parse(req.body);
    const token = issueToken({
      sub: `farmer:${body.phone}`,
      phone: body.phone,
      name: body.name,
      district: body.district,
      lang: body.lang,
    });
    res.json({ success: true, token, expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/agent/query
 * Hybrid turn: conversational reply + widget-mount action envelope.
 */
router.post('/query', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = querySchema.parse(req.body);
    const sessionId = body.sessionId || randomUUID();

    const ctx: AgentContext = {
      ...body.context,
      farmerName: body.context.farmerName ?? req.farmer?.name,
      district: body.context.district ?? req.farmer?.district,
    };

    const turn = await lyzrAgent.ask(body.message, ctx, sessionId);

    res.json({
      success: true,
      sessionId: turn.sessionId,
      reply: turn.reply,
      actions: turn.actions,
      language: turn.language,
      orchestrator: turn.source,
      servedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;