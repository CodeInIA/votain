/**
 * Encrypted preferences endpoints.
 *
 * `GET /preferences` hands back the voter's sealed settings and
 * `PUT /preferences` replaces them. Both are ciphertext to this server; see
 * `identity/preferences.ts` for why it cannot be anything else.
 *
 * Authentication is the voter's SD-JWT session cookie, as the vault is: the
 * session names the World ID nullifier, and that is the only key a voter is
 * allowed to write. READING is authenticated too, although the blob is public
 * on chain and anyone with an RPC endpoint can fetch it. That is not a
 * contradiction: the session is what tells this server WHICH key to read, and
 * an endpoint taking one from the caller would turn a public value that must be
 * looked for into one this server hands out on request.
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { verifySession } from '../auth/session.js';
import {
  getPreferences,
  setPreferences,
  blobByteLength,
  isBase64Url,
  MAX_PREFERENCES_BYTES,
  PreferencesTooLargeError,
} from '../identity/preferences.js';
import { VaultUnavailableError } from '../identity/vault.js';

const router = Router();

/**
 * Writes are a transaction each, so they are limited more tightly than reads.
 *
 * The browser already batches: saving an election is instant and local, and the
 * blob is pushed once the voter stops clicking. This is the backstop for a
 * client that does not, and 20 an hour is far above what the debounce produces
 * and far below what would cost the relayer anything.
 */
const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Reads the voter's World ID nullifier from their verified session cookie. */
async function sessionNullifier(req: Request): Promise<string | null> {
  const session = await verifySession(req.cookies?.voter_vc);
  return session?.nullifier ?? null;
}

// ────────────────────────────────────────────────
// GET /preferences: this voter's sealed settings
// ────────────────────────────────────────────────
router.get('/preferences', async (req: Request, res: Response) => {
  const nullifier = await sessionNullifier(req);
  if (!nullifier) return res.status(401).json({ error: 'Not authenticated' });

  try {
    return res.status(200).json({ blob: await getPreferences(nullifier) });
  } catch (error: unknown) {
    // The deployment is incomplete, not broken. The browser keeps whatever it
    // has locally and tries again later, rather than showing a stack to
    // somebody who pressed a star.
    if (error instanceof VaultUnavailableError) {
      return res.status(503).json({ error: error.message, code: 'preferences_unavailable' });
    }
    throw error;
  }
});

// ────────────────────────────────────────────────
// PUT /preferences: replace them
// ────────────────────────────────────────────────
router.put('/preferences', writeLimiter, async (req: Request, res: Response) => {
  const nullifier = await sessionNullifier(req);
  if (!nullifier) return res.status(401).json({ error: 'Not authenticated' });

  const { blob } = req.body as { blob?: unknown };
  // An empty string is valid and means "clear": a voter who unsaves their last
  // election must not be left with the previous list still served to their
  // other devices.
  if (typeof blob !== 'string') {
    return res.status(400).json({ error: 'blob is required and must be a string' });
  }
  if (!isBase64Url(blob)) {
    return res.status(400).json({ error: 'blob must be base64url' });
  }
  if (blobByteLength(blob) > MAX_PREFERENCES_BYTES) {
    return res.status(413).json({
      error: `blob must be at most ${MAX_PREFERENCES_BYTES} bytes`,
      code: 'preferences_too_large',
    });
  }

  try {
    await setPreferences(nullifier, blob);
  } catch (error: unknown) {
    if (error instanceof VaultUnavailableError) {
      return res.status(503).json({ error: error.message, code: 'preferences_unavailable' });
    }
    if (error instanceof PreferencesTooLargeError) {
      return res.status(413).json({ error: error.message, code: 'preferences_too_large' });
    }
    throw error;
  }
  return res.status(204).end();
});

export default router;
