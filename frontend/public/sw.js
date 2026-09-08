/**
 * The service worker that makes Votain installable, and nothing more.
 *
 * Chrome will not offer "Install app" (and will not mint a WebAPK on Android)
 * without a worker that handles fetch. That requirement puts a cache in front
 * of a voting application, which is a liability worth being deliberate about:
 * a stale shell means old verification code running against a new backend, and
 * the person running it has no way to tell.
 *
 * So this is NETWORK FIRST, always. The network answer wins whenever there is
 * one, the cache exists only to answer when there is not, and a deployment
 * takes effect on the next load rather than whenever a worker decides to
 * refresh. The trade is a slower cold start than a cache-first worker, which is
 * the right way round for this application.
 *
 * WHAT IS NEVER CACHED, and this is the important half:
 *
 * - Anything cross-origin. The backend API, the RPC endpoint, World ID and Self
 *   all live elsewhere, and a cached answer from any of them would be a lie
 *   about the state of an election.
 * - Anything that is not a GET. Nothing that changes state is repeatable.
 * - `/api/` on this origin, for the same reason, in case the backend is ever
 *   served from the same host.
 */

const VERSION = 'votain-v1';
const SHELL = `${VERSION}-shell`;

// Only the entry point. Hashed assets are cached as they are fetched, so this
// list cannot go stale against a build.
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then(cache => cache.addAll(PRECACHE))
      // A failed precache must not block the install: the worker is still
      // useful, it just starts with an empty cache.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Same-origin GETs that are not API calls. Everything else goes straight out. */
function isCacheable(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return true;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (!isCacheable(request)) return; // straight to the network, unobserved

  event.respondWith(
    fetch(request)
      .then(response => {
        // Only complete, successful answers are worth keeping. An opaque or
        // partial response cached here would be served back as if it were the
        // real thing.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(SHELL).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // A navigation with nothing cached still has to render something, and
        // the app router handles the path once it boots.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        throw new Error('offline and not cached');
      }),
  );
});
