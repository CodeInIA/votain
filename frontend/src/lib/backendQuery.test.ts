import { describe, it, expect } from 'vitest';
import { backendQuery, backendUrl } from './backend';

/**
 * Building a backend URL that carries query parameters.
 *
 * `VITE_BACKEND_URL` is EMPTY in the configuration this project actually runs
 * under: the dev server proxies `/api`, so the page, the session cookie and the
 * API share one origin, which is what testing from a phone requires. Empty is
 * therefore correct, not a missing setting.
 *
 * `fetch` takes a relative string happily, so every call site built on plain
 * string concatenation worked. The three that needed query parameters reached
 * for `new URL`, which does NOT: a bare path has nothing to resolve against and
 * the constructor throws `TypeError: Invalid URL`.
 *
 * That broke the organizer's domain verifier outright. Typing any domain at all
 * answered "that does not look like a domain name", because the toast showed
 * the thrown error's message and the thrown error was the browser's opinion of
 * our own URL, formed before a request was ever made.
 */
describe('backendQuery', () => {
  it('produces an absolute URL when the backend is this app\'s own origin', () => {
    // The empty-base case: the one that used to throw.
    expect(backendUrl('/api/organizer/domain-status')).toBe('/api/organizer/domain-status');

    const url = backendQuery('/api/organizer/domain-status', {
      address: '0xabc',
      domain: 'elections.example.org',
    });

    expect(() => new URL(url)).not.toThrow();
    expect(url).toContain('/api/organizer/domain-status');
    expect(new URL(url).searchParams.get('address')).toBe('0xabc');
    expect(new URL(url).searchParams.get('domain')).toBe('elections.example.org');
  });

  it('escapes what a domain field can legitimately contain', () => {
    // Encoding is the reason to use `URL` rather than build the string by hand.
    const url = backendQuery('/api/organizer/domain-status', {
      address: '0x1',
      domain: 'a b&c=d',
    });
    expect(url).not.toContain('a b&c=d');
    expect(new URL(url).searchParams.get('domain')).toBe('a b&c=d');
  });
});
