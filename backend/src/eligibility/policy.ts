/**
 * Attribute eligibility policy.
 *
 * An election may restrict enrollment to voters who hold certain attributes:
 * a minimum age, a nationality inside an allowed set, a nationality outside a
 * blocked set. This module owns the shape of that policy and its canonical
 * hash, and knows nothing about how the attributes are proved. Self is one
 * provider (see `self.ts`); an EUDI Wallet connector would be another, and
 * would not touch anything here.
 *
 * WHERE THE POLICY LIVES. Inside the election's on-chain `metadataJson`, under
 * an `eligibility` key, with `keccak256` of its canonical form stored
 * separately in `eligibilityPolicyHash`. The contract cannot check an attribute
 * proof, so enforcement is off chain, and publishing the hash is what keeps the
 * rules auditable: anyone can recompute it from the metadata and confirm the
 * organizer has not quietly moved the goalposts after voters enrolled.
 *
 * WHY CANONICAL. The hash is computed by the frontend at creation time and
 * recomputed here at enrollment time, in different processes. Any disagreement
 * about key order or array order would produce a mismatch that reads as
 * tampering. Serialising through one function on both sides removes the
 * question.
 */
import { keccak256, toUtf8Bytes } from 'ethers';

export interface EligibilityPolicy {
  /** Minimum age in years. Proved as a predicate: the birth date is never revealed. */
  minAge?: number;
  /** ISO 3166-1 alpha-3 codes. A voter's nationality must be one of these. */
  allowedCountries?: string[];
  /** ISO 3166-1 alpha-3 codes. A voter's nationality must not be one of these. */
  blockedCountries?: string[];
}

/**
 * Upper bound on either country list.
 *
 * Not a product decision. The disclosure circuit carries the forbidden list as
 * `uint256[4]`, so a list long enough to express "everyone except Spain" (194
 * codes) does not fit and never will. Rejecting it here produces an error the
 * organizer can act on, rather than a proof that fails to generate on the
 * voter's phone with no explanation.
 */
export const MAX_COUNTRY_LIST = 40;

/** Minimum age the wizard allows. Below this the policy is meaningless. */
export const MIN_AGE_FLOOR = 10;
export const MAX_AGE_CEILING = 99;

export function isEmptyPolicy(policy: EligibilityPolicy | null | undefined): boolean {
  if (!policy) return true;
  return (
    policy.minAge === undefined &&
    (policy.allowedCountries?.length ?? 0) === 0 &&
    (policy.blockedCountries?.length ?? 0) === 0
  );
}

function normaliseCountries(list: unknown, field: string): string[] | undefined {
  if (list === undefined || list === null) return undefined;
  if (!Array.isArray(list)) throw new Error(`${field} must be an array`);
  if (list.length === 0) return undefined;
  if (list.length > MAX_COUNTRY_LIST) {
    throw new Error(`${field} accepts at most ${MAX_COUNTRY_LIST} countries`);
  }

  const codes = list.map(entry => {
    if (typeof entry !== 'string' || !/^[A-Za-z]{3}$/.test(entry)) {
      throw new Error(`${field} entries must be ISO 3166-1 alpha-3 codes`);
    }
    return entry.toUpperCase();
  });

  const unique = [...new Set(codes)];
  // Sorted so that ["ESP","FRA"] and ["FRA","ESP"] are the same policy and
  // therefore the same hash.
  return unique.sort();
}

/**
 * Validates and normalises a policy from untrusted input (the wizard, or an
 * election's metadata read off chain).
 */
export function parsePolicy(raw: unknown): EligibilityPolicy {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('policy must be an object');

  const input = raw as Record<string, unknown>;
  const policy: EligibilityPolicy = {};

  if (input.minAge !== undefined && input.minAge !== null) {
    const age = Number(input.minAge);
    if (!Number.isInteger(age) || age < MIN_AGE_FLOOR || age > MAX_AGE_CEILING) {
      throw new Error(`minAge must be an integer between ${MIN_AGE_FLOOR} and ${MAX_AGE_CEILING}`);
    }
    policy.minAge = age;
  }

  const allowed = normaliseCountries(input.allowedCountries, 'allowedCountries');
  const blocked = normaliseCountries(input.blockedCountries, 'blockedCountries');

  // A country in both lists is a policy that can never be satisfied, and the
  // voter would only find out after scanning their passport.
  if (allowed && blocked) {
    const clash = allowed.filter(code => blocked.includes(code));
    if (clash.length > 0) {
      throw new Error(`countries listed as both allowed and blocked: ${clash.join(', ')}`);
    }
  }

  if (allowed) policy.allowedCountries = allowed;
  if (blocked) policy.blockedCountries = blocked;

  return policy;
}

