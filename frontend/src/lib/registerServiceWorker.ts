/**
 * Registers the worker that makes the app installable.
 *
 * PRODUCTION ONLY. In development a worker sitting in front of the dev server
 * intercepts module requests and serves yesterday's code with today's edits, a
 * failure that looks like the bundler misbehaving rather than a cache. Vite
 * serves nothing at `/sw.js` in dev anyway.
 *
 * Registration is deliberately fire and forget: the app works identically
 * without it, so a browser that refuses (private mode, an unsupported engine,
 * a locked-down profile) gets no error and no degraded path. Only the install
 * prompt is lost, which is what the worker is there for.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  // After load, so registration never competes with the first render for
  // bandwidth on a slow connection.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Nothing to recover: an unregistered worker only costs installability.
    });
  });
}
