/**
 * World ID proof verification.
 *
 * Shared by first-time verification and by identity recovery. Recovery in
 * particular must NOT settle for a session cookie: a stolen session would then
 * be enough to rebind a voter's identity to the attacker's passkey. Only a fresh
 * proof of personhood establishes that the caller is the human behind the
 * nullifier, because World ID derives it from their World App identity.
 *
 * THE CREDENTIAL LEVEL IS CHECKED HERE, AND IT HAS TO BE. The frontend asks for
 * a level, but the request is the client's to build: it can ask for anything,
 * and the verify API confirms that a proof is valid, not that it is the KIND of
 * proof we wanted. Until this checked, a device-level proof verified and was
 * accepted as if it were an Orb.
 *
 * THE MINIMUM IS AN ARGUMENT, NOT A CONSTANT, because two callers want different
 * answers. Sign-in accepts any credential: Orbs were withdrawn from Spain and
 * World ID's document credential is not issued there yet, so demanding personhood
 * at the door would lock out the voters this platform is for. An election that
 * asks for Orb demands it at enrollment instead, where a refusal costs one
 * election rather than the whole account.
 *
 * What sign-in therefore no longer establishes is that the account is a person.
 * `ElectionV4.enroll` still deduplicates on this nullifier, which now means one
 * ACCOUNT; personhood comes from the document nullifier the contract records
 * separately. See `eligibility/` and `usedPersonhoodNullifiers`.
 */

/**
 * Identifiers that mean "verified at an Orb", across protocol versions.
 * World ID 3.0 proofs report `orb`; 4.0 reports `proof_of_human`; the
 * authenticator uses `poh`. All three are the same credential.
 */
const ORB_IDENTIFIERS = new Set(['orb', 'proof_of_human', 'poh']);

/** Issuer schema of the Proof of Human credential, present on 4.0 proofs. */
const ORB_SCHEMA_ID = 1;

/**
 * How much a credential is worth for personhood, which is the only axis that
 * matters here.
 *
 * Document sits below Orb because it is unique per DOCUMENT rather than per
 * human, and above the rest because World ID refuses a second enrollment of the
 * same document. Device and Selfie share the floor: World ID documents Selfie
 * Check as carrying no one-person-one-account guarantee, so for this purpose it
 * is worth exactly what a device is.
 */
export type CredentialLevel = 'any' | 'document' | 'orb';

const LEVEL_RANK: Record<CredentialLevel, number> = { any: 0, document: 1, orb: 2 };

/** Issuer schema of the NFC document credential (ICAO 9303). */
const DOCUMENT_SCHEMA_ID = 9303;
const DOCUMENT_IDENTIFIERS = new Set(['passport', 'document', 'secure_document', 'my-number-card']);

export interface WorldIdResult {
  ok: boolean;
  nullifier?: string;
  /** The level the accepted proof actually reached, at or above the minimum. */
  level?: CredentialLevel;
  error?: unknown;
}

interface WorldIdResponseEntry {
  identifier?: string;
  issuer_schema_id?: number;
  nullifier?: string;
}

/** The bits of an IDKit payload we inspect; anything else is passed through. */
export type WorldIdPayload = {
  responses?: WorldIdResponseEntry[];
  nullifier_hash?: string;
} & Record<string, unknown>;

interface VerifyResultEntry {
  identifier?: string;
  success?: boolean;
  nullifier?: string;
}

interface VerifyResponseBody {
  results?: VerifyResultEntry[];
  nullifier?: string;
}

/**
 * Whether one response describes an Orb credential.
 *
 * The schema id is authoritative when present, because it is a number the
 * protocol assigns rather than a label. Only 3.0 proofs, which have no schema
 * id, fall back to the identifier string.
 */
function levelOf(entry: WorldIdResponseEntry | VerifyResultEntry): CredentialLevel {
  const schemaId = (entry as WorldIdResponseEntry).issuer_schema_id;
  if (typeof schemaId === 'number') {
    if (schemaId === ORB_SCHEMA_ID) return 'orb';
    if (schemaId === DOCUMENT_SCHEMA_ID) return 'document';
    return 'any';
  }

  const identifier = typeof entry.identifier === 'string' ? entry.identifier.toLowerCase() : '';
  if (ORB_IDENTIFIERS.has(identifier)) return 'orb';
  if (DOCUMENT_IDENTIFIERS.has(identifier)) return 'document';
  return 'any';
}

function meets(entry: WorldIdResponseEntry | VerifyResultEntry, minimum: CredentialLevel): boolean {
  return LEVEL_RANK[levelOf(entry)] >= LEVEL_RANK[minimum];
}

/** How a rejected credential is named in the log, without dumping the proof. */
function describe(entry: WorldIdResponseEntry): string {
  const parts = [entry.identifier ?? 'unnamed'];
  if (typeof entry.issuer_schema_id === 'number') parts.push(`schema ${entry.issuer_schema_id}`);
  return parts.join(', ');
}

