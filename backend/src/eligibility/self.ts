/**
 * Self adapter.
 *
 * Turns an `EligibilityPolicy` into a Self verification request, and a Self
 * proof back into a pass or fail. This is the only file that knows Self exists;
 * everything else in `eligibility/` speaks in policies and attestations, so an
 * EUDI Wallet connector could be added beside this one without touching them.
 *
 * WHAT REACHES THIS SERVER. A zero-knowledge proof and its public signals. The
 * document is read by the Self app against the chip's own NFC interface and
 * never leaves the voter's device. Either a biometric passport or a national
 * identity card will do: the voter presents whichever they hold, because Self
 * offers no per-request document selection. What comes back is a set of answers to the
 * questions the policy asked, plus a nullifier scoped to this election.
 *
 * WHAT WE ASK FOR, AND WHAT WE REFUSE TO ASK FOR. Age is always a predicate:
 * `minimumAge` yields a yes or no and the date of birth stays on the phone.
 * Nationality is a predicate too when the policy blocks countries, because Self
 * expresses that natively as an exclusion list. It becomes a reveal only when
 * the policy names allowed countries, because an exclusion list cannot express
 * an allowlist (see `requiresNationalityReveal`). Nothing else is ever
 * requested: not the name, not the document number, not the gender, not the
 * expiry date. The revealed nationality is compared and dropped, never stored.
 *
 * WHY THE SCOPE IS PER ELECTION. The scope is what the nullifier is derived
 * from. A single app-wide scope would hand this server one stable pseudonym per
 * voter across every election they ever verify for, which is a correlation
 * handle it has no business holding. A per-election scope means the same voter
 * verifying for two elections produces two unrelated values. It also means a
 * verifier per election rather than one long-lived instance, which is why the
 * config store here is the single-config kind: each verifier serves exactly one
 * election's rules.
 *
 * Env:
 *   SELF_ENDPOINT   public HTTPS URL of the verify route. Must be reachable
 *                   from the internet: the Self relayer posts to it, so
 *                   localhost does not work and development needs a tunnel.
 *   SELF_MOCK       "1" to accept mock passports generated in the Self app.
 *                   Test and live documents are cryptographically distinct, so
 *                   this cannot silently let a mock through in production.
 */
import {
  SelfBackendVerifier,
  DefaultConfigStore,
  ConfigMismatchError,
  ATTESTATION_ID,
  type AttestationId,
  type VerificationConfig,
} from '@selfxyz/core';
// Subpath rather than the package root: the builders are not re-exported there,
// and this is the same entry point `@selfxyz/core` itself imports
// `getUniversalLink` from.
import { SelfAppBuilder, getUniversalLink } from '@selfxyz/common/utils/appType';
import {
  checkAttributes,
  requiresNationalityReveal,
  type EligibilityPolicy,
} from './policy.js';

/**
 * Documents this platform accepts.
 *
 * A biometric passport or a national identity card, both of which carry the
 * data groups the circuit reads and can satisfy country rules. Named through the
 * SDK's own constants rather than the raw 1 and 2, so a renumbering shows up as
 * a compile error instead of silently admitting the wrong document type.
 *
 * Aadhaar is deliberately absent: Self documents it as unable to satisfy country
 * rules, so an election restricted by nationality would accept a document that
 * cannot answer the question it asks.
 */
const ALLOWED_DOCUMENT_IDS = new Map<AttestationId, boolean>([
  [ATTESTATION_ID.PASSPORT, true],
  [ATTESTATION_ID.BIOMETRIC_ID_CARD, true],
]);

export function isSelfConfigured(): boolean {
  return Boolean(process.env.SELF_ENDPOINT);
}

export function isMockMode(): boolean {
  return process.env.SELF_MOCK === '1';
}

/**
 * Scope seed for an election.
 *
 * Self calls this field `scope`, but what goes in is a SEED: the value actually
 * bound into the proof is Poseidon(seed, endpoint), so the final scope depends on
 * `SELF_ENDPOINT` as well. Two consequences worth remembering. Changing that URL,
 * a fresh development tunnel for instance, changes the effective scope and
 * invalidates any QR generated before it. And an election keeps distinct
 * nullifiers only for as long as its seed is distinct, which is what the address
 * guarantees here.
 *
 * Derived from the address rather than a counter so both sides can compute it
 * from the election alone, with no shared state. 25 characters, inside the 31
 * the builder enforces, with room left for the prefix to change.
 */
export function scopeForElection(electionAddress: string): string {
  return `votain-${electionAddress.toLowerCase().slice(2, 20)}`;
}

/**
 * The verification rules for a policy, in Self's vocabulary.
 *
 * `allowedCountries` produces no rule here on purpose: Self only understands
 * exclusion, so an allowlist is enforced after the fact against the revealed
 * nationality in `verifyProof`.
 */
