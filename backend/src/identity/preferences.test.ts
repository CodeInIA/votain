import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { blobByteLength, isBase64Url, MAX_PREFERENCES_BYTES } from './preferences.js';

/**
 * What the contract guarantees is covered by the contract's own suite. What is
 * left here is the GUARD in front of it, and the reason it has to be exact.
 *
 * The size check is what decides whether a request becomes a transaction. Count
 * too low and a voter is told their settings do not fit when they do; count too
 * high and the transaction reverts after the relayer has paid to find out, with
 * an error naming a Solidity symbol nobody pressing a star can act on.
 */

describe('measuring a sealed blob before it becomes a transaction', () => {
  test('counts the bytes the chain will store, not the characters sent', () => {
    for (let n = 0; n < 64; n++) {
      const bytes = randomBytes(n);
      assert.equal(blobByteLength(bytes.toString('base64url')), n, `at ${n} bytes`);
    }
  });

  test('counts a padded base64 payload too', () => {
    // base64url normally arrives unpadded, but `btoa` output run through a
    // replace still carries `=`, and an over-count there would refuse a blob
    // that fits.
    for (let n = 1; n < 16; n++) {
      const bytes = randomBytes(n);
      assert.equal(blobByteLength(bytes.toString('base64')), n, `at ${n} bytes`);
    }
  });

  test('agrees with the contract at the exact boundary', () => {
    const atCap = randomBytes(MAX_PREFERENCES_BYTES).toString('base64url');
    const overCap = randomBytes(MAX_PREFERENCES_BYTES + 1).toString('base64url');
    assert.equal(blobByteLength(atCap), MAX_PREFERENCES_BYTES);
    assert.ok(blobByteLength(overCap) > MAX_PREFERENCES_BYTES);
  });

  test('accepts base64url and refuses anything else', () => {
    assert.ok(isBase64Url(''));
    assert.ok(isBase64Url(randomBytes(64).toString('base64url')));
    // The two characters base64url exists to avoid. A blob containing them was
    // encoded by something that is not the browser this expects, and decoding
    // it as base64url would silently change the bytes.
    assert.ok(!isBase64Url('ab+cd'));
    assert.ok(!isBase64Url('ab/cd'));
    assert.ok(!isBase64Url('not a blob'));
  });

  test('an empty blob is a value, because clearing is one', () => {
    // A voter who unsaves their last election writes an empty blob. Refusing it
    // would leave their other devices being served the previous list forever.
    assert.equal(blobByteLength(''), 0);
    assert.ok(isBase64Url(''));
  });
});
