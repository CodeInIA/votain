/**
 * Where the backend is, said once.
 *
 * AN EMPTY `VITE_BACKEND_URL` IS A VALID SETTING and means "this app's own
 * origin". That is how the dev server is configured: it proxies `/api` to the
 * backend so the page, the session cookie and the API all share one origin,
 * which is what testing on a phone requires (`frontend/DEVELOPMENT.md`
 * explains why an https page cannot call an http backend, and why the
 * `SameSite=strict` cookie will not cross two tunnel subdomains).
 *
 * Five modules used to keep their own copy of this, four of them throwing
 * "VITE_BACKEND_URL is not configured" on an empty value. That was right while
 * empty meant "somebody forgot", and became a bug the moment empty started
 * meaning "same origin": signing in with World ID failed with a configuration
 * error on a configuration that was correct.
 *
 * Nothing validates it any more, because there is nothing left to validate: a
 * blank value is a working deployment and a wrong value is a wrong value, which
 * only the request can discover. Production sets it to the real host, and
 * `frontend/.env.example` says so.
 */
const CONFIGURED = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() ?? "";

/** The base every backend path is built on. Empty means this app's origin. */
export function backendBase(): string {
  // A trailing slash would produce `//api/...`, which some servers treat as a
  // different path and others as a protocol-relative URL.
  return CONFIGURED.replace(/\/+$/, "");
}

/** `backendUrl("/api/me")` on any of the three configurations. */
export function backendUrl(path: string): string {
  return `${backendBase()}${path}`;
}

/**
 * The same, with query parameters, and ABSOLUTE even when the base is empty.
 *
 * `new URL("/api/x")` throws `TypeError: Invalid URL`. A bare path is not a URL
 * without something to resolve it against, and the empty base that means "this
 * app's own origin" produces exactly that. `fetch` accepts a relative string
 * happily, which is why every other call site survived and only the three that
 * needed query parameters, and reached for `new URL` to build them, did not.
 *
 * It broke the organizer's domain verifier outright: typing any domain reported
 * "that does not look like a domain name", because the message shown was the
 * thrown error's, and the thrown error was the browser's opinion of our URL.
 */
export function backendQuery(path: string, params: Record<string, string>): string {
  const url = new URL(backendUrl(path), window.location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
