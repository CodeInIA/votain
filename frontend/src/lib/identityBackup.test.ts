import { describe, it, expect } from 'vitest';

import { buildBackup, parseBackup, backupFilename } from './identityBackup';

/**
 * The escape hatch of last resort, so its failure modes matter more than most.
 *
 * A backup that parses but is wrong produces a passkey that "does not open your
 * identity", which to a voter is indistinguishable from having lost it. Every
 * rejection below exists so the app can say which file is wrong instead.
 */

const vault = {
  commitment: '12345678901234567890',
  entries: [
    { credentialId: 'Y3JlZC1vbmU', blob: 'YmxvYi1vbmU', addedAt: '2026-09-01T10:00:00.000Z' },
    { credentialId: 'Y3JlZC10d28', blob: 'YmxvYi10d28', addedAt: '2026-09-02T10:00:00.000Z' },
  ],
};

describe('building a backup', () => {
  it('carries every sealed copy, not just the one in use', () => {
    // A voter restoring on a third device may hold any of their passkeys, and
    // the file is no use if it only fits the one they had at export time.
    const backup = buildBackup(vault);
    expect(backup.entries).toHaveLength(2);
    expect(backup.commitment).toBe(vault.commitment);
    expect(backup.format).toBe('votain-identity-backup');
  });

  it('refuses to export a voter who has no identity', () => {
    expect(() => buildBackup({ commitment: null, entries: [] })).toThrow(/no identity/i);
  });

  it('names the file so two identities do not overwrite each other', () => {
    const name = backupFilename(buildBackup(vault));
    expect(name).toMatch(/^votain-identity-12345678-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe('reading a backup back', () => {
  const round = () => parseBackup(JSON.stringify(buildBackup(vault)));

  it('survives the round trip', () => {
    const parsed = round();
    expect(parsed.commitment).toBe(vault.commitment);
    expect(parsed.entries.map(e => e.blob)).toEqual(['YmxvYi1vbmU', 'YmxvYi10d28']);
  });

  it('rejects a file that is not JSON at all', () => {
    expect(() => parseBackup('not json')).toThrow(/not a Votain identity backup/);
  });

  it('rejects JSON that is not one of ours', () => {
    // Someone will eventually pick the wrong file out of their downloads.
    expect(() => parseBackup('{"hello":"world"}')).toThrow(/not a Votain identity backup/);
  });

  it('rejects a backup from a newer version of the app', () => {
    // Reading a shape we do not know would mean guessing at a voter's identity.
    const future = { ...buildBackup(vault), version: 99 };
    expect(() => parseBackup(JSON.stringify(future))).toThrow(/newer version/);
  });

  it('rejects a backup with no commitment to check against', () => {
    // Without it there is nothing to compare the decrypted identity to, and a
    // file from another voter would pass silently.
    const broken = { ...buildBackup(vault), commitment: 'not-a-number' };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(/no identity commitment/);
  });

  it('rejects a backup with no sealed keys', () => {
    const empty = { ...buildBackup(vault), entries: [] };
    expect(() => parseBackup(JSON.stringify(empty))).toThrow(/no sealed keys/);
  });

  it('rejects an entry missing its ciphertext', () => {
    const partial = { ...buildBackup(vault), entries: [{ credentialId: 'abc' }] };
    expect(() => parseBackup(JSON.stringify(partial))).toThrow(/missing part of a sealed key/);
  });
});
