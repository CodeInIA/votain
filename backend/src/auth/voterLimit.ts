/**
 * Authentication and a quota, keyed by the VOTER rather than by their address.
 *
 * Writes to `PlatformRegistry` are transactions the platform pays for on the
 * voter's behalf. A per-IP limit protects nothing there: an address is cheap to
 * change, and one voter behind many of them could keep the registrar busy and
 * drain it. The quota therefore follows the World ID nullifier, which is the
 * one thing a voter cannot mint more of, and the session is verified first so
 * that the key the quota is counted under is one this server signed.
 */
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

import { readSessionCookie } from './cookie.js';
import { verifySession, type Session } from './session.js';

/** Answers 401 without a valid session, and otherwise leaves it in `res.locals.session`. */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = await verifySession(readSessionCookie(req));
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  res.locals.session = session;
  next();
}

/** The session `requireSession` left behind. */
export function sessionOf(res: Response): Session {
  return res.locals.session as Session;
}

/** A limiter counted per voter. Mount after `requireSession`. */
export function perVoterLimit(windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (_req, res) => `voter:${sessionOf(res).nullifier}`,
  });
}
