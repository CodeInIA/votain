import { Router, Request, Response } from 'express';
import { signRequest } from '@worldcoin/idkit-core/signing';
import { sdJwt, SELECTIVE_DISCLOSURE_FRAME, type VotainCredentialPayload } from '../sd/issuer.js';
import { allocateIndex, DEFAULT_LIST_ID } from '../status/statusList.js';
import { registerOnChain, isRegistrarConfigured } from '../chain/registrar.js';

const router = Router();

// ────────────────────────────────────────────────
// GET /me — check for an active session
// ────────────────────────────────────────────────
router.get('/me', (req: Request, res: Response) => {
  const vc = req.cookies?.voter_vc;
  if (!vc) return res.status(401).json({ authenticated: false });

  try {
    const payloadB64 = vc.split('.')[1];
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8')
    ) as VotainCredentialPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      res.clearCookie('voter_vc');
      return res.status(401).json({ authenticated: false, reason: 'expired' });
    }

    return res.status(200).json({
      authenticated: true,
      nullifier: payload.sub,
    });
  } catch {
    return res.status(401).json({ authenticated: false, reason: 'invalid_token' });
  }
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
    const idkitResponse = req.body as {
      responses?: Array<{ nullifier?: string }>;
      nullifier_hash?: string;
      identityCommitment?: string;
    };

    const rpId = process.env.WORLD_ID_RP_ID;
    if (!rpId) throw new Error('WORLD_ID_RP_ID not configured');

    // The Semaphore identity commitment travels alongside the World ID payload
    // but must NOT be forwarded to World ID.
    const { identityCommitment, ...worldIdPayload } = idkitResponse;

    const verifyRes = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(worldIdPayload),
    });

    if (!verifyRes.ok) {
      const wldError: unknown = await verifyRes.json();
      console.error('World ID verification failed:', wldError);
      return res.status(400).json({ error: 'Invalid World ID proof', details: wldError });
    }

    const nullifier_hash: string =
      idkitResponse.responses?.[0]?.nullifier ??
      idkitResponse.nullifier_hash ??
      '';

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

    // Register the voter on-chain so elections accept their enrollment
    let onchain = { registered: false as boolean, txHash: undefined as string | undefined };
    if (identityCommitment && isRegistrarConfigured()) {
      const result = await registerOnChain(nullifier_hash, identityCommitment);
      onchain = { registered: result.registered, txHash: result.txHash };
      if (!result.registered) {
        console.warn('On-chain registration failed:', result.error);
      }
    } else if (identityCommitment) {
      console.warn('Registrar not configured — skipping on-chain registration');
    }

    // Store SD-JWT as an httpOnly cookie — never exposed to JS
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
      onchainRegistered: onchain.registered,
      registrationTx: onchain.txHash,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error verifying human:', error);
    return res.status(500).json({ error: 'Internal server error', message });
  }
});

export default router;
