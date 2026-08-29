/**
 * Eligibility endpoints.
 *
 * Three requests make up one attribute check:
 *
 *  1. `POST /eligibility/:election/session` (authenticated). The voter's browser
 *     opens a challenge. Returns the session id and everything the frontend
 *     needs to build the Self request.
 *  2. `POST /eligibility/verify` (unauthenticated). The Self relayer posts the
 *     proof here on its own connection, carrying the session id inside the
 *     proof's user identifier. It has no cookie and cannot have one, which is
 *     why the session id has to do the linking.
 *  3. `POST /eligibility/:election/attestation` (authenticated). The browser
 *     comes back with its identity commitment and collects the signature.
 *
 * The split is what keeps step 2 safe to leave open. It cannot mark a session
 * that does not exist, cannot choose which session it marks (the id is bound
 * into the proof), and cannot obtain an attestation, because only the voter who
 * opened the session can claim one and only for a commitment they name while
 * holding their own cookie.
 */
import { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { verifySession } from '../auth/session.js';
import { readElectionEligibility, getChainId, isChainConfigured } from '../chain/election.js';
import { isEmptyPolicy } from '../eligibility/policy.js';
import {
  isSelfConfigured,
  isMockMode,
  scopeForElection,
  selfDisclosuresFor,
  buildUniversalLink,
  sanitiseCallbackUrl,
  verifyProof,
  readSessionIdFromContext,
  type SelfProofSubmission,
} from '../eligibility/self.js';
import {
  attesterAddress,
  isAttesterConfigured,
  signEnrollAttestation,
} from '../eligibility/attester.js';
import {
  createSession,
  getSession,
  markSession,
  consumeSession,
} from '../eligibility/sessions.js';

const router = Router();

const eligibilityLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Limiter for the Self callback, which must NOT be keyed on the client address.
 *
 * That request comes from Self's relayer infrastructure, not from the voter's
 * browser, so every voter's proof arrives from the same handful of addresses and
 * an address-keyed bucket would be shared by all of them at once. Past the limit
 * the route would answer 429, which is exactly the non-2xx the relayer reads as
 * a transport failure rather than a verdict, and the voter would sit on a
 * spinner until their session expired.
 *
 * Keyed on the session the proof names instead: a voter can retry their own scan
 * without consuming anybody else's budget, while a caller sending bodies with no
 * recoverable session falls back to being limited by address, which is the case
 * that actually deserves it.
 */
const verifyCallbackLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const sessionId = readSessionIdFromContext(
      (req.body as { userContextData?: unknown })?.userContextData,
    );
    return sessionId ? `session:${sessionId}` : `addr:${ipKeyGenerator(req.ip ?? '')}`;
  },
});

/**
 * The attester address organizers must embed when creating a gated election.
 * Public: it is written into the election anyway and is meant to be checked.
 */
router.get('/eligibility/attester', (_req: Request, res: Response) => {
  if (!isAttesterConfigured()) {
    return res.status(503).json({ error: 'Attester not configured' });
  }
  return res.status(200).json({
    address: attesterAddress(),
    provider: 'self',
    mock: isMockMode(),
    available: isSelfConfigured(),
  });
});

/** What an election demands, for the UI to explain before the voter starts. */
router.get('/eligibility/:election', async (req: Request, res: Response) => {
  if (!isChainConfigured()) return res.status(503).json({ error: 'Chain not configured' });

  try {
    const { policy, attester, policyHash } = await readElectionEligibility(String(req.params.election));
    return res.status(200).json({
      required: !isEmptyPolicy(policy),
      policy,
      attester,
      policyHash,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ error: message });
  }
});