export function selfConfigFor(policy: EligibilityPolicy): VerificationConfig {
  const config: VerificationConfig = {};
  if (policy.minAge !== undefined) config.minimumAge = policy.minAge;
  if (policy.blockedCountries?.length) {
    config.excludedCountries = policy.blockedCountries as VerificationConfig['excludedCountries'];
  }
  return config;
}

/**
 * The disclosure block the frontend hands to `SelfAppBuilder`.
 *
 * Self requires the frontend request and the backend config to agree, so both
 * are generated from the same policy here rather than written twice.
 */
export function selfDisclosuresFor(policy: EligibilityPolicy): Record<string, unknown> {
  const config = selfConfigFor(policy);
  const disclosures: Record<string, unknown> = { ...config };
  if (requiresNationalityReveal(policy)) disclosures.nationality = true;
  return disclosures;
}

/**
 * The deep link the voter opens, built by Self's own builder.
 *
 * WHY NOT BY HAND, AND WHY NOT IN THE BROWSER. This payload is a moving target:
 * it gained a `selfDefinedData` field and changed the staging chain id between
 * two releases, and a hand-copied version of it goes stale silently, producing a
 * QR the app half understands. `SelfAppBuilder` also validates as it goes, so a
 * localhost endpoint, a scope over the limit or a malformed identifier fail here
 * with a clear message instead of on the voter's phone.
 *
 * It lives on this side because `@selfxyz/qrcode` is a React component from the
 * legacy SDK whose job is to draw a QR and hold a websocket open. The drawing is
 * three lines with a library the frontend already has, and the websocket is
 * redundant: the proof reaches this server directly from Self's relayer, and the
 * browser learns the outcome by polling the session it opened. Building the link
 * here keeps that dependency, and its React version constraints, out of the app
 * altogether.
 */
export function buildUniversalLink(params: {
  appName: string;
  scope: string;
  endpoint: string;
  sessionId: string;
  disclosures: Record<string, unknown>;
  mock: boolean;
  /**
   * Where the Self app sends the voter once it is done. Only meaningful when
   * the link is opened on the same device that Votain is on, so it is set for
   * the tappable mobile link and left off the QR: a voter scanning from a
   * desktop would otherwise be redirected on their phone, away from the screen
   * they are actually looking at.
   */
  deeplinkCallback?: string;
}): string {
  const app = new SelfAppBuilder({
    version: 2,
    appName: params.appName,
    ...(params.deeplinkCallback ? { deeplinkCallback: params.deeplinkCallback } : {}),
    scope: params.scope,
    endpoint: params.endpoint,
    userId: params.sessionId,
    userIdType: 'uuid',
    // Off-chain verification: the endpoint is our HTTPS route, not a contract.
    // The staging variant is what pairs with a verifier in mock mode.
    endpointType: params.mock ? 'staging_https' : 'https',
    disclosures: params.disclosures,
  }).build();

  return getUniversalLink(app);
}

/**
 * Accepts a return URL for the mobile deep link, or nothing.
 *
 * The value arrives from the browser and is written into a payload the Self app
 * will navigate to, and shows it to the voter while it counts down, so it is not
 * a string to pass through untouched. Anything but http or https is refused
 * outright. In production it must also belong to the configured frontend, which
 * keeps this from being talked into minting a link that sends voters elsewhere;
 * development stays open because the dev server is reached over a LAN address
 * that no configuration knows in advance.
 */
export function sanitiseCallbackUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;

  const frontend = process.env.FRONTEND_URL;
  if (process.env.NODE_ENV === 'production') {
    if (!frontend) return undefined;
    try {
      if (new URL(frontend).origin !== url.origin) return undefined;
    } catch {
      return undefined;
    }
  }

  return url.toString();
}

/**
 * Recovers the session id (a UUID) a proof was generated for, from the request's
 * `userContextData` rather than from the proof itself.
 *
 * WHY NOT THE PUBLIC SIGNALS. The obvious-looking slot,
 * `pubSignals[userIdentifierIndex]`, does not hold the identifier: it holds a
 * SHA-256 hash of the whole `userContextData`, which the SDK recomputes and
 * compares as an integrity check. Reading it as an identifier yields a value
 * that matches no session. The identifier lives in `userContextData` itself,
 * laid out as 32 bytes of destination chain id, then 32 bytes of user
 * identifier, then the caller's own data; this mirrors the SDK's own
 * `userContextData.slice(64, 128)`.
 *
 * That also takes the circuit out of the picture. Public signal indices belong
 * to a circuit version and can move under an SDK upgrade; this layout is part of
 * the request format.
 *
 * Reading it is not trusting it. It only selects which election's scope the
 * proof is then verified against, and the SDK checks that the hash in the proof
 * matches this very data, so a tampered identifier fails verification anyway.
 */
