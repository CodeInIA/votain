/**
 * World ID proof verification.
 *
 * Shared by first-time verification and by identity recovery. Recovery in
 * particular must NOT settle for a session cookie: a stolen session would then
 * be enough to rebind a voter's identity to the attacker's passkey. Only a fresh
 * proof of personhood establishes that the caller is the human behind the
 * nullifier, because World ID derives it from their World App identity.
 */

export interface WorldIdResult {
  ok: boolean;
  nullifier?: string;
  error?: unknown;
}

/** The bits of an IDKit payload we forward; anything else is passed through. */
export type WorldIdPayload = {
  responses?: Array<{ nullifier?: string }>;
  nullifier_hash?: string;
} & Record<string, unknown>;

/**
 * Verifies a proof against the World ID API and returns the nullifier it
 * carries. The nullifier is deterministic per (human, app, action), so the same
 * person always yields the same value.
 */
export async function verifyWorldIdProof(payload: WorldIdPayload): Promise<WorldIdResult> {
  const rpId = process.env.WORLD_ID_RP_ID;
  if (!rpId) throw new Error('WORLD_ID_RP_ID not configured');

  const res = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return { ok: false, error: await res.json().catch(() => null) };
  }

  const nullifier = payload.responses?.[0]?.nullifier ?? payload.nullifier_hash ?? '';
  if (!nullifier) return { ok: false, error: 'proof carried no nullifier' };

  return { ok: true, nullifier };
}
