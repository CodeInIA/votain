import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readSessionIdFromContext, scopeForElection, sanitiseCallbackUrl } from './self.js';

/**
 * `userContextData` layout, mirroring what the Self app sends and what the SDK
 * itself reads with `userContextData.slice(64, 128)`:
 *
 *   [ 32 bytes destination chain id ][ 32 bytes user identifier ][ caller data ]
 */
function buildContext(uuid: string, userDefinedData = ''): string {
  const chainId = '00'.repeat(32);
  const identifier = uuid.replace(/-/g, '').padStart(64, '0');
  return chainId + identifier + userDefinedData;
}

describe('readSessionIdFromContext', () => {
  test('recovers the session id the challenge was opened with', () => {
    const uuid = 'd321d627-6b47-42e4-920a-39b23883c96f';
    assert.equal(readSessionIdFromContext(buildContext(uuid)), uuid);
  });

  test('ignores whatever the caller appended after the identifier', () => {
    const uuid = '72846467-4287-4cde-9a30-3ab1894149fc';
    assert.equal(readSessionIdFromContext(buildContext(uuid, 'ab'.repeat(64))), uuid);
  });

  test('accepts the hex with or without an 0x prefix', () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    assert.equal(readSessionIdFromContext('0x' + buildContext(uuid)), uuid);
  });

  test('restores leading zeros the field element dropped', () => {
    // A UUID starting with zeros is a smaller integer, so its hex rendering is
    // shorter and has to be padded back to 32 digits before punctuating.
    const uuid = '00000000-0000-0000-0000-0000000000ff';
    assert.equal(readSessionIdFromContext(buildContext(uuid)), uuid);
  });

  test('rejects anything too short to hold an identifier', () => {
    assert.equal(readSessionIdFromContext('00'.repeat(40)), null);
    assert.equal(readSessionIdFromContext(''), null);
  });

  test('rejects a non-string, which is what a malformed body produces', () => {
    assert.equal(readSessionIdFromContext(12345), null);
    assert.equal(readSessionIdFromContext(undefined), null);
    assert.equal(readSessionIdFromContext(null), null);
    assert.equal(readSessionIdFromContext({ userContextData: 'x' }), null);
  });

  test('rejects hex it cannot parse rather than throwing', () => {
    assert.equal(readSessionIdFromContext('zz'.repeat(64)), null);
  });
});

describe('scopeForElection', () => {
  test('stays inside the 25 character limit Self enforces', () => {
    const scope = scopeForElection('0x121C11ca1b262E7A6EC03243a3CCaF826c3EcF62');
    assert.ok(scope.length <= 25, `scope was ${scope.length} characters: ${scope}`);
  });

  test('is derived from the address alone, so both sides agree with no shared state', () => {
    const address = '0x121C11ca1b262E7A6EC03243a3CCaF826c3EcF62';
    assert.equal(scopeForElection(address), scopeForElection(address.toLowerCase()));
  });

  test('separates elections, which is what keeps their nullifiers unlinkable', () => {
    assert.notEqual(
      scopeForElection('0x121C11ca1b262E7A6EC03243a3CCaF826c3EcF62'),
      scopeForElection('0x08AB489C878Cc3F12E52953FFde61A298359D998'),
    );
  });
});

describe('sanitiseCallbackUrl', () => {
  test('accepts an ordinary page URL', () => {
    assert.equal(
      sanitiseCallbackUrl('https://votain.app/voter/election/0xabc'),
      'https://votain.app/voter/election/0xabc',
    );
  });

  test('accepts the LAN address a phone reaches the dev server on', () => {
    // `vite --host` serves on the network, which is the only way the same-device
    // flow can be exercised before deployment.
    assert.equal(
      sanitiseCallbackUrl('http://192.168.1.40:5173/voter/election/0xabc'),
      'http://192.168.1.40:5173/voter/election/0xabc',
    );
  });

  test('refuses schemes that are not http or https', () => {
    // This value ends up in a payload the Self app navigates to, and is shown
    // to the voter while it counts down.
    assert.equal(sanitiseCallbackUrl('javascript:alert(1)'), undefined);
    assert.equal(sanitiseCallbackUrl('data:text/html,<script>'), undefined);
    assert.equal(sanitiseCallbackUrl('file:///etc/passwd'), undefined);
  });

  test('refuses anything that is not a URL at all', () => {
    assert.equal(sanitiseCallbackUrl('not a url'), undefined);
    assert.equal(sanitiseCallbackUrl(''), undefined);
    assert.equal(sanitiseCallbackUrl(undefined), undefined);
    assert.equal(sanitiseCallbackUrl(42), undefined);
    assert.equal(sanitiseCallbackUrl('https://votain.app/' + 'x'.repeat(600)), undefined);
  });

  test('in production, only the configured frontend is allowed', () => {
    const env = { NODE_ENV: process.env.NODE_ENV, FRONTEND_URL: process.env.FRONTEND_URL };
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://votain.app';
    try {
      assert.equal(sanitiseCallbackUrl('https://votain.app/voter'), 'https://votain.app/voter');
      // Otherwise this endpoint would mint Self links that send voters away.
      assert.equal(sanitiseCallbackUrl('https://evil.example/voter'), undefined);
      assert.equal(sanitiseCallbackUrl('http://192.168.1.40:5173/voter'), undefined);
    } finally {
      process.env.NODE_ENV = env.NODE_ENV;
      process.env.FRONTEND_URL = env.FRONTEND_URL;
    }
  });
});
