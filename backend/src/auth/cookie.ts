/**
 * The voter session cookie: one name, one set of attributes, one reader.
 *
 * It was `voter_vc`, set with `secure` only in production and read by eight
 * routes each naming the string themselves. Two things were wrong with that.
 *
 * THE PREFIX. `__Host-` is not decoration: a browser refuses to store a cookie
 * with that name unless it is `Secure`, has `Path=/` and carries no `Domain`,
 * and those three together are what stop a SIBLING SUBDOMAIN from writing it.
 * Without them, anything running on any `*.votain.app` can set a cookie for the
 * parent domain, overwrite the session and choose which credential this server
 * reads back. With the frontend and the backend on one domain, that is the
 * vector this design has left, and the prefix closes it for one line of code.
 *
 * DEVELOPMENT IS HTTPS HERE, through the Cloudflare tunnel, so the same cookie
 * is used in both: there is no "works in production only" path to discover
 * late, and the session is exercised in development exactly as it will be
 * deployed. `COOKIE_INSECURE=1` exists for running against plain
 * `http://localhost`, and it drops both the `Secure` flag and the prefix,
 * because the prefix without the flag is a cookie the browser will not keep.
 *
 * ONE READER. The name is now written once, and every route asks this module,
 * so renaming it cannot leave a route reading a cookie nobody sets.
 */
import type { Request, Response } from 'express';

/** The name a browser enforces the three attributes for. */
const HOST_PREFIXED = '__Host-voter_vc';
/** Its plain counterpart, for a deployment that cannot serve HTTPS. */
const PLAIN = 'voter_vc';

/** Seven days, which is also the credential's own `exp`. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The verification in flight, under the same two names. See below. */
const PENDING_HOST_PREFIXED = '__Host-voter_pending';
const PENDING_PLAIN = 'voter_pending';

/** Matches `PENDING_TTL_MS` in `worldIdBridge`: the cookie dies with its entry. */
const PENDING_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Whether this deployment is serving over plain HTTP.
 *
 * ONE VARIABLE, read here, rather than inferred from `NODE_ENV`. The two are
 * not the same question: development over the tunnel is HTTPS and wants the
 * secure cookie, and inferring it from the mode gave the opposite answer.
 */
function insecure(): boolean {
  return process.env.COOKIE_INSECURE === '1';
}

export function sessionCookieName(): string {
  return insecure() ? PLAIN : HOST_PREFIXED;
}

/** Issues the session cookie. */
export function setSessionCookie(res: Response, credential: string): void {
  res.cookie(sessionCookieName(), credential, {
    httpOnly: true,
    secure: !insecure(),
    sameSite: 'strict',
    // Both required by `__Host-`, and correct without it: the session belongs
    // to the whole app and to this host alone.
    path: '/',
    maxAge: MAX_AGE_MS,
  });
}

/**
 * Ends the session in the browser.
 *
 * The attributes have to match the ones it was set with or the browser keeps
 * the cookie, which is the classic way a "sign out" leaves somebody signed in.
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(sessionCookieName(), {
    httpOnly: true,
    secure: !insecure(),
    sameSite: 'strict',
    path: '/',
  });
}

/**
 * The credential this request carries, under either name.
 *
 * BOTH ARE READ, and the prefixed one wins. A browser that stored the old
 * `voter_vc` before this change keeps sending it until it expires, and a voter
 * should not be signed out by a deployment. Once both are present the prefixed
 * one is the one this server issued.
 */
export function readSessionCookie(req: Request): string | undefined {
  const jar = req.cookies as Record<string, string | undefined> | undefined;
  return jar?.[HOST_PREFIXED] ?? jar?.[PLAIN];
}

/**
 * The verification this browser has in flight, named in a cookie it cannot read.
 *
 * WHY A COOKIE AND NOT A RESPONSE FIELD THE PAGE KEEPS. The whole problem being
 * solved is that the page does not survive: a phone discards the backgrounded
 * tab while its owner is in World App, and whatever the page was holding goes
 * with it. A cookie is the one thing that outlives that, and the browser sends
 * it back on its own, so the reloaded page does not have to remember anything.
 *
 * `httpOnly`, because the id stands for a World ID proof: whoever presents it
 * is signed in as that human. Script on this page never needs to see it, so it
 * never does, and an injection that would otherwise read it out of storage
 * gets nothing.
 *
 * `lax` RATHER THAN `strict`, and it is the one place the two differ here. The
 * session cookie is only ever sent by this app's own fetches, where `strict`
 * costs nothing. This one has to survive World App handing the person back to
 * this origin, which is a cross-site top-level navigation: `strict` withholds
 * the cookie on exactly that load, which is the load that needs it. `lax`
 * sends it on a top-level GET and withholds it from cross-site subrequests,
 * which is the distinction that matters.
 */
export function pendingCookieName(): string {
  return insecure() ? PENDING_PLAIN : PENDING_HOST_PREFIXED;
}

export function setPendingCookie(res: Response, pendingId: string): void {
  res.cookie(pendingCookieName(), pendingId, {
    httpOnly: true,
    secure: !insecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: PENDING_MAX_AGE_MS,
  });
}

export function clearPendingCookie(res: Response): void {
  res.clearCookie(pendingCookieName(), {
    httpOnly: true,
    secure: !insecure(),
    sameSite: 'lax',
    path: '/',
  });
}

export function readPendingCookie(req: Request): string | undefined {
  const jar = req.cookies as Record<string, string | undefined> | undefined;
  return jar?.[PENDING_HOST_PREFIXED] ?? jar?.[PENDING_PLAIN];
}
