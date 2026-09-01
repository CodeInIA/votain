/**
 * Relay endpoints.
 *
 * Voters submit their enrollment and their ballot here instead of sending a
 * transaction themselves. See `chain/relayer.ts` for why: a per-voter sending
 * address would publicly link enrollment to ballot.
 *
 * Note the deliberate asymmetry in authentication:
 *
 *  - `/relay/enroll` requires the voter's session. Enrollment is a public act
 *    anyway (the commitment lands in the election's merkle tree), so tying it
 *    to a session costs no privacy and keeps the endpoint from being a free
 *    spam surface.
 *  - `/relay/vote` is intentionally UNAUTHENTICATED. Requiring a session would
 *    tell this server which voter cast which ballot, which is precisely the
 *    link the whole design exists to destroy. The zero-knowledge proof is the
 *    authorisation, and it is verified on chain, so nothing is lost by not
 *    knowing who is calling.
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  relayEnroll,
  relayEnrollAttested,
  relayVote,
  isRelayerConfigured,
  type VoteCall,
} from '../chain/relayer.js';
import { verifySession } from '../auth/session.js';

const router = Router();

/// Tight limit: the on-chain proof check is the real gate, this only blunts
/// bulk submission from one source.
const relayLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/relay/enroll', relayLimiter, async (req: Request, res: Response) => {
  if (!isRelayerConfigured()) {
    return res.status(503).json({ error: 'Relayer not configured' });
  }

  const session = await verifySession(req.cookies?.voter_vc);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  const { election, identityCommitment, personhoodNullifier, deadline, signature } = req.body as {
    election?: string;
    identityCommitment?: string;
    personhoodNullifier?: string;
    deadline?: number;
    signature?: string;
  };
  if (!election || !identityCommitment) {
    return res.status(400).json({ error: 'election and identityCommitment are required' });
  }
  if (!/^\d+$/.test(identityCommitment)) {
    return res.status(400).json({ error: 'identityCommitment must be a decimal string' });
  }

  // An attestation turns this into the gated entry point. The contract decides
  // which one an election accepts, so passing the wrong one reverts rather than
  // enrolling on weaker terms.
  const attested = deadline !== undefined && signature;
  if (attested && !/^\d+$/.test(personhoodNullifier ?? '')) {
    return res.status(400).json({ error: 'personhoodNullifier must be a decimal string' });
  }

  const result = attested
    ? await relayEnrollAttested(
        election,
        identityCommitment,
        personhoodNullifier as string,
        deadline as number,
        signature as string,
      )
    : await relayEnroll(election, identityCommitment);

  if (!result.relayed) return res.status(400).json({ error: result.error });
  return res.status(200).json({ txHash: result.txHash });
});

router.post('/relay/vote', relayLimiter, async (req: Request, res: Response) => {
  if (!isRelayerConfigured()) {
    return res.status(503).json({ error: 'Relayer not configured' });
  }

  const body = req.body as Partial<VoteCall>;
  const missing = (
    ['election', 'voteCiphertext', 'nullifier', 'merkleRoot', 'merkleDepth', 'pA', 'pB', 'pC'] as const
  ).filter(field => body[field] === undefined);
  if (missing.length > 0) {
    return res.status(400).json({ error: `missing fields: ${missing.join(', ')}` });
  }

  const result = await relayVote(body as VoteCall);
  if (!result.relayed) return res.status(400).json({ error: result.error });
  return res.status(200).json({ txHash: result.txHash });
});

export default router;
