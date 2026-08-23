import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  getVault,
  putVaultEntry,
  removeVaultEntry,
  CommitmentMismatchError,
} from './vault.js';

// Own store per test file: node:test runs files in parallel, and sharing
// one path made these suites truncate each other's data mid-run.
const DATA_FILE = join(tmpdir(), 'votain-vault-test-vault.json');
process.env.IDENTITY_VAULT_FILE = DATA_FILE;

const NULLIFIER = '0xabc';
const COMMITMENT = '12345678901234567890';

beforeEach(() => {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  if (existsSync(DATA_FILE)) rmSync(DATA_FILE);
});

describe('Identity vault', () => {
  test('stores one wrapped secret per passkey for a single commitment', () => {
    putVaultEntry(NULLIFIER, COMMITMENT, { credentialId: 'phone', blob: 'blob-a' });
    putVaultEntry(NULLIFIER, COMMITMENT, { credentialId: 'laptop', blob: 'blob-b' });

    const record = getVault(NULLIFIER);
    assert.equal(record?.commitment, COMMITMENT);
    assert.equal(record?.entries.length, 2);
    assert.deepEqual(
      record?.entries.map(e => e.credentialId).sort(),
      ['laptop', 'phone'],
    );
  });

  test('re-registering the same passkey replaces its blob instead of duplicating', () => {
    putVaultEntry(NULLIFIER, COMMITMENT, { credentialId: 'phone', blob: 'old' });
    putVaultEntry(NULLIFIER, COMMITMENT, { credentialId: 'phone', blob: 'new' });

    const record = getVault(NULLIFIER);
    assert.equal(record?.entries.length, 1);
    assert.equal(record?.entries[0].blob, 'new');
  });

  // A second commitment for one human is exactly what would let them enroll
  // twice and have both ballots counted, so the store must refuse it.
  test('refuses a second identity for the same human', () => {
    putVaultEntry(NULLIFIER, COMMITMENT, { credentialId: 'phone', blob: 'blob-a' });

    assert.throws(
      () => putVaultEntry(NULLIFIER, '99999999999999999999', { credentialId: 'laptop', blob: 'b' }),
      CommitmentMismatchError,
    );
    assert.equal(getVault(NULLIFIER)?.commitment, COMMITMENT);
  });

  test('keeps vaults of different humans independent', () => {
    putVaultEntry(NULLIFIER, COMMITMENT, { credentialId: 'phone', blob: 'blob-a' });
    putVaultEntry('0xdef', '55555', { credentialId: 'phone', blob: 'blob-b' });

    assert.equal(getVault(NULLIFIER)?.commitment, COMMITMENT);
    assert.equal(getVault('0xdef')?.commitment, '55555');
  });

  test('removes a passkey without touching the identity', () => {
    putVaultEntry(NULLIFIER, COMMITMENT, { credentialId: 'phone', blob: 'blob-a' });
    putVaultEntry(NULLIFIER, COMMITMENT, { credentialId: 'laptop', blob: 'blob-b' });

    const updated = removeVaultEntry(NULLIFIER, 'laptop');
    assert.equal(updated?.entries.length, 1);
    assert.equal(updated?.commitment, COMMITMENT);
  });

  test('returns null for an unknown voter', () => {
    assert.equal(getVault('0xnope'), null);
  });
});
