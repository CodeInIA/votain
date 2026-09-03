import { describe, it, expect } from 'vitest';

import { toHex, fromHex } from './organizerVault';

/**
 * The credential id crossing between the browser and the chain.
 *
 * Worth its own test because getting it wrong is silent: the ids simply stop
 * matching, `getTallyMasterSecret` finds no entry for the passkey in hand, and
 * an organizer who owns a perfectly good vault is told their passkey cannot
 * open it.
 */

describe('credential id encoding', () => {
  it('survives the round trip', () => {
    // A real WebAuthn id: 32 bytes, base64url, unpadded.
    const id = 'qPHcyvtCqetzRd2HvV8xTgqXo0hqTvJDgVsSg5Y0dHM';
    expect(fromHex(toHex(id))).toBe(id);
  });

  it('keeps the two characters base64url renames', () => {
    // "+" and "/" become "-" and "_", and a padded value would not match the
    // unpadded one the authenticator returns.
    const id = 'a-b_cd-ef_gh';
    const hex = toHex(id);
    expect(hex.startsWith('0x')).toBe(true);
    expect(fromHex(hex)).toBe(id);
    expect(fromHex(hex)).not.toContain('=');
  });

  it('handles every input length, not just the aligned ones', () => {
    // Base64 pads to a multiple of four; ids that need one or two pad
    // characters are the ones a naive decoder drops bytes from.
    for (const raw of ['AQ', 'AQI', 'AQID', 'AQIDBA']) {
      expect(fromHex(toHex(raw))).toBe(raw);
    }
  });

  it('produces two hex digits per byte', () => {
    // A byte below 16 losing its leading zero shifts every byte after it.
    const id = fromHex('0x000102030f10');
    expect(toHex(id)).toBe('0x000102030f10');
  });
});
