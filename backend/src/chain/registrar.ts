/**
 * On-chain registrar.
 *
 * After a successful World ID verification the issuer registers the voter's
 * (nullifier, identityCommitment) pair in PlatformRegistry, gating election
 * enrollment to platform-verified humans. The registrar wallet must be the
 * PlatformRegistry owner (the deployer).
 *
 * Env:
 *   CHAIN_RPC_URL           e.g. https://polygon-amoy.drpc.org
 *   REGISTRY_ADDRESS        PlatformRegistry deployment address
 *   REGISTRAR_PRIVATE_KEY   key owning PlatformRegistry
 */
import { Contract, type TransactionReceipt, type TransactionResponse } from 'ethers';

import { contractAddress } from './deployments.js';
import { chainProvider, submitInTurn } from './signer.js';
import { chainFailure, errorMessage } from '../utils/errors.js';

const REGISTRY_ABI = [
  'function registerMember(uint256 nullifier, uint256 identityCommitment)',
  'function rotateMember(uint256 nullifier, uint256 newCommitment)',
  'function commitmentOf(uint256 nullifier) view returns (uint256)',
  'function registeredNullifiers(uint256 nullifier) view returns (bool)',
  'function verifiedMembers(uint256 identityCommitment) view returns (bool)',
  'function nullifierOf(uint256 identityCommitment) view returns (uint256)',
  // The identity vault. See `identity/vault.ts` for why the ciphertext lives on
  // chain rather than on this server's disk.
  'function addVaultEntry(uint256 nullifier, bytes credentialId, bytes blob)',
  'function removeVaultEntry(uint256 nullifier, bytes credentialId)',
  'function resetVault(uint256 nullifier, bytes credentialId, bytes blob)',
  'function getVault(uint256 nullifier) view returns ((bytes credentialId, bytes blob, uint64 addedAt)[])',
  'function vaultEntryCount(uint256 nullifier) view returns (uint256)',
  // The voter's own settings, sealed under a key derived from their Semaphore
  // secret. This server moves the blob and cannot read it.
  'function setPreferences(uint256 nullifier, bytes blob)',
  'function preferencesOf(uint256 nullifier) view returns (bytes)',
  // Credential status. The slot is assigned by `registerMember`, so signing in
  // costs no transaction; only a revocation writes.
  'function statusIndexOf(uint256 nullifier) view returns (uint256)',
  'function memberCount() view returns (uint256)',
  'function revokedStatus(uint256 statusIndex) view returns (bool)',
  'function revokeStatus(uint256 statusIndex)',
  'function restoreStatus(uint256 statusIndex)',
];

/** The PlatformRegistry address: REGISTRY_ADDRESS, else the deployment manifest. */
export function registryAddress(): string | undefined {
  return contractAddress('PlatformRegistry', 'REGISTRY_ADDRESS');
}

export function isRegistrarConfigured(): boolean {
  return Boolean(
    process.env.CHAIN_RPC_URL && registryAddress() && process.env.REGISTRAR_PRIVATE_KEY,
  );
}

/** A read-only handle on the registry, over the shared provider. */
export function getRegistryReader(): Contract {
  return new Contract(registryAddress() as string, REGISTRY_ABI, chainProvider());
}

/**
 * Sends one registry write and waits for it to land.
 *
 * Every write goes through the registrar's queue, so concurrent requests
 * (a vault entry here, a preferences change there) never race for a nonce.
 */
export async function writeRegistry(
  send: (registry: Contract) => Promise<TransactionResponse>,
): Promise<TransactionReceipt | null> {
  const tx = await submitInTurn('REGISTRAR_PRIVATE_KEY', signer =>
    send(new Contract(registryAddress() as string, REGISTRY_ABI, signer)),
  );
  return tx.wait();
}

export interface RegistrationResult {
  registered: boolean;
  alreadyRegistered?: boolean;
  txHash?: string;
  error?: string;
  /**
   * This human is already bound to a DIFFERENT commitment on chain. Callers must
   * not treat it as success: the commitment they passed will never pass
   * `enroll`, and storing it would leave the vault disagreeing with the chain.
   */
  boundToOtherIdentity?: boolean;
}

/**
 * Registers the pair on-chain.
 *
 * Idempotent for the SAME identity, so re-verifying does not break login. A
 * known human presenting a NEW commitment is reported as a failure rather than
 * quietly ignored, because that pair can never enroll.
 */
export async function registerOnChain(
  nullifierHex: string,
  identityCommitment: string,
): Promise<RegistrationResult> {
  if (!isRegistrarConfigured()) {
    return { registered: false, error: 'registrar not configured' };
  }

  try {
    const registry = getRegistryReader();
    const nullifier = BigInt(nullifierHex);
    const commitment = BigInt(identityCommitment);

    // Idempotent re-verification: the same human presenting the same identity
    // again is a success, nothing to write. THE SAME HUMAN, checked, and not
    // merely "somebody's active commitment": commitments are public, and
    // reporting another voter's as this one's registration would tell the
    // caller they were set up when they were not.
    if (await registry.verifiedMembers(commitment)) {
      const owner: bigint = await registry.nullifierOf(commitment);
      if (owner === nullifier) return { registered: true, alreadyRegistered: true };
      return { registered: false, error: 'that identity commitment belongs to another voter' };
    }

    // The human is known but the commitment is new. Reporting success here (as
    // this used to) meant `enroll` later failed with NotPlatformVerified and no
    // trace of why. Recovery is an explicit `rotateMember` by the issuer, never
    // a silent second registration.
    if (await registry.registeredNullifiers(nullifier)) {
      return {
        registered: false,
        boundToOtherIdentity: true,
        error: 'this World ID is already bound to a different identity commitment',
      };
    }

    const receipt = await writeRegistry(r => r.registerMember(nullifier, commitment));
    return { registered: true, txHash: receipt?.hash };
  } catch (error: unknown) {
    console.error('On-chain registration failed:', errorMessage(error));
    return { registered: false, error: chainFailure(error) };
  }
}

/**
 * Recovery: point an already-registered human at a new identity commitment.
 *
 * The contract revokes the previous commitment in the same transaction, so a
 * human never holds two active identities and Sybil resistance is preserved.
 * Elections they already enrolled in stay closed to them, because
 * `ElectionV4.enroll` deduplicates by human rather than by commitment.
 *
 * Callers MUST have proved personhood with a fresh World ID proof first: this
 * function rebinds a voting identity, so authorising it with anything weaker
 * would turn a stolen session into an identity takeover.
 */
export async function rotateOnChain(
  nullifierHex: string,
  newCommitment: string,
): Promise<RegistrationResult> {
  if (!isRegistrarConfigured()) {
    return { registered: false, error: 'registrar not configured' };
  }

  try {
    const registry = getRegistryReader();
    const nullifier = BigInt(nullifierHex);
    const commitment = BigInt(newCommitment);

    if (!(await registry.registeredNullifiers(nullifier))) {
      return { registered: false, error: 'this World ID has no identity to recover' };
    }
    // Already the active identity: nothing to rotate, treat as success so a
    // retried request is harmless.
    if ((await registry.commitmentOf(nullifier)) === commitment) {
      return { registered: true, alreadyRegistered: true };
    }
    if (await registry.verifiedMembers(commitment)) {
      return { registered: false, error: 'that identity commitment is already in use' };
    }

    const receipt = await writeRegistry(r => r.rotateMember(nullifier, commitment));
    return { registered: true, txHash: receipt?.hash };
  } catch (error: unknown) {
    console.error('rotateOnChain failed:', errorMessage(error));
    return { registered: false, error: chainFailure(error) };
  }
}
