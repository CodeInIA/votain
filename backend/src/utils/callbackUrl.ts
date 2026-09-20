/**
 * Accepts a return URL for a mobile deep link, or nothing.
 *
 * TWO CALLERS, ONE RULE. Self gets one of these so its app can hand the voter
 * back, and World ID gets one as `return_to` for the same reason. Both write
 * the value into a payload that another app will NAVIGATE TO, on this
 * platform's behalf, so neither is a string to pass through untouched: an
 * endpoint that accepts any URL here is an open redirect wearing Votain's
 * name, and the voter has no way to tell.
 *
 * Anything but http or https is refused outright. In production it must also
 * belong to the configured frontend. Development stays open because the dev
 * server is reached over a LAN address or a tunnel that no configuration knows
 * in advance.
 */
export function sanitiseCallbackUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;

  const frontend = process.env.FRONTEND_URL;
  if (process.env.NODE_ENV === 'production') {
    if (!frontend) return undefined;
    try {
      if (new URL(frontend).origin !== url.origin) return undefined;
    } catch {
      return undefined;
    }
  }

  return url.toString();
}
