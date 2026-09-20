/**
 * Authorising an enrolment that names nobody.
 *
 * WHAT THIS REPLACED. A voter used to enrol the one identity commitment the
 * registry holds for them, in every election. The registry says publicly which
 * human each commitment belongs to, so reading the chain gave anyone the list
 * of elections a named person had joined. The ballots were secret; the turnout
 * of a named individual was not.
 *
 * WHAT HAPPENS NOW. The browser derives a commitment for one election, from the
 * voter's own secret and that election's address, and asks for it to be let in.
 * This module answers with a signature saying two things: a human this platform
 * verified is behind that commitment, and they have not already enrolled here.
 * The second half rides on a tag derived with a key only this server holds, so
 * it is the same number every time for this person and this election, and
 * nothing anybody can recognise anywhere else.
 *
 * WHAT IT COSTS, stated plainly. This server can now link a voter to an
 * enrolment, because it signs both halves. Nobody else can, where before
 * everybody could. It is the same party that already decides who becomes a
 * member at all, so the trust is not new; what is new is that it is no longer
 * published.
 */
import { getChainId, attestationBaseTime, readEnrolmentMode } from '../chain/election.js';
import { readElectionEligibility } from '../chain/election.js';
import { meetsPersonhood } from './policy.js';
import type { CredentialLevel } from '../auth/worldId.js';
import {
  attesterAddress,
  isAttesterConfigured,
  humanTagFor,
  signPrivateEnrollment,
} from './attester.js';
import { getSession, consumeSession } from './sessions.js';

export interface EnrolmentAuthorisation {
  humanTag: string;
  deadline: number;
  signature: string;
  /** The organizer's gatekeeper's signature over the same digest, or "0x". */
  eligibilitySignature: string;
}

export interface EnrolmentRefusal {
  status: number;
  error: string;
}

export function isRefusal(
  result: EnrolmentAuthorisation | EnrolmentRefusal,
): result is EnrolmentRefusal {
  return 'error' in result;
}

const ZERO = '0x0000000000000000000000000000000000000000';

export interface EnrolmentRequest {
  election: string;
  identityCommitment: string;
  /** The voter, as their session says they are. */
  voter: { nullifier: string; personhood?: CredentialLevel };
  /** The attribute check they passed, where the election asks for one. */
  sessionId?: string;
}

/**
 * Says yes or no to one private enrolment, and signs the yes.
 *
 * Refuses rather than falling back. An election that still uses the public
 * paths is a different flow with different privacy, and quietly doing that
 * instead would be the kind of downgrade nobody notices.
 */
export async function authorisePrivateEnrolment(
  request: EnrolmentRequest,
): Promise<EnrolmentAuthorisation | EnrolmentRefusal> {
  if (!isAttesterConfigured()) {
    return { status: 503, error: 'Attester not configured' };
  }

  const mode = await readEnrolmentMode(request.election);
  if (mode.platformAttester === ZERO) {
    return { status: 409, error: 'election does not take private enrolments' };
  }

  const ours = attesterAddress().toLowerCase();
  if (mode.platformAttester.toLowerCase() !== ours) {
    // Frozen into the election at deployment, so this is unfixable from here
    // and says so, rather than signing something that can only revert.
    return { status: 503, error: 'election trusts a different platform key' };
  }

  let eligibilitySignature = '0x';
  let gated = false;
  if (mode.eligibilityAttester !== ZERO) {
    gated = true;
    if (mode.eligibilityAttester.toLowerCase() !== ours) {
      return {
        status: 400,
        error: 'election is gated by another attester, which must sign the enrolment itself',
      };
    }

    const refusal = await consumePassedAttributeCheck(request);
    if (refusal) return refusal;
  }

  const [chainId, now] = await Promise.all([getChainId(), attestationBaseTime()]);
  // `mode.createdAt` and not the clock: the tag key is chosen by the epoch the
  // election was DEPLOYED in, which is the one date about it that cannot move.
  const humanTag = humanTagFor(request.voter.nullifier, request.election, mode.createdAt);
  const signed = await signPrivateEnrollment(
    request.election,
    chainId,
    request.identityCommitment,
    humanTag,
    now,
  );

  // Same key, same digest, so the second signature is the first one. Sent as
  // its own field anyway, because the contract asks two separate questions and
  // a deployment where the two keys differ has to be able to answer them
  // separately.
  if (gated) eligibilitySignature = signed.signature;

  return { ...signed, eligibilitySignature };
}

/**
 * The attribute half, for an election that asks for one.
 *
 * Consumed before anything is signed and re-read from the chain at the last
 * moment, exactly as the older attestation endpoint does it: the check that ran
 * when the session opened was against a policy read minutes ago and a cookie
 * the voter has had every chance to swap since.
 */
async function consumePassedAttributeCheck(
  request: EnrolmentRequest,
): Promise<EnrolmentRefusal | null> {
  if (!request.sessionId) {
    return { status: 400, error: 'sessionId is required for a gated election' };
  }

  const session = getSession(request.sessionId);
  if (!session) return { status: 404, error: 'session expired' };
  if (session.voter !== request.voter.nullifier) {
    return { status: 403, error: 'not your session' };
  }
  if (session.election !== request.election.toLowerCase()) {
    return { status: 400, error: 'session belongs to a different election' };
  }
  if (session.status !== 'passed') {
    return { status: 409, error: 'session has not passed verification' };
  }

  consumeSession(request.sessionId);

  const { policy } = await readElectionEligibility(request.election);
  if (!meetsPersonhood(policy, request.voter)) {
    return { status: 403, error: 'orb_required' };
  }
  return null;
}
