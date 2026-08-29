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
 * Orb, but the request is the client's to build: it can ask for anything, and
 * the verify API confirms that a proof is valid, not that it is the KIND of
 * proof we wanted. Until this checked, a device-level or selfie proof verified
 * and was accepted as if it were an Orb.
 *
 * That is not cosmetic. `ElectionV4.enroll` deduplicates on this nullifier and
 * treats it as one human; only Proof of Human carries that guarantee. A weaker
 * credential turns one-person-one-vote into one-device-one-vote without any
 * visible sign.
 */

/**
 * Identifiers that mean "verified at an Orb", across protocol versions.
 * World ID 3.0 proofs report `orb`; 4.0 reports `proof_of_human`; the
 * authenticator uses `poh`. All three are the same credential.
 */
const ORB_IDENTIFIERS = new Set(['orb', 'proof_of_human', 'poh']);

/** Issuer schema of the Proof of Human credential, present on 4.0 proofs. */
const ORB_SCHEMA_ID = 1;

export interface WorldIdResult {
  ok: boolean;
  nullifier?: string;
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
function isOrbCredential(entry: WorldIdResponseEntry | VerifyResultEntry): boolean {
  const schemaId = (entry as WorldIdResponseEntry).issuer_schema_id;
  if (typeof schemaId === 'number') return schemaId === ORB_SCHEMA_ID;
  return typeof entry.identifier === 'string' && ORB_IDENTIFIERS.has(entry.identifier.toLowerCase());
}

/** How a rejected credential is named in the log, without dumping the proof. */
function describe(entry: WorldIdResponseEntry): string {
  const parts = [entry.identifier ?? 'unnamed'];
  if (typeof entry.issuer_schema_id === 'number') parts.push(`schema ${entry.issuer_schema_id}`);
  return parts.join(', ');
}

/**
 * The nullifier of the credential that actually verified.
 *
 * A 200 from the API means "at least one proof verified", not "all of them", so
 * the entry has to be picked rather than assumed. Every declared response was
 * already checked to be Orb-level before the call, which is what makes the
 * later fallbacks safe: whatever verified was an Orb credential.
 */
function verifiedNullifier(body: VerifyResponseBody | null, declared: WorldIdResponseEntry[]): string {
  const results = Array.isArray(body?.results) ? body.results : [];
  const succeeded = results.filter(entry => entry.success !== false);

  const named = succeeded.find(entry => isOrbCredential(entry) && entry.nullifier);
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
 * Rejects anything below Orb.
 */
export async function verifyWorldIdProof(payload: WorldIdPayload): Promise<WorldIdResult> {
  const rpId = process.env.WORLD_ID_RP_ID;
  if (!rpId) throw new Error('WORLD_ID_RP_ID not configured');

  const declared = payload.responses ?? [];
  if (declared.length === 0) return { ok: false, error: 'proof carried no responses' };

  // Refused before the API call, and refused for EVERY response rather than
  // just the first: a payload mixing an Orb proof with a weaker one must not
  // pass on the strength of the one that happened to be checked.
  const weaker = declared.filter(entry => !isOrbCredential(entry));
  if (weaker.length > 0) {
    const named = weaker.map(describe).join('; ');
    console.error(`World ID proof rejected, credential below Orb: ${named}`);
    return { ok: false, error: 'proof is not an Orb verification' };
  }

  const res = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => null)) as VerifyResponseBody | null;
  if (!res.ok) return { ok: false, error: body };

  const nullifier = verifiedNullifier(body, declared);
  if (!nullifier) return { ok: false, error: 'proof carried no nullifier' };

  return { ok: true, nullifier };
}
