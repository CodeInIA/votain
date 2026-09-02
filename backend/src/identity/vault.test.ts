import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { toHex, fromHex } from './vault.js';

/**
 * The vault moved from a file on this server into `PlatformRegistry`, so what
 * the contract guarantees is covered by the contract's own suite and what the
 * whole path does is covered by `contracts/scripts/e2e-vault.ts` against a real
 * node. What is left here, and what those cannot catch, is the ENCODING seam.
 *
 * It matters more than it looks. The browser speaks base64url, because that is
 * what WebAuthn hands it and what `atob` reads; Solidity `bytes` arrive as hex.
 * A blob that does not survive the round trip decrypts to nothing, and the
 * voter is told their passkey does not open their identity, which is the one
 * failure with no way back.
 */

describe('vault encoding', () => {
  test('survives a round trip byte for byte', () => {
    for (let i = 0; i < 64; i++) {
      const original = randomBytes(1 + i).toString('base64url');
      assert.equal(fromHex(toHex(original)), original);
    }
  });

  test('handles the AES-GCM blob shape the app actually stores', () => {
    // 12 bytes of iv, then ciphertext and tag. Close to what a sealed Semaphore
    // secret weighs, which is what will sit on chain.
    const blob = Buffer.concat([randomBytes(12), randomBytes(80)]).toString('base64url');
    assert.equal(fromHex(toHex(blob)), blob);
    assert.match(toHex(blob), /^0x[0-9a-f]+$/);
  });

  test('produces the hex a contract would', () => {
    // "hi" is 0x6869, and base64url of those two bytes is "aGk".
    assert.equal(toHex('aGk'), '0x6869');
    assert.equal(fromHex('0x6869'), 'aGk');
  });

  test('reads hex back with or without the prefix', () => {
    assert.equal(fromHex('6869'), 'aGk');
  });

  test('keeps base64url distinct from base64', () => {
    // WebAuthn credential ids routinely contain bytes that base64 renders as
    // `+` and `/`. Decoding one as the other silently corrupts the credential
    // id, and the browser then matches no entry at all.
    const tricky = Buffer.from([0xfb, 0xff, 0xbf]).toString('base64url');
    assert.ok(!tricky.includes('+') && !tricky.includes('/'));
    assert.equal(fromHex(toHex(tricky)), tricky);
  });

  test('round trips an empty string, which the contract then refuses', () => {
    // Not a valid entry, and `EmptyVaultEntry` is what stops it reaching
    // storage. Worth knowing the conversion does not invent bytes for it.
    assert.equal(toHex(''), '0x');
    assert.equal(fromHex('0x'), '');
  });
});
