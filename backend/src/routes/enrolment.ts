/**
 * Authorising an enrolment the chain cannot trace back to a person.
 *
 * `POST /enrolment/voucher` hands back what `ElectionV4.enrollPrivate` needs:
 * the tag that answers "has this person already enrolled here", a deadline and
 * the platform's signature over both, plus the organizer's gatekeeper's
 * signature where the election named one.
 *
 * WHY A SEPARATE ENDPOINT from `/relay/enroll`, which does the same thing and
 * then submits the transaction. Because on a local chain the browser submits
 * its own transactions with a funded development key, and that is the whole
 * point of that path: it lets somebody run the dApp without a relayer. What it
 * cannot do is produce the platform's signature, which lives here in local
 * development exactly as it does in production.
 *
 * Nothing secret leaves: every value in the response is about to be public
 * calldata. The secret is the KEY the tag is derived with, which never moves.
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { verifySession } from '../auth/session.js';
import { readSessionCookie } from '../auth/cookie.js';
import { authorisePrivateEnrolment, isRefusal } from '../eligibility/enrolment.js';

const router = Router();

const enrolmentLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/enrolment/voucher', enrolmentLimiter, async (req: Request, res: Response) => {
  const voter = await verifySession(readSessionCookie(req));
  if (!voter) return res.status(401).json({ error: 'Not authenticated' });

  const { election, identityCommitment, sessionId } = req.body as {
    election?: string;
    identityCommitment?: string;
    sessionId?: string;
  };
  if (!election || !identityCommitment) {
    return res.status(400).json({ error: 'election and identityCommitment are required' });
  }
  if (!/^\d+$/.test(identityCommitment)) {
    return res.status(400).json({ error: 'identityCommitment must be a decimal string' });
  }

  try {
    const result = await authorisePrivateEnrolment({
      election,
      identityCommitment,
      voter: { nullifier: voter.nullifier, personhood: voter.personhood },
      sessionId,
    });
    if (isRefusal(result)) return res.status(result.status).json({ error: result.error });
    return res.status(200).json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to authorise a private enrolment:', message);
    return res.status(500).json({ error: 'could not authorise the enrolment' });
  }
});

export default router;
