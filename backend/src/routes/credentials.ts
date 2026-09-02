/**
 * Credential lifecycle endpoints:
 *  - Status List 2021 (revocation) publication + admin revocation
 *  - SD-JWT presentation verification (selective disclosure)
 */
import { Router, Request, Response } from 'express';
import { statusListCredential, revokeIndex, isRevoked, DEFAULT_LIST_ID } from '../status/statusList.js';
import { sdJwt, issuerPublicKeyPem } from '../sd/issuer.js';

const router = Router();

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
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.headers.authorization !== `Bearer ${adminToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { index } = req.body as { index?: number };
  if (typeof index !== 'number' || index < 0) {
    return res.status(400).json({ error: 'index (number) required' });
  }
  await revokeIndex(index);
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

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < now) {
      return res.status(401).json({ verified: false, reason: 'expired' });
    }

    return res.status(200).json({ verified: true, claims: payload });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(401).json({ verified: false, reason: message });
  }
});

export default router;