router.post('/eligibility/:election/session', eligibilityLimiter, async (req: Request, res: Response) => {
  const voter = await verifySession(req.cookies?.voter_vc);
  if (!voter) return res.status(401).json({ error: 'Not authenticated' });
  if (!isSelfConfigured()) return res.status(503).json({ error: 'Eligibility provider not configured' });
  if (!isAttesterConfigured()) return res.status(503).json({ error: 'Attester not configured' });

  const election = String(req.params.election);
  let eligibility;
  try {
    eligibility = await readElectionEligibility(election);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ error: message });
  }

  if (isEmptyPolicy(eligibility.policy)) {
    return res.status(400).json({ error: 'this election has no eligibility policy' });
  }

  // Refuse early rather than sign something the contract will reject. An
  // election that named a different attester is not ours to gate.
  if (eligibility.attester.toLowerCase() !== attesterAddress().toLowerCase()) {
    return res.status(400).json({ error: 'this election names a different attester' });
  }

  const session = createSession(election, voter.nullifier);
  const disclosures = selfDisclosuresFor(eligibility.policy);

  // Two links, because the two ways in have different endings.
  //
  // The QR is scanned from a phone while Votain sits on a desktop, so there is
  // nowhere to send the voter back to: a callback would redirect the phone away
  // from the app that just did the work, leaving the screen they are watching
  // untouched. The tappable link is the same-device case, where the voter left
  // Votain to open Self and has no reason to find their way back by hand.
  //
  // Both are built by Self's own builder rather than assembled in the browser,
  // so the payload cannot drift from what the app expects and the builder's
  // validation runs before the voter ever sees a QR.
  const callbackUrl = sanitiseCallbackUrl((req.body as { callbackUrl?: unknown })?.callbackUrl);

  let universalLink: string;
  let mobileLink: string;
  try {
    const base = {
      appName: 'Votain',
      scope: scopeForElection(election),
      endpoint: process.env.SELF_ENDPOINT as string,
      sessionId: session.id,
      disclosures,
      mock: isMockMode(),
    };
    universalLink = buildUniversalLink(base);
    mobileLink = callbackUrl
      ? buildUniversalLink({ ...base, deeplinkCallback: callbackUrl })
      : universalLink;
  } catch (error: unknown) {
    // A rejection here is a misconfiguration on our side, not the voter's
    // problem: a localhost SELF_ENDPOINT, or a scope past the length limit.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not build the Self request: ${message}`);
    return res.status(503).json({ error: 'eligibility provider is misconfigured' });
  }

  return res.status(200).json({
    sessionId: session.id,
    universalLink,
    mobileLink,
    policy: eligibility.policy,
    mock: isMockMode(),
  });
});

/**
 * Callback for the Self relayer.
 *
 * Unauthenticated because it has to be: the request originates from Self's
 * infrastructure after the voter's phone produced the proof, not from the
 * voter's browser. Everything that matters is inside the proof.
 *
 * ALWAYS ANSWERS 200, with `{ status, result, reason }`. That is the contract
 * Self documents for this endpoint, and it is not a formality: a non-2xx reply
 * reads to the relayer as a transport failure rather than a verdict, so a voter
 * whose document simply misses the age rule would see a network error instead of
 * being told why. The HTTP status carries "the callback arrived"; the body
 * carries whether the proof passed.
 */
function verdictResponse(
  res: Response,
  outcome: { status: 'success' } | { status: 'error'; reason: string },
) {
  return res.status(200).json(
    outcome.status === 'success'
      ? { status: 'success', result: true }
      : { status: 'error', result: false, reason: outcome.reason },
  );
}

