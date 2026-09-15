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