export function readSessionIdFromContext(userContextData: unknown): string | null {
  if (typeof userContextData !== 'string') return null;

  const hex = userContextData.startsWith('0x') ? userContextData.slice(2) : userContextData;
  if (hex.length < 128) return null;

  try {
    // Mirrors the SDK's castToUUID: a field element rendered as 32 hex digits,
    // then punctuated. The slot is 32 bytes wide and a UUID is 16, so the top
    // half is zero and padStart restores what toString(16) drops.
    const raw = BigInt('0x' + hex.slice(64, 128)).toString(16).padStart(32, '0');
    if (raw.length !== 32) return null;

    const uuid = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)
      ? uuid
      : null;
  } catch {
    return null;
  }
}

export interface SelfProofSubmission {
  attestationId: AttestationId;
  proof: { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] };
  pubSignals: string[];
  userContextData: string;
}

export interface SelfVerdict {
  ok: boolean;
  /** Session id the proof was generated for, taken from the proof itself. */
  userIdentifier?: string;
  reason?: string;
  /** Diagnostic detail for the log. Never sent to the voter. */
  detail?: string;
}

/**
 * Verifies a submitted proof against the election's policy.
 *
 * Two layers of checking, and both matter. The SDK proves the document is
 * genuine and that the predicates baked into the proof hold; `checkAttributes`
 * then applies the parts of the policy Self cannot express. Skipping the second
 * would let an allowlist election accept any nationality at all.
 */
export async function verifyProof(
  electionAddress: string,
  policy: EligibilityPolicy,
  submission: SelfProofSubmission,
): Promise<SelfVerdict> {
  if (!isSelfConfigured()) return { ok: false, reason: 'not_configured' };

  const verifier = new SelfBackendVerifier(
    scopeForElection(electionAddress),
    process.env.SELF_ENDPOINT as string,
    isMockMode(),
    ALLOWED_DOCUMENT_IDS,
    new DefaultConfigStore(selfConfigFor(policy)),
    'uuid',
  );

  let result;
  try {
    result = await verifier.verify(
      submission.attestationId,
      submission.proof,
      submission.pubSignals,
      submission.userContextData,
    );
  } catch (error: unknown) {
    // A ConfigMismatchError says exactly which expectation failed: InvalidScope
    // when the proof was built for another election, InvalidRoot when the
    // document is not in the tree this hub serves (which is what a real document
    // verified in mock mode looks like), InvalidTimestamp when a clock drifted.
    // Flattening those into "proof_invalid" throws away the one piece of
    // information that makes the failure actionable.
    if (error instanceof ConfigMismatchError) {
      const issues = error.issues?.map(issue => issue.type).join(', ') ?? 'unknown';
      console.error(`Self verification rejected the proof: ${issues}`);
      return { ok: false, reason: 'proof_invalid', detail: issues };
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error('Self verification threw:', message);
    return { ok: false, reason: 'proof_invalid', detail: message.slice(0, 200) };
  }

  const userIdentifier = result.userData?.userIdentifier;

  if (!result.isValidDetails.isValid) return { ok: false, userIdentifier, reason: 'proof_invalid' };
  if (!result.isValidDetails.isMinimumAgeValid) {
    return { ok: false, userIdentifier, reason: 'min_age' };
  }

  // The circuit echoes back the THRESHOLD it proved, never the voter's age. The
  // SDK's type calls it `minimumAge` while the published API reference still
  // calls it `olderThan`, so both are read.
  //
  // An earlier version substituted `policy.minAge` when neither field could be
  // read, meaning to survive a rename. That was a rubber stamp: it compared the
  // policy against itself and always passed. It was never reachable with a
  // failing proof, because the SDK's own verdict is
  // `config.minimumAge <= parseInt(disclosed.minimumAge)`, which is false for a
  // missing field (NaN) and false for the "00" that means no age was proved, and
  // `isMinimumAgeValid` is checked above. But a check that cannot fail is worse
  // than no check, so an unreadable threshold is now a rejection.
  const disclosed = result.discloseOutput as
    | (typeof result.discloseOutput & { olderThan?: string })
    | undefined;
  const provedThreshold = Number(disclosed?.minimumAge ?? disclosed?.olderThan ?? 0) || undefined;

  const attributes = checkAttributes(policy, {
    nationality: disclosed?.nationality,
    minimumAgeProved: provedThreshold,
  });
  if (!attributes.ok) return { ok: false, userIdentifier, reason: attributes.reason };

  return { ok: true, userIdentifier };
}
