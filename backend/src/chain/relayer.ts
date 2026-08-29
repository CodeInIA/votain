/**
 * Transaction relayer.
 *
 * Voters hold no native token and, more importantly, must not appear on chain
 * as themselves: a per-voter sending address would publicly link their
 * enrollment to their ballot and defeat the Semaphore proof. Every voter
 * operation is therefore submitted by this one wallet through
 * ElectionPaymaster, which reimburses the gas from the organizer's tank inside
 * the same transaction. The relayer only fronts a small float.
 *
 * Neither relayed call trusts the caller: `enroll` is gated on PlatformRegistry
 * and `castVote` on a zero-knowledge proof, both verified on chain. A malicious
 * relayer can withhold or delay a transaction, never forge one, and since
 * relaying is permissionless on the contract a censored voter can always submit
 * their own.
 *
 * Env:
 *   CHAIN_RPC_URL          RPC endpoint
 *   PAYMASTER_ADDRESS      ElectionPaymaster deployment address
 *   RELAYER_PRIVATE_KEY    hot wallet with a small POL float
 */
import { Contract, JsonRpcProvider, Wallet, isAddress } from 'ethers';

const PAYMASTER_ABI = [
  'function relayEnroll(address election, uint256 identityCommitment)',
  'function relayEnrollAttested(address election, uint256 identityCommitment, uint256 deadline, bytes signature)',
  'function relayVote(address election, bytes voteCiphertext, uint256 nullifier, uint256 merkleRoot, uint256 merkleDepth, uint256[2] pA, uint256[2][2] pB, uint256[2] pC)',
  'function organizerOf(address election) view returns (address)',
  'function gasBalance(address organizer) view returns (uint256)',
];

export function isRelayerConfigured(): boolean {
  return Boolean(
    process.env.CHAIN_RPC_URL && process.env.PAYMASTER_ADDRESS && process.env.RELAYER_PRIVATE_KEY,
  );
}

function getPaymaster(): Contract {
  const provider = new JsonRpcProvider(process.env.CHAIN_RPC_URL);
  const wallet = new Wallet(process.env.RELAYER_PRIVATE_KEY as string, provider);
  return new Contract(process.env.PAYMASTER_ADDRESS as string, PAYMASTER_ABI, wallet);
}

export interface RelayResult {
  relayed: boolean;
  txHash?: string;
  error?: string;
}

export interface VoteCall {
  election: string;
  voteCiphertext: string;
  nullifier: string;
  merkleRoot: string;
  merkleDepth: string;
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
}

/** Rejects anything that is not a well-formed address before spending gas. */
function requireElection(election: string): void {
  if (!isAddress(election)) throw new Error('election must be a valid address');
}

export async function relayEnroll(election: string, commitment: string): Promise<RelayResult> {
  if (!isRelayerConfigured()) return { relayed: false, error: 'relayer not configured' };

  try {
    requireElection(election);
    const paymaster = getPaymaster();
    // Simulate first: `/relay/vote` is public and a reverting call still costs
    // the relayer its gas, so submitting blind lets anyone drain the float with
    // junk. staticCall reverts locally and costs nothing.
    await paymaster.relayEnroll.staticCall(election, BigInt(commitment));
    const tx = await paymaster.relayEnroll(election, BigInt(commitment));
    const receipt = await tx.wait();
    return { relayed: true, txHash: receipt?.hash };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('relayEnroll failed:', message);
    return { relayed: false, error: message };
  }
}

/**
 * Relays an enrollment into an election that declares an attribute policy.
 *
 * Separate from `relayEnroll` because the contract exposes two entry points:
 * a gated election refuses the plain one, so that a voter the attester turned
 * down cannot simply submit the transaction themselves.
 */
export async function relayEnrollAttested(
  election: string,
  commitment: string,
  deadline: number,
  signature: string,
): Promise<RelayResult> {
  if (!isRelayerConfigured()) return { relayed: false, error: 'relayer not configured' };

  try {
    requireElection(election);
    const paymaster = getPaymaster();
    const args = [election, BigInt(commitment), BigInt(deadline), signature] as const;
    // Same reason as relayEnroll: a reverting call still costs the relayer its
    // gas, and an expired or malformed attestation reverts.
    await paymaster.relayEnrollAttested.staticCall(...args);
    const tx = await paymaster.relayEnrollAttested(...args);
    const receipt = await tx.wait();
    return { relayed: true, txHash: receipt?.hash };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('relayEnrollAttested failed:', message);
    return { relayed: false, error: message };
  }
}

export async function relayVote(call: VoteCall): Promise<RelayResult> {
  if (!isRelayerConfigured()) return { relayed: false, error: 'relayer not configured' };

  try {
    requireElection(call.election);
    const paymaster = getPaymaster();
    const args = [
      call.election,
      call.voteCiphertext,
      BigInt(call.nullifier),
      BigInt(call.merkleRoot),
      BigInt(call.merkleDepth),
      call.pA.map(BigInt),
      call.pB.map(pair => pair.map(BigInt)),
      call.pC.map(BigInt),
    ] as const;

    // An invalid proof reverts on chain but the relayer still pays the gas, and
    // this endpoint is unauthenticated by design. Simulating first turns that
    // drain vector into a free local failure.
    await paymaster.relayVote.staticCall(...args);

    const tx = await paymaster.relayVote(...args);
    const receipt = await tx.wait();
    return { relayed: true, txHash: receipt?.hash };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('relayVote failed:', message);
    return { relayed: false, error: message };
  }
}
