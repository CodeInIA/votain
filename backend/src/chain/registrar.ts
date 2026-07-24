/**
 * On-chain registrar.
 *
 * After a successful World ID verification the issuer registers the voter's
 * (nullifier, identityCommitment) pair in PlatformRegistry, gating election
 * enrollment to platform-verified humans. The registrar wallet must be the
 * PlatformRegistry owner (the deployer).
 *
 * Env:
 *   CHAIN_RPC_URL           e.g. https://rpc-amoy.polygon.technology
 *   REGISTRY_ADDRESS        PlatformRegistry deployment address
 *   REGISTRAR_PRIVATE_KEY   key owning PlatformRegistry
 */
import { Contract, JsonRpcProvider, Wallet } from 'ethers';

const REGISTRY_ABI = [
  'function registerMember(uint256 nullifier, uint256 identityCommitment)',
  'function registeredNullifiers(uint256 nullifier) view returns (bool)',
  'function verifiedMembers(uint256 identityCommitment) view returns (bool)',
];

export function isRegistrarConfigured(): boolean {
  return Boolean(
    process.env.CHAIN_RPC_URL && process.env.REGISTRY_ADDRESS && process.env.REGISTRAR_PRIVATE_KEY,
  );
}

function getRegistry(): Contract {
  const provider = new JsonRpcProvider(process.env.CHAIN_RPC_URL);
  const wallet = new Wallet(process.env.REGISTRAR_PRIVATE_KEY as string, provider);
  return new Contract(process.env.REGISTRY_ADDRESS as string, REGISTRY_ABI, wallet);
}

export interface RegistrationResult {
  registered: boolean;
  alreadyRegistered?: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Registers the pair on-chain. Idempotent: an already-registered nullifier is
 * reported as success so re-verification does not fail the login flow.
 */
export async function registerOnChain(
  nullifierHex: string,
  identityCommitment: string,
): Promise<RegistrationResult> {
  if (!isRegistrarConfigured()) {
    return { registered: false, error: 'registrar not configured' };
  }

  try {
    const registry = getRegistry();
    const nullifier = BigInt(nullifierHex);
    const commitment = BigInt(identityCommitment);

    if (await registry.registeredNullifiers(nullifier)) {
      return { registered: true, alreadyRegistered: true };
    }

    const tx = await registry.registerMember(nullifier, commitment);
    const receipt = await tx.wait();
    return { registered: true, txHash: receipt?.hash };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('On-chain registration failed:', message);
    return { registered: false, error: message };
  }
}