/** The strongest level any response in a payload CLAIMS, before verification. */
export function payloadLevel(payload: WorldIdPayload): CredentialLevel {
  return highestLevel(payload.responses ?? []);
}

function highestLevel(entries: Array<WorldIdResponseEntry | VerifyResultEntry>): CredentialLevel {
  return entries.reduce<CredentialLevel>(
    (best, entry) => (LEVEL_RANK[levelOf(entry)] > LEVEL_RANK[best] ? levelOf(entry) : best),
    'any',
  );
}

function lowestLevel(entries: Array<WorldIdResponseEntry | VerifyResultEntry>): CredentialLevel {
  return entries.reduce<CredentialLevel>(
    (worst, entry) => (LEVEL_RANK[levelOf(entry)] < LEVEL_RANK[worst] ? levelOf(entry) : worst),
    'orb',
  );
}

/** Whether the API named this result well enough to attribute a level to it. */
function isNamed(entry: VerifyResultEntry): boolean {
  return Boolean(entry.identifier) || typeof (entry as WorldIdResponseEntry).issuer_schema_id === 'number';
}

/**
 * The level that was actually PROVED, which is not the level that was claimed.
 *
 * This is the difference between a label and a fact, and the session is later
 * asked to stand as authorisation for an Orb-gated election, so the difference
 * matters. A 200 means "at least one of these verified": a payload declaring an
 * Orb credential alongside a real device one gets that 200 on the strength of
 * the device proof, and reading the level off the declaration would record the
 * sender as Orb verified on the basis of an entry nothing checked.
 *
 * Where the answer cannot be attributed, the LOWEST declared level is recorded
 * rather than the highest. Understating costs a voter one more verification;
 * overstating hands them an election they were never entitled to enter.
 */
function verifiedLevel(
  body: VerifyResponseBody | null,
  declared: WorldIdResponseEntry[],
): CredentialLevel {
  const succeeded = (Array.isArray(body?.results) ? body.results : []).filter(
    entry => entry.success !== false,
  );

  const named = succeeded.filter(isNamed);
  if (named.length > 0) return highestLevel(named);

  // Nothing itemised. With a single declared response there is only one thing
  // the 200 can be about; with several there is no way to tell which.
  if (declared.length === 1) return levelOf(declared[0]);
  return lowestLevel(declared);
}

/**
 * The nullifier of the credential that actually verified.
 *
 * A 200 from the API means "at least one proof verified", not "all of them", so
 * the entry has to be picked rather than assumed. Every declared response was
 * already checked to be Orb-level before the call, which is what makes the
 * later fallbacks safe: whatever verified was an Orb credential.
 */
function verifiedNullifier(
  body: VerifyResponseBody | null,
  declared: WorldIdResponseEntry[],
  minimum: CredentialLevel,
): string {
  const results = Array.isArray(body?.results) ? body.results : [];
  const succeeded = results.filter(entry => entry.success !== false);

  const named = succeeded.find(entry => meets(entry, minimum) && entry.nullifier);
  if (named?.nullifier) return named.nullifier;

  // The response did not name the credential per entry. Safe because of the
  // pre-check above.
  if (succeeded.length === 1 && succeeded[0].nullifier) return succeeded[0].nullifier;
  if (typeof body?.nullifier === 'string' && body.nullifier) return body.nullifier;

  return declared.length === 1 ? (declared[0].nullifier ?? '') : '';
}

/**
 * Verifies a proof against the World ID API and returns the nullifier it
 * carries. The nullifier is deterministic per (human, app, action), so the same
 * person always yields the same value.
 *
 * Rejects anything below `minimum`.
 */
export async function verifyWorldIdProof(
  payload: WorldIdPayload,
  minimum: CredentialLevel = 'any',
): Promise<WorldIdResult> {
  const rpId = process.env.WORLD_ID_RP_ID;
  if (!rpId) throw new Error('WORLD_ID_RP_ID not configured');

  const declared = payload.responses ?? [];
  if (declared.length === 0) return { ok: false, error: 'proof carried no responses' };

  // Refused before the API call, and refused for EVERY response rather than
  // just the first: a payload mixing an Orb proof with a weaker one must not
  // pass on the strength of the one that happened to be checked.
  const weaker = declared.filter(entry => !meets(entry, minimum));
  if (weaker.length > 0) {
    const named = weaker.map(describe).join('; ');
    console.error(`World ID proof rejected, credential below ${minimum}: ${named}`);
    return { ok: false, error: `proof does not reach the required level (${minimum})` };
  }

  const res = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => null)) as VerifyResponseBody | null;
  if (!res.ok) return { ok: false, error: body };

  const nullifier = verifiedNullifier(body, declared, minimum);
  if (!nullifier) return { ok: false, error: 'proof carried no nullifier' };

  return { ok: true, nullifier, level: verifiedLevel(body, declared) };
}
