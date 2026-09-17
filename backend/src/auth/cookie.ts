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
