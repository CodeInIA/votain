import { describe, it, expect } from 'vitest';

import { deriveTallyKeys, isInSubgroup } from './ballotCrypto';
import { keysMatch, parseTallyKeys, randomTallyKeys, serializeTallyKeys } from './tallyKey';

/**
 * Regression vector for the organizer's tally keys.
 *
 * The keys are never stored: they are re-derived from the organizer's wallet
 * every time a tally is run. That makes the derivation a COMPATIBILITY SURFACE,
 * not an implementation detail. Any change that yields different keys for the
 * same (secret, keyNonce) silently destroys the ability to count every
 * election created before the change. If this fails, the derivation moved:
 * that is a breaking change, not a test to fix.
 */
const SECRET = new Uint8Array(32).fill(7);
const KEY_NONCE = '0xdeadbeefdeadbeefdeadbeefdeadbeef';

describe('tally key derivation', () => {
  it('reproduces the pinned keys for a fixed secret and nonce', async () => {
    const { secrets } = await deriveTallyKeys(SECRET, KEY_NONCE, 3);
    expect(secrets.map(x => x.toString(16))).toMatchInlineSnapshot(`
      [
        "1b4142ba27b9babea471ccd7d7421970f1341f1d8154a9022ff6f2b8f4a366",
        "4996cf5371c7da1167fa9531323d798ee54670be6c8d413426c4f172435ba7c",
        "1023796c805efea65658495e025cf1d19613884bc0c4e3338552c4ace7115a3",
      ]
    `);
  });

  it('gives keys in the prime subgroup, distinct per slot and per nonce', async () => {
    const a = await deriveTallyKeys(SECRET, KEY_NONCE, 4);
    const b = await deriveTallyKeys(SECRET, '0x00000000000000000000000000000001', 4);
    expect(a.keys.every(isInSubgroup)).toBe(true);
    expect(new Set(a.secrets).size).toBe(4);
    expect(a.secrets[0]).not.toBe(b.secrets[0]);
  });
});

describe('the key file', () => {
  it('round-trips, and rebuilds the same public keys from the secrets alone', async () => {
    const keys = await randomTallyKeys(3);
    const back = parseTallyKeys(serializeTallyKeys(keys));
    expect(back.secrets).toEqual(keys.secrets);
    expect(keysMatch(back.keys, keys.keys)).toBe(true);
  });

  it('refuses what is not a key file', () => {
    expect(() => parseTallyKeys('not json')).toThrow(/invalid JSON/);
    expect(() => parseTallyKeys('{"n":"0x1","g":"0x2"}')).toThrow(/tally key file/);
    expect(() => parseTallyKeys('{"version":2,"secrets":[]}')).toThrow(/tally key file/);
  });

  it('tells keys of another election apart', async () => {
    const a = await randomTallyKeys(3);
    const b = await randomTallyKeys(3);
    expect(keysMatch(a.keys, b.keys)).toBe(false);
    expect(keysMatch(a.keys, a.keys.slice(1))).toBe(false);
  });
});
