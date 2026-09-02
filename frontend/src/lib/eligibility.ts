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

/**
 * How strongly the election insists the enrolling voter is a distinct human.
 * Mirrors `backend/src/eligibility/policy.ts`; see there for why `orb` means
 * document AND Orb rather than either one.
 */
export type PersonhoodLevel = "device" | "document" | "orb";

export const PERSONHOOD_LEVELS: readonly PersonhoodLevel[] = ["device", "document", "orb"] as const;

export interface EligibilityPolicy {
  personhood?: PersonhoodLevel;
  minAge?: number;
  allowedCountries?: string[];
  blockedCountries?: string[];
}

/** Matches the backend. The disclosure circuit cannot carry a longer list. */
export const MAX_COUNTRY_LIST = 40;
export const MIN_AGE_FLOOR = 10;
export const MAX_AGE_CEILING = 99;

export const ZERO_HASH = `0x${"00".repeat(32)}`;

/** Whether the policy asks the voter to prove anything ABOUT themselves. */
export function hasAttributeRules(policy: EligibilityPolicy | null | undefined): boolean {
  if (!policy) return false;
  return (
    policy.minAge !== undefined ||
    (policy.allowedCountries?.length ?? 0) > 0 ||
    (policy.blockedCountries?.length ?? 0) > 0
  );
}

/**
 * The level actually in force. An attribute policy already costs a document
 * scan, so it sits at `document` whether or not it says so, which is what keeps
 * elections deployed before this field existed hashing to the same value.
 */
export function effectivePersonhood(policy: EligibilityPolicy | null | undefined): PersonhoodLevel {
  if (policy?.personhood) return policy.personhood;
  return hasAttributeRules(policy) ? "document" : "device";
}

const PERSONHOOD_RANK: Record<PersonhoodLevel, number> = { device: 0, document: 1, orb: 2 };

/**
 * Translates a World ID credential level into the vocabulary a policy speaks.
 *
 * The two lists differ by one word: the backend calls the floor `any` and a
 * policy calls it `device`. They mean the same thing, an account and nothing
 * more, and this is the single place that says so, rather than every caller
 * comparing strings and getting it right most of the time.
 */
export function asPersonhoodLevel(credentialLevel: string | null | undefined): PersonhoodLevel | null {
  if (credentialLevel === "any" || credentialLevel === "device") return "device";
  if (credentialLevel === "document" || credentialLevel === "orb") return credentialLevel;
  return null;
}

/**
 * Whether a credential reaches the bar an election sets.
 *
 * `null` held means UNPROVED, and unproved never satisfies anything above
 * `device`: a credential issued before the level was recorded, or a backend
 * that could not be reached, must not be read as a low level that happens to
 * pass, nor as a high one.
 */
export function personhoodSatisfied(
  required: PersonhoodLevel,
  held: PersonhoodLevel | null,
): boolean {
  if (required === "device") return true;
  if (held === null) return false;
  return PERSONHOOD_RANK[held] >= PERSONHOOD_RANK[required];
}

/**
 * Whether this policy is one the chain would accept.
 *
 * Age and nationality are proved from a document, so an election whose bar is a
 * World ID account cannot check either: there is no document to read them from.
 * `ElectionV4` refuses to deploy the pair, since a DEVICE election may name no
 * attester and an attribute policy needs one, and this is the same rule said
 * early enough for the wizard to act on it.
 */
export function isCoherentPolicy(policy: EligibilityPolicy | null | undefined): boolean {
  return !(policy?.personhood === "device" && hasAttributeRules(policy));
}

/** Nothing to enforce off chain: no attributes, no personhood beyond the account. */
export function isEmptyPolicy(policy: EligibilityPolicy | null | undefined): boolean {
  return !hasAttributeRules(policy) && effectivePersonhood(policy) === "device";
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
  // Last, and only when stated, so policies written before this field existed
  // still serialise to the exact bytes their published hash commits to.
  if (policy.personhood) ordered.personhood = policy.personhood;
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

/**
 * Turns a refusal from the eligibility endpoints into something to read.
 *
 * `request` throws the backend's `error` field verbatim, and the check card
 * threw all of it away and printed one generic line, so a voter refused for a
 * reason they could act on was told nothing they could act on. Matched exactly,
 * never by substring: these are codes the server chose, and guessing at prose
 * would start misreading messages the day one of them is reworded.
 *
 * Anything unrecognised keeps the generic line. An internal failure is not made
 * clearer by being shown raw to a voter.
 */
export function eligibilityErrorKey(reason: string | null | undefined): string {
  switch (reason) {
    case "orb_required":
      return "eligibility.error_orb_required";
    // The polling loop normalises a vanished session to this before the message
    // reaches here.
    case "expired":
    case "session expired":
      return "eligibility.error_session_expired";
    default:
      return "eligibility.error";
  }
}

/** Whether trying the same thing again could possibly work. */
export function eligibilityErrorIsRetryable(reason: string | null | undefined): boolean {
  // An Orb is not something a retry acquires. Offering the button would send
  // the voter round a loop that refuses them identically every time.
  return reason !== "orb_required";
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
  /** Decimal string; the contract and the relay both expect it that way. */
  personhoodNullifier: string;
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
