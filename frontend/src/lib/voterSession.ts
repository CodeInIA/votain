/**
 * What this browser remembers about the voter's own World ID session.
 *
 * The session itself lives in the httpOnly `voter_vc` cookie, which JavaScript
 * cannot read by design. `GET /api/me` reports what is inside it, and
 * `AuthProvider` reconciles against that once per load; this module is where
 * the answer is parked so the rest of the app can ask synchronously.
 *
 * NEVER A SECURITY BOUNDARY, exactly like `votain_voter_logged_in` beside it.
 * Anyone can write `orb` into their own localStorage. What that buys them is a
 * green tick on a requirements list: the backend reads the level out of the
 * signed credential, not out of this, and refuses to sign an attestation for an
 * Orb election without it. This value exists so the page can stop PROMISING a
 * voter something the enrollment will then refuse, which is the opposite
 * mistake and the one that was actually being made.
 */

const PERSONHOOD_KEY = 'voter_personhood';

/** As the backend names them: the floor is `any`, not `device`. */
export type CredentialLevel = 'any' | 'document' | 'orb';

const KNOWN: readonly string[] = ['any', 'document', 'orb'];

export function storeVoterPersonhood(level: string | undefined | null): void {
  if (level && KNOWN.includes(level)) localStorage.setItem(PERSONHOOD_KEY, level);
  else localStorage.removeItem(PERSONHOOD_KEY);
}

/**
 * `null` when nothing is known: no session, a backend that could not be
 * reached, or a credential issued before the claim existed. Callers must read
 * that as "unproved", never as "the lowest level", because the two lead to
 * different screens.
 */
export function getVoterPersonhood(): CredentialLevel | null {
  const stored = localStorage.getItem(PERSONHOOD_KEY);
  return stored && KNOWN.includes(stored) ? (stored as CredentialLevel) : null;
}

export function clearVoterPersonhood(): void {
  localStorage.removeItem(PERSONHOOD_KEY);
}
