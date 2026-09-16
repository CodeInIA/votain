/**
 * Noticing that the voter's session has run out, wherever it is noticed.
 *
 * THE GAP THIS FILLS. The session lives in an httpOnly cookie holding a
 * credential that expires after seven days, and `AuthProvider` reconciled it
 * against `/api/me` exactly once, when the app mounted. Anything that happened
 * afterwards went unseen: a tab left open over a weekend, a laptop that slept
 * for a week, a credential revoked by the issuer. The interface went on
 * offering the voter their name, their history and an enrol button, and the
 * first sign of trouble was an action failing for reasons that read like a
 * fault of theirs.
 *
 * Three things notice, and they all end up here:
 *   - the clock, because `/api/me` now says when the credential expires;
 *   - coming back to the tab, because the answer may have changed while away;
 *   - any authenticated request answered with 401, which is the backend
 *     saying it plainly.
 */

/** Fired when something learns the session is gone. */
export const SESSION_EXPIRED_EVENT = 'votain:voter-session-expired';

/**
 * Fired when the session is fine and the IDENTITY behind it is not: the
 * registry holds this human under a commitment this browser does not have.
 * Not an ending, so it has an event of its own: the way out is a passkey or a
 * recovery phrase, not another World ID scan.
 */
export const IDENTITY_MISMATCH_EVENT = 'votain:voter-identity-mismatch';

/**
 * Why the session ended, because the two reasons lead to different sentences.
 *
 *   expired       the credential ran out, or was revoked. Seven days is the
 *                 ordinary case and there is nothing wrong.
 *   unregistered  the chain has never heard of this human. The platform was
 *                 redeployed, or this is a different one: the cookie outlived
 *                 the registry it was issued against.
 */
export type SessionEndReason = 'expired' | 'unregistered';

/**
 * How long one announcement silences the next.
 *
 * A screen that loads four authenticated things at once gets four 401s within
 * a few milliseconds, and each one is the same news. Without this the voter is
 * told four times.
 */
const QUIET_MS = 5_000;

let announcedAt = 0;

/**
 * Says the session is over, at most once per burst.
 *
 * Safe to call from anywhere, including a module with no React around it: it
 * dispatches on `window` and whoever is listening decides what to do.
 */
export function announceSessionExpired(reason: SessionEndReason = 'expired'): void {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  if (now - announcedAt < QUIET_MS) return;
  announcedAt = now;

  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { reason } }));
}

let mismatchAnnouncedAt = 0;

/** The same courtesy for the identity notice: once per burst. */
export function announceIdentityMismatch(): void {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  if (now - mismatchAnnouncedAt < QUIET_MS) return;
  mismatchAnnouncedAt = now;

  window.dispatchEvent(new Event(IDENTITY_MISMATCH_EVENT));
}

/** Lets a fresh sign-in be announced again without waiting out the quiet. */
export function resetSessionExpiryNotice(): void {
  announcedAt = 0;
  mismatchAnnouncedAt = 0;
}

/**
 * What a 401 means for a request that carried the session cookie.
 *
 * Returns whether it was one, so a caller can keep its own handling of the
 * body while this takes care of the session.
 */
export function noticeUnauthorized(status: number): boolean {
  if (status !== 401) return false;
  announceSessionExpired();
  return true;
}

/**
 * How long until a credential expires, in milliseconds.
 *
 * `expiresAt` is in SECONDS, as JWT claims are, and the browser counts in
 * milliseconds: multiplying it was the first thing to get wrong. Anything
 * already past returns 0, so the caller ends the session now rather than
 * scheduling a timer in the past.
 *
 * Capped, because `setTimeout` takes a 32-bit delay: a timer set further out
 * than about 24.8 days fires IMMEDIATELY, which would sign out a voter the
 * moment they arrived. The cap makes a long-lived credential wake up early and
 * ask again instead.
 */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

export function msUntilExpiry(expiresAt: number | undefined, now: number = Date.now()): number | null {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  const remaining = expiresAt * 1000 - now;
  if (remaining <= 0) return 0;
  return Math.min(remaining, MAX_TIMER_MS);
}
