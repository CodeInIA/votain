/**
 * Where the backend is.
 *
 * The interesting case is the empty one. It used to mean "somebody forgot to
 * configure this" and four modules threw on it; it now means "this app's own
 * origin", which is how the dev server is set up so that the page, the session
 * cookie and the API share an origin. Signing in with World ID failed with a
 * configuration error on a configuration that was correct.
 */
import { describe, it, expect } from 'vitest';

import { backendBase, backendUrl } from './backend';

describe('the backend base', () => {
  it('is empty when nothing is configured, meaning this origin', () => {
    // vitest runs with no VITE_BACKEND_URL, which is the same shape the dev
    // server uses and the case that used to throw.
    expect(backendBase()).toBe('');
  });

  it('builds a path that stays on this origin', () => {
    expect(backendUrl('/api/me')).toBe('/api/me');
  });

  it('never doubles the slash', () => {
    // `//api/me` is a protocol-relative URL to a host called "api" in a
    // browser, and a different path on some servers. Neither is what anyone
    // meant by leaving a trailing slash in an environment variable.
    expect(backendUrl('/api/me')).not.toContain('//api');
  });
});