/**
 * The exact bytes that get hashed. Keys in a fixed order, absent fields
 * omitted, arrays already sorted by `parsePolicy`.
 */
export function canonicalPolicyJson(policy: EligibilityPolicy): string {
  const ordered: Record<string, unknown> = {};
  if (policy.minAge !== undefined) ordered.minAge = policy.minAge;
  if (policy.allowedCountries?.length) ordered.allowedCountries = policy.allowedCountries;
  if (policy.blockedCountries?.length) ordered.blockedCountries = policy.blockedCountries;
  return JSON.stringify(ordered);
}

export const ZERO_HASH = `0x${'00'.repeat(32)}`;

/** An empty policy hashes to zero, matching the contract's "no policy" sentinel. */
export function policyHash(policy: EligibilityPolicy): string {
  if (isEmptyPolicy(policy)) return ZERO_HASH;
  return keccak256(toUtf8Bytes(canonicalPolicyJson(policy)));
}

/**
 * Checks a voter's disclosed attributes against the policy.
 *
 * `nationality` is only consulted when the policy names countries. When it does
 * not, the caller never asks the voter to reveal it, so it arrives empty and
 * must not be treated as a failure.
 */
export function checkAttributes(
  policy: EligibilityPolicy,
  attributes: { nationality?: string; minimumAgeProved?: number },
): { ok: true } | { ok: false; reason: string } {
  if (policy.minAge !== undefined) {
    const proved = attributes.minimumAgeProved ?? 0;
    if (proved < policy.minAge) return { ok: false, reason: 'min_age' };
  }

  // Trailing NUL bytes are how an undisclosed field comes back from the circuit,
  // and they are not an answer.
  const nationality = (attributes.nationality ?? '').replace(/\u0000+/g, '').trim().toUpperCase();

  // Only an ALLOWLIST needs the value. That is the case the voter was asked to
  // reveal it for, and there is no other way to check it: an exclusion list
  // cannot express "only these".
  if (policy.allowedCountries?.length) {
    if (!nationality) return { ok: false, reason: 'nationality_missing' };
    if (!policy.allowedCountries.includes(nationality)) {
      return { ok: false, reason: 'nationality_not_allowed' };
    }
  }

  // A blocklist is enforced inside the circuit, through `excludedCountries`, and
  // the voter is never asked to reveal anything for it. So this is defence in
  // depth over a value that legitimately arrives empty, and an empty one must
  // not be a rejection: requiring it here would fail every voter in every
  // "block these countries" election the moment the SDK trimmed those NUL bytes.
  if (nationality && policy.blockedCountries?.includes(nationality)) {
    return { ok: false, reason: 'nationality_blocked' };
  }

  return { ok: true };
}

/**
 * Whether satisfying this policy requires the voter to reveal their nationality
 * rather than merely prove a predicate about it.
 *
 * Self expresses country rules as an EXCLUSION list, so "only Spaniards" cannot
 * be phrased as a predicate: the allowed set would have to be written as the
 * 194 countries it excludes, which neither the circuit nor MAX_COUNTRY_LIST
 * allows. An allowlist therefore costs a reveal, and a blocklist does not.
 *
 * The reveal leaks less than it appears to. In an election whose published
 * policy already says "ESP only", learning that an enrolled voter is Spanish
 * adds nothing an observer could not read off the policy itself. It is still
 * discarded immediately rather than stored.
 */
export function requiresNationalityReveal(policy: EligibilityPolicy): boolean {
  return (policy.allowedCountries?.length ?? 0) > 0;
}
