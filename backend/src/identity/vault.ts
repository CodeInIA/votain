/**
 * Encrypted identity vault — file-backed.
 *
 * A voter has exactly ONE Semaphore identity, because two active identities for
 * the same human would yield two independently countable ballots that no
 * contract could correlate (see PlatformRegistry). Multi-device support
 * therefore cannot mean "a second identity per passkey": it means the SAME
 * secret, unlockable from each of the voter's passkeys.
 *
 * Each entry stores that secret encrypted under a key derived from one
 * passkey's WebAuthn PRF output. The issuer only ever sees ciphertext: the PRF
 * secret never leaves the authenticator, so this server cannot recover the
 * identity, and therefore cannot compute the voter's per-election Semaphore
 * nullifiers or link them to a ballot.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATA_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'data',
  'identity-vault.json',
);

/**
 * Resolved per call rather than at import time so tests can point at their own
 * file. Without it, test files sharing this store race each other: node:test
 * runs them in parallel and each one truncates the other's data mid-run.
 */
function dataFile(): string {
  return process.env.IDENTITY_VAULT_FILE ?? DEFAULT_DATA_FILE;
}

export interface VaultEntry {
  /** Base64url WebAuthn credential id. Public. */
  credentialId: string;
  /** Base64url AES-GCM blob (iv ‖ ciphertext) of the Semaphore secret. */
  blob: string;
  addedAt: string;
}

export interface VaultRecord {
  /** The single Semaphore identity commitment for this human. Public. */
  commitment: string;
  entries: VaultEntry[];
}

/** World ID nullifier => vault record. */
type VaultState = Record<string, VaultRecord>;

function load(): VaultState {
  const file = dataFile();
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf-8')) as VaultState;
}

function save(state: VaultState): void {
  const file = dataFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2));
}

export function getVault(nullifier: string): VaultRecord | null {
  return load()[nullifier] ?? null;
}

export class CommitmentMismatchError extends Error {
  constructor() {
    super('This voter already has a different identity commitment');
    this.name = 'CommitmentMismatchError';
  }
}

/**
 * Adds (or replaces) the wrapped secret for one passkey.
 *
 * The commitment is pinned on the first write and immutable afterwards: letting
 * it change would silently orphan the on-chain registration and, worse, hand
 * one human a second votable identity. Recovery goes through
 * `PlatformRegistry.rotateMember`, which revokes the old commitment on-chain in
 * the same transaction, never through this endpoint.
 */
export function putVaultEntry(
  nullifier: string,
  commitment: string,
  entry: Omit<VaultEntry, 'addedAt'>,
): VaultRecord {
  const state = load();
  const existing = state[nullifier];

  if (existing && existing.commitment !== commitment) {
    throw new CommitmentMismatchError();
  }

  const record: VaultRecord = existing ?? { commitment, entries: [] };
  record.entries = [
    ...record.entries.filter(e => e.credentialId !== entry.credentialId),
    { ...entry, addedAt: new Date().toISOString() },
  ];

  state[nullifier] = record;
  save(state);
  return record;
}

export function removeVaultEntry(nullifier: string, credentialId: string): VaultRecord | null {
  const state = load();
  const record = state[nullifier];
  if (!record) return null;

  record.entries = record.entries.filter(e => e.credentialId !== credentialId);
  state[nullifier] = record;
  save(state);
  return record;
}

/**
 * Recovery: discard every stored copy of the old secret and start over.
 *
 * The existing entries wrap a secret nobody can decrypt any more (the passkey
 * that sealed them is gone), so keeping them would only leave a trail of
 * unusable blobs and let a stale one collide with the new commitment. The
 * caller is responsible for having rotated the commitment on chain first.
 */
export function resetVault(
  nullifier: string,
  commitment: string,
  entry: Omit<VaultEntry, 'addedAt'>,
): VaultRecord {
  const state = load();
  const record: VaultRecord = {
    commitment,
    entries: [{ ...entry, addedAt: new Date().toISOString() }],
  };
  state[nullifier] = record;
  save(state);
  return record;
}
