/**
 * Attribute eligibility, voter and organizer side.
 *
 * An election may restrict enrollment to voters who prove a minimum age or a
 * nationality inside an allowed set. The proof is produced on the voter's own
 * phone from the chip in their passport or national identity card, and never
 * reaches this browser; what comes
 * back here is a signed attestation saying that one identity commitment may
 * enroll, which `ElectionV4.enrollAttested` verifies on chain.
 *
 * The canonical policy form and its hash are duplicated from
 * `backend/src/eligibility/policy.ts` on purpose. The organizer's browser
 * computes the hash at creation time and the backend recomputes it at
 * enrollment time, in different processes that never talk to each other about
 * it. Any drift between the two would surface as a policy that "does not match
 * its published hash", so both sides keep their own copy of one small,
 * deliberately boring serialiser rather than trusting a shared endpoint.
 */

export interface EligibilityPolicy {
  minAge?: number;
  allowedCountries?: string[];
  blockedCountries?: string[];
}

/** Matches the backend. The disclosure circuit cannot carry a longer list. */
export const MAX_COUNTRY_LIST = 40;
export const MIN_AGE_FLOOR = 10;
export const MAX_AGE_CEILING = 99;

export const ZERO_HASH = `0x${"00".repeat(32)}`;

export function isEmptyPolicy(policy: EligibilityPolicy | null | undefined): boolean {
  if (!policy) return true;
  return (
    policy.minAge === undefined &&
    (policy.allowedCountries?.length ?? 0) === 0 &&
    (policy.blockedCountries?.length ?? 0) === 0
  );
}

/** Uppercased, deduplicated and sorted, so ordering cannot change the hash. */
export function normaliseCountries(codes: string[]): string[] {
  const cleaned = codes
    .map(code => code.trim().toUpperCase())
    .filter(code => /^[A-Z]{3}$/.test(code));
  return [...new Set(cleaned)].sort();
}

export function canonicalPolicyJson(policy: EligibilityPolicy): string {
  const ordered: Record<string, unknown> = {};
  if (policy.minAge !== undefined) ordered.minAge = policy.minAge;
  if (policy.allowedCountries?.length) ordered.allowedCountries = policy.allowedCountries;
  if (policy.blockedCountries?.length) ordered.blockedCountries = policy.blockedCountries;
  return JSON.stringify(ordered);
}

/** An empty policy hashes to zero, matching the contract's "no policy" sentinel. */
export async function policyHash(policy: EligibilityPolicy): Promise<string> {
  if (isEmptyPolicy(policy)) return ZERO_HASH;
  const { keccak256, toUtf8Bytes } = await import("ethers");
  return keccak256(toUtf8Bytes(canonicalPolicyJson(policy)));
}

/**
 * Whether this policy makes the voter reveal their nationality rather than
 * prove a predicate about it.
 *
 * Self expresses country rules as an exclusion list, so an allowlist cannot be
 * phrased as a predicate and costs a reveal. The wizard says so out loud: an
 * organizer choosing between "block these" and "allow only these" should know
 * that the second asks more of the voter.
 */
export function requiresNationalityReveal(policy: EligibilityPolicy): boolean {
  return (policy.allowedCountries?.length ?? 0) > 0;
}

// ────────────────────────────────────────────────
// Voter-side API
// ────────────────────────────────────────────────

const BACKEND = import.meta.env.VITE_BACKEND_URL as string | undefined;

/**
 * Every eligibility call carries the voter's session cookie. Unlike the ballot
 * (see `relay.ts`), that is correct here: the backend already knows which voter
 * opened the challenge, and only that voter may claim its attestation.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BACKEND) throw new Error("VITE_BACKEND_URL is not configured");

  const response = await fetch(`${BACKEND}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error((body.error as string) ?? `request failed (${response.status})`);
  return body as T;
}

export interface ElectionEligibility {
  required: boolean;
  policy: EligibilityPolicy;
  attester: string;
  policyHash: string;
}

/** What an election demands. Safe to call for any election; open ones say `required: false`. */
export async function fetchElectionEligibility(election: string): Promise<ElectionEligibility> {
  return request<ElectionEligibility>(`/api/eligibility/${election}`);
}

export interface AttesterInfo {
  address: string;
  provider: string;
  mock: boolean;
  available: boolean;
}

/** The address a new gated election has to name. Organizer side, at creation. */
export async function fetchAttester(): Promise<AttesterInfo> {
  return request<AttesterInfo>("/api/eligibility/attester");
}

export interface EligibilityChallenge {
  sessionId: string;
  /**
   * Deep link into the Self app, built server-side by Self's own
   * `SelfAppBuilder`. This browser only renders it as a QR and offers it as a
   * tappable link: it never assembles the payload, which has changed shape
   * between SDK releases and would go stale here without anything failing
   * loudly.
   */
  universalLink: string;
  /**
   * Same link plus a return address, for the case where the voter is already on
   * the device that holds the Self app. The Self app counts down and brings them
   * back here rather than leaving them to find the browser themselves. Falls
   * back to `universalLink` when no usable return address was accepted.
   */
  mobileLink: string;
  policy: EligibilityPolicy;
  mock: boolean;
}

export async function openEligibilitySession(election: string): Promise<EligibilityChallenge> {
  // Where the Self app should return the voter, sent from here because only the
  // browser knows it: in development that is a LAN address the backend could not
  // guess, and in production it is whatever origin actually served this page.
  // The backend validates it before writing it into anything.
  return request<EligibilityChallenge>(`/api/eligibility/${election}/session`, {
    method: "POST",
    body: JSON.stringify({ callbackUrl: window.location.href }),
  });
}

export type EligibilitySessionStatus = "pending" | "passed" | "failed";

export async function pollEligibilitySession(
  sessionId: string,
): Promise<{ status: EligibilitySessionStatus; reason?: string }> {
  return request(`/api/eligibility/session/${sessionId}`);
}

export interface EnrollAttestation {
  deadline: number;
  signature: string;
}

export async function claimAttestation(
  election: string,
  sessionId: string,
  identityCommitment: bigint,
): Promise<EnrollAttestation> {
  return request<EnrollAttestation>(`/api/eligibility/${election}/attestation`, {
    method: "POST",
    body: JSON.stringify({ sessionId, identityCommitment: identityCommitment.toString() }),
  });
}
