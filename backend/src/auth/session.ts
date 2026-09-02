/**
 * Voter session verification.
 *
 * The session IS the SD-JWT credential issued after World ID verification,
 * carried in the `voter_vc` httpOnly cookie. Its `sub` is the voter's World ID
 * nullifier, which every authenticated endpoint keys off.
 *
 * The signature MUST be checked before that `sub` is trusted. Decoding the
 * payload alone is not authentication: a JWT is three base64url segments, so
 * anyone can craft `header.{"sub":"<anything>","exp":<future>}.garbage` and be
 * taken for that voter. Since the vault write path registers the resulting
 * commitment in PlatformRegistry, an unverified session would let an attacker
 * enrol arbitrary identities and break Sybil resistance outright.
 */
import { sdJwt, type VotainCredentialPayload } from '../sd/issuer.js';
import { isRevoked } from '../status/statusList.js';
import type { CredentialLevel } from './worldId.js';

export interface Session {
  /** World ID nullifier (the credential subject). */
  nullifier: string;
  /**
   * Credential level this session was signed in with. `undefined` on sessions
   * issued before the claim existed, and an election demanding an Orb must
   * treat that as "not proved" rather than assume the best.
   */
  personhood?: CredentialLevel;
  payload: VotainCredentialPayload;
}

/**
 * Verifies the cookie and returns the session, or null when it is missing,
 * forged, expired or revoked.
 */
export async function verifySession(vc: string | undefined): Promise<Session | null> {
  if (!vc) return null;

  let payload: VotainCredentialPayload;
  try {
    // Checks the Ed25519 signature against the issuer public key. Throws on any
    // tampering, including a payload swapped under a valid-looking signature.
    const verified = await sdJwt.verify(vc);
    payload = verified.payload as VotainCredentialPayload;
  } catch {
    return null;
  }

  if (typeof payload?.sub !== 'string' || payload.sub.length === 0) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;

  // A revoked credential must not keep an active session alive.
  const index = payload.credentialStatus?.statusListIndex;
  if (index !== undefined && (await isRevoked(Number(index)))) return null;

  return { nullifier: payload.sub, personhood: payload.personhood, payload };
}
