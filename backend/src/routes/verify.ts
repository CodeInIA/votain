import { Router, Request, Response } from 'express';
import { signRequest } from '@worldcoin/idkit-core/signing';
import { sdJwt, SELECTIVE_DISCLOSURE_FRAME, type VotainCredentialPayload } from '../sd/issuer.js';
import { allocateIndex, DEFAULT_LIST_ID } from '../status/statusList.js';
import { verifySession } from '../auth/session.js';
import { verifyWorldIdProof, type WorldIdPayload } from '../auth/worldId.js';

const router = Router();

// ────────────────────────────────────────────────
// GET /me: check for an active session
// ────────────────────────────────────────────────
router.get('/me', async (req: Request, res: Response) => {
  // The signature is checked, not just the payload decoded. Without that, a
  // handcrafted `header.{"sub":"…","exp":<future>}.garbage` cookie would be
  // accepted as any voter's session.
  const session = await verifySession(req.cookies?.voter_vc);
  if (!session) {
    res.clearCookie('voter_vc');
    return res.status(401).json({ authenticated: false });
  }

  return res.status(200).json({
    authenticated: true,
    nullifier: session.nullifier,
  });
});

// ────────────────────────────────────────────────
// POST /logout
// ────────────────────────────────────────────────
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('voter_vc', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  return res.status(200).json({ success: true });
});

// ────────────────────────────────────────────────
// POST /rp-signature
// ────────────────────────────────────────────────
router.post('/rp-signature', async (req: Request, res: Response) => {
  try {
    const { action } = req.body as { action?: string };

    if (!process.env.DEVELOPER_KEY) {
      throw new Error('DEVELOPER_KEY not configured');
    }

    const { sig, nonce, createdAt, expiresAt } = signRequest({
      signingKeyHex: process.env.DEVELOPER_KEY,
      action: action ?? process.env.WORLD_ID_ACTION ?? 'vote-registration',
    });

    return res.status(200).json({
      sig,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating RP signature:', error);
    return res.status(500).json({ error: 'Internal server error', message });
  }
});

// ────────────────────────────────────────────────
// POST /verify-human
// Verifies the World ID proof, issues the SD-JWT VC (selective disclosure +
// revocation status) and registers the voter's Semaphore identity commitment
// in the on-chain PlatformRegistry.
// ────────────────────────────────────────────────
router.post('/verify-human', async (req: Request, res: Response) => {
  try {
    const worldIdPayload = req.body as WorldIdPayload;

    // Through the shared helper rather than a second copy of the fetch. This
    // route had its own, and both were missing the credential-level check, so
    // the hole had to be closed twice or not at all.
    const verified = await verifyWorldIdProof(worldIdPayload);
    if (!verified.ok) {
      console.error('World ID verification failed:', verified.error);
      return res.status(400).json({ error: 'Invalid World ID proof', details: verified.error });
    }

    const nullifier_hash = verified.nullifier ?? '';

    // Revocation entry for this credential
    const statusIndex = allocateIndex();
    const baseUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

    const now = Math.floor(Date.now() / 1000);
    const credentialPayload: VotainCredentialPayload = {
      iss: process.env.ISSUER_DID ?? 'https://issuer.votain.local',
      sub: nullifier_hash,
      iat: now,
      exp: now + 7 * 24 * 60 * 60,
      vct: 'votain:voter-credential:v1',
      // Selective-disclosure identity attributes. Demo issuer values until
      // World ID Credentials selective disclosure is wired (see docs).
      country: process.env.DEMO_VC_COUNTRY ?? 'ES',
      ageOver18: true,
      region: process.env.DEMO_VC_REGION ?? 'Madrid',
      credentialStatus: {
        id: `${baseUrl}/api/credentials/status/${DEFAULT_LIST_ID}#${statusIndex}`,
        type: 'StatusList2021Entry',
        statusPurpose: 'revocation',
        statusListIndex: String(statusIndex),
        statusListCredential: `${baseUrl}/api/credentials/status/${DEFAULT_LIST_ID}`,
      },
    };

    const issuedCredential = await sdJwt.issue(credentialPayload, SELECTIVE_DISCLOSURE_FRAME);

    // On-chain registration does NOT happen here. The voter resolves their
    // Semaphore identity from the encrypted vault first (which may require
    // unlocking with a passkey from another device), and POST /identity/vault
    // registers the resulting commitment. Doing it here would force a brand new
    // identity on every device, and a human with two identities can vote twice.

    // Store SD-JWT as an httpOnly cookie: never exposed to JS
    res.cookie('voter_vc', issuedCredential, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    });

    return res.status(200).json({
      success: true,
      message: 'Human verified successfully',
      nullifier: nullifier_hash,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error verifying human:', error);
    return res.status(500).json({ error: 'Internal server error', message });
  }
});

export default router;
