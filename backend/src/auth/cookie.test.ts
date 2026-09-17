import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { sessionCookieName, readSessionCookie } from './cookie.js';

/**
 * The name and the attributes of the session cookie, which a browser enforces
 * and nothing here can check for itself.
 *
 * `__Host-` is refused by the browser unless the cookie is `Secure`, has
 * `Path=/` and carries no `Domain`, and those three are exactly what stops a
 * sibling subdomain writing a session for the parent domain. So the rule these
 * tests hold is the one that can go wrong in code: the prefix and the flag are
 * never out of step, because a prefixed cookie without `Secure` is simply not
 * stored and the voter's sign-in silently does nothing.
 */

const original = process.env.COOKIE_INSECURE;

afterEach(() => {
  if (original === undefined) delete process.env.COOKIE_INSECURE;
  else process.env.COOKIE_INSECURE = original;
});

const asRequest = (cookies: Record<string, string>) => ({ cookies }) as never;

describe('the session cookie', () => {
  test('carries the prefix that keeps subdomains out of it', () => {
    delete process.env.COOKIE_INSECURE;
    assert.equal(sessionCookieName(), '__Host-voter_vc');
  });

  test('drops the prefix only where it drops Secure', () => {
    // A `__Host-` cookie without `Secure` is not stored at all, so the two have
    // to move together. Plain HTTP is the one deployment that needs it.
    process.env.COOKIE_INSECURE = '1';
    assert.equal(sessionCookieName(), 'voter_vc');
  });

  test('reads a session left by the old name', () => {
    // A browser that stored `voter_vc` before this change keeps sending it
    // until it expires, and a deployment must not sign those voters out.
    assert.equal(readSessionCookie(asRequest({ voter_vc: 'old' })), 'old');
  });

  test('prefers the prefixed one when a browser holds both', () => {
    const both = { voter_vc: 'old', '__Host-voter_vc': 'current' };
    assert.equal(readSessionCookie(asRequest(both)), 'current');
  });

  test('answers undefined for a request with no cookies at all', () => {
    assert.equal(readSessionCookie({} as never), undefined);
    assert.equal(readSessionCookie(asRequest({})), undefined);
  });
});