router.post('/eligibility/verify', verifyCallbackLimiter, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  // The public signals arrive as `publicSignals`. Self's own documentation
  // disagrees with itself about this (the quickstart says `publicSignals`, the
  // v1-to-v2 migration note says `pubSignals`), so both are accepted rather than
  // betting on one: the cost of guessing wrong is a rejection whose only symptom
  // is a missing field the sender is certain it sent.
  const publicSignals = body.publicSignals ?? body.pubSignals;

  const submission = {
    attestationId: body.attestationId,
    proof: body.proof,
    pubSignals: publicSignals,
    userContextData: body.userContextData,
  } as Partial<SelfProofSubmission>;

  const missing = (['attestationId', 'proof', 'pubSignals', 'userContextData'] as const)
    .filter(field => submission[field] === undefined)
    // Reported under the name the sender used, not our internal one: telling a
    // caller that `pubSignals` is missing when they sent `publicSignals` is how
    // this endpoint wasted an afternoon already.
    .map(field => (field === 'pubSignals' ? 'publicSignals' : field));
  if (missing.length > 0) {
    // The keys actually received, never their values: a proof body is large and
    // this is the one place where knowing the shape saves an afternoon.
    console.error(
      `eligibility/verify rejected a body missing ${missing.join(', ')}; keys present: ${Object.keys(body).join(', ') || 'none'}`,
    );
    return verdictResponse(res, { status: 'error', reason: `missing fields: ${missing.join(', ')}` });
  }

  // Which session this proof belongs to. Read from the request's context data,
  // not taken on the sender's word: it only selects which election's scope the
  // proof is then verified against, and a proof built for another scope fails
  // that verification, so a wrong guess here buys nothing.
  const sessionId = readSessionIdFromContext(submission.userContextData);
  if (!sessionId) {
    return verdictResponse(res, { status: 'error', reason: 'proof carried no session' });
  }

  const session = getSession(sessionId);
  if (!session) return verdictResponse(res, { status: 'error', reason: 'session expired' });

  let eligibility;
  try {
    eligibility = await readElectionEligibility(session.election);
  } catch {
    return verdictResponse(res, { status: 'error', reason: 'election_unreadable' });
  }

  const verdict = await verifyProof(
    session.election,
    eligibility.policy,
    submission as SelfProofSubmission,
  );

  // A proof that does not verify leaves the session alone. Session ids are
  // unguessable, but marking a session failed on an unverifiable submission
  // would still hand anyone who learned one a way to cancel a scan in progress.
  // Only a genuine document that misses the policy records a failure.
  if (!verdict.ok) {
    if (verdict.reason === 'proof_invalid' || verdict.reason === 'not_configured') {
      // Logged with the SDK's own diagnosis (InvalidScope, InvalidRoot and the
      // rest), which is the difference between "it failed" and knowing why.
      console.error(
        `eligibility/verify could not verify a proof: ${verdict.reason}${verdict.detail ? ` (${verdict.detail})` : ''}`,
      );
      return verdictResponse(res, { status: 'error', reason: verdict.reason as string });
    }
    markSession(sessionId, 'failed', verdict.reason);
    return verdictResponse(res, { status: 'error', reason: verdict.reason as string });
  }

  markSession(sessionId, 'passed');
  return verdictResponse(res, { status: 'success' });
});

/** Polled by the browser while the voter is scanning. */
router.get('/eligibility/session/:sessionId', async (req: Request, res: Response) => {
  const voter = await verifySession(req.cookies?.voter_vc);
  if (!voter) return res.status(401).json({ error: 'Not authenticated' });

  const session = getSession(String(req.params.sessionId));
  if (!session) return res.status(404).json({ error: 'session expired' });
  if (session.voter !== voter.nullifier) return res.status(403).json({ error: 'not your session' });

  return res.status(200).json({ status: session.status, reason: session.reason });
});

/**
 * Issues the attestation for a session that passed.
 *
 * The commitment is named here, by the browser, rather than at session time:
 * the voter may still be deriving it while they scan, and binding the
 * signature to it only at this point costs nothing because the session is
 * already tied to their World ID.
 */
router.post('/eligibility/:election/attestation', eligibilityLimiter, async (req: Request, res: Response) => {
  const voter = await verifySession(req.cookies?.voter_vc);
  if (!voter) return res.status(401).json({ error: 'Not authenticated' });
  if (!isAttesterConfigured()) return res.status(503).json({ error: 'Attester not configured' });

  const { sessionId, identityCommitment } = req.body as {
    sessionId?: string;
    identityCommitment?: string;
  };
  if (!sessionId || !identityCommitment) {
    return res.status(400).json({ error: 'sessionId and identityCommitment are required' });
  }
  if (!/^\d+$/.test(identityCommitment)) {
    return res.status(400).json({ error: 'identityCommitment must be a decimal string' });
  }

  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'session expired' });
  if (session.voter !== voter.nullifier) return res.status(403).json({ error: 'not your session' });
  if (session.election !== String(req.params.election).toLowerCase()) {
    return res.status(400).json({ error: 'session belongs to a different election' });
  }
  if (session.status !== 'passed') {
    return res.status(409).json({ error: 'session has not passed verification', reason: session.reason });
  }

  // Consumed BEFORE the awaits below, not after them. Two concurrent claims with
  // the same session id and different commitments would otherwise both pass the
  // status check and both walk away with a signature, which is the exact thing
  // one-attestation-per-scan exists to prevent. The cost of being wrong the
  // other way is a voter who re-scans.
  consumeSession(sessionId);

  try {
    const chainId = await getChainId();
    const attestation = await signEnrollAttestation(
      String(req.params.election),
      chainId,
      identityCommitment,
    );
    return res.status(200).json(attestation);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to sign eligibility attestation:', message);
    return res.status(500).json({ error: 'could not sign attestation' });
  }
});

export default router;
