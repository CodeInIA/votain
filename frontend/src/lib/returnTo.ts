/**
 * Where to send someone once they have finished signing up.
 *
 * WHY THIS EXISTS. Someone follows a link to an election, presses "verify to
 * vote", and disappears into onboarding: four slides, a World ID
 * verification, then the identity step. That flow ends on the voter's list of
 * elections, and the election they came for is gone. They have to find it
 * again, on a platform where the whole point of the link was that they were
 * invited to that one vote.
 *
 * WHY NOT ROUTER STATE, which is the obvious answer and is already half
 * wired: `RequireVoter` attaches `state={{ from }}` to its redirect, and
 * nothing has ever read it. It cannot survive this flow. The verification
 * ends with `navigate('/voter/identity', { replace: true })`, a fresh
 * destination with no state carried, and the slides in between push their own
 * history. An intent that has to outlive several navigations and a replace
 * does not belong in the navigation.
 *
 * SESSION STORAGE, not local. The intent belongs to this tab and this visit:
 * a link opened in a new tab should not redirect a different tab, and an
 * abandoned sign up should not still be pulling somebody to an election a
 * week later. It is the same choice `signedOutOf` makes for the same reason.
 *
 * ONLY EVER AN IN-APP PATH. The value is fed to `navigate`, so anything that
 * could read as another origin is refused on the way in rather than trusted
 * on the way out: a stored `//evil.example` would otherwise become a
 * protocol-relative URL and take the person off the site.
 */

const KEY = 'votain_return_to';

/**
 * Places that are not somewhere to come back TO.
 *
 * The sign-up screens themselves, which would loop, and the landing page,
 * which is where someone starts rather than where they were going. Refused
 * here rather than at each call site: the header offers to sign in from every
 * page in the app, so the one thing that must not depend on the caller
 * getting it right is which pages count.
 */
const NOT_A_DESTINATION = [
  '/',
  '/voter/signin',
  '/voter/onboarding',
  '/voter/identity',
  '/voter/recover',
  '/organizer/auth',
];

/** A path within this app: one leading slash, and no second one after it. */
function isInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
}

/** Worth returning to: inside the app, and not part of getting into it. */
function isWorthReturningTo(path: string): boolean {
  if (!isInternalPath(path)) return false;
  const bare = path.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return !NOT_A_DESTINATION.includes(bare);
}

/**
 * Remember where to come back to, replacing anything remembered before.
 *
 * Called at the moment someone is sent away, by the screen sending them, so
 * the intent is recorded by the only code that knows what it was.
 */
export function rememberReturnTo(path: string): void {
  try {
    if (!isWorthReturningTo(path)) return;
    sessionStorage.setItem(KEY, path);
  } catch {
    // Private mode, or storage refused. Coming back to the list instead of
    // the election is a worse ending, not a broken one.
  }
}

/**
 * Take the destination, if there is one, and forget it.
 *
 * READ AND CLEAR IN ONE STEP, deliberately. A destination that survived being
 * used would fire again on the next sign in, sending someone to an election
 * they have already dealt with and cannot explain arriving at.
 */
export function takeReturnTo(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return path && isWorthReturningTo(path) ? path : null;
  } catch {
    return null;
  }
}

/** Forget it without going there, for a flow that ended somewhere else. */
export function forgetReturnTo(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do: an unreadable store is also an unwritable one.
  }
}
