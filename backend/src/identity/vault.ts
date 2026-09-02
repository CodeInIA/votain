/**
 * Encrypted identity vault, stored on chain.
 *
 * A voter has exactly ONE Semaphore identity, because two active identities for
 * the same human would yield two independently countable ballots that no
 * contract could correlate (see PlatformRegistry). Multi-device support
 * therefore cannot mean "a second identity per passkey": it means the SAME
 * secret, unlockable from each of the voter's passkeys.
 *
 * Each entry holds that secret encrypted under a key derived from one passkey's
 * WebAuthn PRF output. This server only ever handles ciphertext: the PRF secret
 * never leaves the authenticator, so it cannot recover the identity, and
 * therefore cannot compute the voter's per-election Semaphore nullifiers or
 * link them to a ballot.
 *
 * WHY THE CHAIN AND NOT A FILE. Given that, the only property the store has to
 * provide is AVAILABILITY. It cannot read the blob, and it cannot substitute
 * one, because a swapped blob decrypts to an identity whose commitment does not
 * match `commitmentOf` and every enrollment with it fails. Its single remaining
 * power over a voter was to refuse to hand the blob back, and a file on one
 * server also meant losing that file locked its owners out of identities the
 * contract will not let them re-register. `PlatformRegistry` has the
 * availability the rest of the project already relies on, and it is already the
 * authority on the commitment, so the ciphertext sits beside it.
 *
 * The cost is written where the contract declares it: the ciphertext is public
 * and permanent, as is the number of passkeys a voter holds and when each was
 * added. `docs/ai/state.md` carries the reasoning.
 *
 * Env:
 *   CHAIN_RPC_URL           RPC endpoint
 *   REGISTRY_ADDRESS        PlatformRegistry deployment address
 *   REGISTRAR_PRIVATE_KEY   key owning PlatformRegistry
 */
import { getRegistryReader, getRegistryWriter, isRegistrarConfigured } from '../chain/registrar.js';

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

/** On-chain entry, as the contract returns it. */
interface ChainEntry {
  credentialId: string;
  blob: string;
  addedAt: bigint;
}

export class CommitmentMismatchError extends Error {
  constructor() {
    super('This voter already has a different identity commitment');
    this.name = 'CommitmentMismatchError';
  }
}

export class VaultUnavailableError extends Error {
  constructor() {
    super('The identity vault needs a configured chain connection');
    this.name = 'VaultUnavailableError';
  }
}

/**
 * Base64url in and out, hex on the chain.
 *
 * The browser speaks base64url because that is what WebAuthn hands it and what
 * `atob` reads; Solidity `bytes` arrive as hex. Converting at this boundary
 * keeps both sides in the encoding they already use, and keeps the conversion
 * in one place rather than at every call site.
 */
export function toHex(base64url: string): string {
  return `0x${Buffer.from(base64url, 'base64url').toString('hex')}`;
}

export function fromHex(hex: string): string {
  return Buffer.from(hex.replace(/^0x/, ''), 'hex').toString('base64url');
}

function requireChain(): void {
  if (!isRegistrarConfigured()) throw new VaultUnavailableError();
}

/**
 * Reads a human's vault, or null when they have no identity registered.
 *
 * A registered human with no entries yet is a real state, not an error: the
 * commitment is written first and the first blob follows in a second
 * transaction, so a browser can arrive between the two.
 */
export async function getVault(nullifier: string): Promise<VaultRecord | null> {
  requireChain();
  const registry = getRegistryReader();

  const commitment: bigint = await registry.commitmentOf(nullifier);
  if (commitment === 0n) return null;

  const entries: ChainEntry[] = await registry.getVault(nullifier);
  return {
    commitment: commitment.toString(),
    entries: entries.map(e => ({
      credentialId: fromHex(e.credentialId),
      blob: fromHex(e.blob),
      addedAt: new Date(Number(e.addedAt) * 1000).toISOString(),
    })),
  };
}

/**
 * Adds one passkey's sealed copy.
 *
 * The commitment is pinned by the chain, not by this function: `registerMember`
 * writes it and nothing but `rotateMember` changes it. Passing a different one
 * is refused here so the caller learns why, instead of writing a blob that
 * would decrypt to an identity every enrollment then rejects.
 */
export async function putVaultEntry(
  nullifier: string,
  commitment: string,
  entry: Omit<VaultEntry, 'addedAt'>,
): Promise<VaultRecord> {
  requireChain();

  const current = await getVault(nullifier);
  if (current && current.commitment !== commitment) throw new CommitmentMismatchError();

  // Replacing rather than refusing: re-sealing the same passkey is what a voter
  // does after a recovery on another device, and the contract has no update.
  if (current?.entries.some(e => e.credentialId === entry.credentialId)) {
    await removeVaultEntry(nullifier, entry.credentialId);
  }

  const registry = getRegistryWriter();
  const tx = await registry.addVaultEntry(
    nullifier,
    toHex(entry.credentialId),
    toHex(entry.blob),
  );
  await tx.wait();

  return (await getVault(nullifier)) as VaultRecord;
}

export async function removeVaultEntry(
  nullifier: string,
  credentialId: string,
): Promise<VaultRecord | null> {
  requireChain();
  const registry = getRegistryWriter();
  const tx = await registry.removeVaultEntry(nullifier, toHex(credentialId));
  await tx.wait();
  return getVault(nullifier);
}

/**
 * Recovery: discard every stored copy of the old secret and start over.
 *
 * The existing entries seal a secret nobody can decrypt any more, since the
 * passkey that sealed them is gone, and its commitment has just been revoked by
 * `rotateMember`. The caller is responsible for having rotated first.
 */
export async function resetVault(
  nullifier: string,
  commitment: string,
  entry: Omit<VaultEntry, 'addedAt'>,
): Promise<VaultRecord> {
  requireChain();

  const registry = getRegistryWriter();
  const tx = await registry.resetVault(nullifier, toHex(entry.credentialId), toHex(entry.blob));
  await tx.wait();

  const record = (await getVault(nullifier)) as VaultRecord;
  if (record.commitment !== commitment) throw new CommitmentMismatchError();
  return record;
}
