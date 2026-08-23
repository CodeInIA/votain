/**
 * Vault behaviour around identity recovery.
 *
 * The chain enforces "one active identity per human" in `PlatformRegistry`;
 * these cover the store that has to stay in step with it. A vault left holding
 * blobs sealed under a lost passkey, or holding the pre-rotation commitment,
 * would silently disagree with the registry and every later enroll would fail
 * with an error that points nowhere near the cause.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { getVault, putVaultEntry, resetVault, CommitmentMismatchError } from './vault.js';

// Own store per test file: node:test runs files in parallel, and sharing
// one path made these suites truncate each other's data mid-run.
const DATA_FILE = join(tmpdir(), 'votain-recovery-test-vault.json');
process.env.IDENTITY_VAULT_FILE = DATA_FILE;

const NULLIFIER = '0xlostphone';
const OLD_COMMITMENT = '11111111111111111111';
const NEW_COMMITMENT = '22222222222222222222';

beforeEach(() => {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  if (existsSync(DATA_FILE)) rmSync(DATA_FILE);
});

describe('Identity recovery', () => {
  test('replaces the commitment and drops every stale blob', () => {
    putVaultEntry(NULLIFIER, OLD_COMMITMENT, { credentialId: 'lost-phone', blob: 'sealed-by-phone' });
    putVaultEntry(NULLIFIER, OLD_COMMITMENT, { credentialId: 'lost-tablet', blob: 'sealed-by-tablet' });

    const record = resetVault(NULLIFIER, NEW_COMMITMENT, {
      credentialId: 'new-laptop',
      blob: 'sealed-by-laptop',
    });

    assert.equal(record.commitment, NEW_COMMITMENT);
    // The old blobs wrap a secret nobody can decrypt any more; keeping them
    // would only leave junk that can never open.
    assert.deepEqual(record.entries.map(e => e.credentialId), ['new-laptop']);
  });

  test('the recovered identity is the only one the vault will accept afterwards', () => {
    putVaultEntry(NULLIFIER, OLD_COMMITMENT, { credentialId: 'lost-phone', blob: 'old' });
    resetVault(NULLIFIER, NEW_COMMITMENT, { credentialId: 'new-laptop', blob: 'new' });

    // Adding a device to the recovered identity is fine...
    putVaultEntry(NULLIFIER, NEW_COMMITMENT, { credentialId: 'new-phone', blob: 'new2' });
    assert.equal(getVault(NULLIFIER)?.entries.length, 2);

    // ...but the pre-rotation commitment is dead, and so is any third one.
    assert.throws(
      () => putVaultEntry(NULLIFIER, OLD_COMMITMENT, { credentialId: 'zombie', blob: 'x' }),
      CommitmentMismatchError,
    );
    assert.throws(
      () => putVaultEntry(NULLIFIER, '33333333333333333333', { credentialId: 'other', blob: 'x' }),
      CommitmentMismatchError,
    );
  });

  test('recovery touches only the human who asked for it', () => {
    putVaultEntry(NULLIFIER, OLD_COMMITMENT, { credentialId: 'a', blob: 'a' });
    putVaultEntry('0xsomeoneelse', '99999999999999999999', { credentialId: 'b', blob: 'b' });

    resetVault(NULLIFIER, NEW_COMMITMENT, { credentialId: 'c', blob: 'c' });

    assert.equal(getVault(NULLIFIER)?.commitment, NEW_COMMITMENT);
    assert.equal(getVault('0xsomeoneelse')?.commitment, '99999999999999999999');
    assert.equal(getVault('0xsomeoneelse')?.entries.length, 1);
  });

  test('recovering a voter who never had a vault just creates one', () => {
    const record = resetVault('0xbrandnew', NEW_COMMITMENT, { credentialId: 'x', blob: 'y' });
    assert.equal(record.commitment, NEW_COMMITMENT);
    assert.equal(record.entries.length, 1);
  });
});
