/**
 * Credential lifecycle endpoints:
 *  - Status List 2021 (revocation) publication + admin revocation
 *  - SD-JWT presentation verification (selective disclosure)
 */
import { Router, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { statusListCredential, revokeIndex, isRevoked, DEFAULT_LIST_ID } from '../status/statusList.js';
import { sdJwt, issuerPublicKeyPem } from '../sd/issuer.js';
import { chainFailure, errorMessage } from '../utils/errors.js';

const router = Router();

/**
 * Compares a bearer header against the admin token in constant time.
 *
 * Both sides are hashed first so the comparison never depends on, or leaks,
 * the token's length.
 */
function isAdmin(header: string | undefined): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token || !header) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${token}`));
}

// ────────────────────────────────────────────────
// GET /credentials/status/:listId: StatusList2021Credential
// ────────────────────────────────────────────────
router.get('/credentials/status/:listId', async (req: Request, res: Response) => {
  if (req.params.listId !== DEFAULT_LIST_ID) {
    return res.status(404).json({ error: 'Unknown status list' });
  }
  const baseUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  return res.status(200).json(await statusListCredential(baseUrl, req.params.listId));
});

// ────────────────────────────────────────────────
// POST /credentials/status/:listId/revoke: admin-only revocation
// ────────────────────────────────────────────────
router.post('/credentials/status/:listId/revoke', async (req: Request, res: Response) => {
  if (!isAdmin(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { index } = req.body as { index?: number };
  // Slots start at 1: zero names nobody, and the contract refuses it.
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 1) {
    return res.status(400).json({ error: 'index must be a positive integer' });
  }
  try {
    await revokeIndex(index);
  } catch (error: unknown) {
    console.error('Revocation failed:', errorMessage(error));
    return res.status(502).json({ error: chainFailure(error) });
  }
  return res.status(200).json({ revoked: true, index });
});

// ────────────────────────────────────────────────
// GET /issuer/public-key: verifiers fetch the Ed25519 SPKI PEM
// ────────────────────────────────────────────────
router.get('/issuer/public-key', (_req: Request, res: Response) => {
  return res.status(200).type('text/plain').send(issuerPublicKeyPem);
});

// ────────────────────────────────────────────────
// POST /present: verify an SD-JWT presentation
// Body: { presentation: string, requiredClaims?: string[] }
// Returns the verified + disclosed claims (e.g. an election eligibility check).
// ────────────────────────────────────────────────
router.post('/present', async (req: Request, res: Response) => {
  try {
    const { presentation, requiredClaims } = req.body as {
      presentation?: string;
      requiredClaims?: string[];
    };
    if (!presentation) return res.status(400).json({ error: 'presentation required' });

    const verified = await sdJwt.verify(presentation, { requiredClaims });
    const payload = verified.payload as {
      credentialStatus?: { statusListIndex?: string };
      exp?: number;
      [k: string]: unknown;
    };

    // Revocation check against the local status list
    const statusIndex = payload.credentialStatus?.statusListIndex;
    if (statusIndex !== undefined && (await isRevoked(Number(statusIndex)))) {
      return res.status(401).json({ verified: false, reason: 'revoked' });
    }

    // A credential with no expiry would be valid forever; every one this
    // issuer signs has one, so its absence means it is not one of ours.
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < now) {
      return res.status(401).json({ verified: false, reason: 'expired' });
    }

    return res.status(200).json({ verified: true, claims: payload });
  } catch {
    return res.status(401).json({ verified: false, reason: 'invalid presentation' });
  }
});

export default router;
