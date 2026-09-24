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
 * Neither relayed call trusts the caller: enrolment is gated on a registry
 * entry or a platform signature, and `castVote` on a zero-knowledge proof, all
 * verified on chain. A malicious relayer can withhold or delay a transaction,
 * never forge one, and since relaying is permissionless on the contract a
 * censored voter can always submit their own.
 *
 * Env:
 *   CHAIN_RPC_URL          RPC endpoint
 *   PAYMASTER_ADDRESS      ElectionPaymaster deployment address
 *   RELAYER_PRIVATE_KEY    hot wallet with a small POL float
 */
import { Contract, isAddress } from 'ethers';

import { contractAddress } from './deployments.js';
import { submitInTurn } from './signer.js';
import { chainFailure, errorMessage } from '../utils/errors.js';

const PAYMASTER_ABI = [
  'function relayEnroll(address election, uint256 identityCommitment)',
  'function relayEnrollAttested(address election, uint256 identityCommitment, uint256 personhoodNullifier, uint256 deadline, bytes signature)',
  'function relayEnrollPrivate(address election, uint256 identityCommitment, uint256 humanTag, uint256 documentTag, uint256 deadline, bytes platformSignature, bytes eligibilitySignature)',
  'function relayVote(address election, bytes voteCiphertext, uint256 nullifier, uint256 merkleRoot, uint256 merkleDepth, uint256[2] pA, uint256[2][2] pB, uint256[2] pC)',
  // Declared so a revert this contract interface decodes arrives with a NAME
  // rather than a bare four-byte selector. It does not cover every case: a
  // failure during gas estimation is raised by the provider, which has no ABI,
  // and reaches the caller with the selector only. The browser reads that
  // selector itself; see `revertNameOf` in frontend/src/lib/relay.ts.
  'error InsufficientBalance()',
  'error EnrollmentNotOpen()',
  'error AlreadyEnrolled()',
  'error NotPlatformVerified()',
  'error PersonhoodNullifierUsed()',
  'error MissingPersonhoodNullifier()',
  'error AttestationRequired()',
  'error UnexpectedAttestation()',
  'error AttestationExpired()',
  'error BadAttestation()',
  'error UnknownElection()',
  'error VotingNotOpen()',
  'error UnknownOrExpiredRoot()',
  'error InvalidProof()',
  'error WrongPhase()',
  'error RevoteTooSoon(uint256 availableAt)',
  'error InvalidBallot()',
  'error MissingDocumentTag()',
  'error UnexpectedDocumentTag()',
  'function organizerOf(address election) view returns (address)',
  'function gasBalance(address organizer) view returns (uint256)',
];

/** The ElectionPaymaster address: PAYMASTER_ADDRESS, else the deployment manifest. */
export function paymasterAddress(): string | undefined {
  return contractAddress('ElectionPaymaster', 'PAYMASTER_ADDRESS');
}

export function isRelayerConfigured(): boolean {
  return Boolean(
    process.env.CHAIN_RPC_URL && paymasterAddress() && process.env.RELAYER_PRIVATE_KEY,
  );
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

type PaymasterMethod = 'relayEnroll' | 'relayEnrollAttested' | 'relayEnrollPrivate' | 'relayVote';

/**
 * Simulates, submits in turn and waits for one relayed call.
 *
 * Simulated first because a reverting call still costs the relayer its gas,
 * and `/relay/vote` is public: submitting blind would let anyone drain the
 * float with junk. A local `staticCall` fails for free.
 */
async function relay(
  method: PaymasterMethod,
  election: string,
  buildArgs: () => readonly unknown[],
): Promise<RelayResult> {
  if (!isRelayerConfigured()) return { relayed: false, error: 'relayer not configured' };
  if (!isAddress(election)) return { relayed: false, error: 'election must be a valid address' };

  let args: readonly unknown[];
  try {
    args = buildArgs();
  } catch {
    return { relayed: false, error: 'malformed arguments' };
  }

  try {
    const tx = await submitInTurn('RELAYER_PRIVATE_KEY', async signer => {
      const paymaster = new Contract(paymasterAddress() as string, PAYMASTER_ABI, signer);
      await paymaster[method].staticCall(...args);
      return paymaster[method](...args);
    });
    const receipt = await tx.wait();
    return { relayed: true, txHash: receipt?.hash };
  } catch (error: unknown) {
    console.error(`${method} failed:`, errorMessage(error));
    return { relayed: false, error: chainFailure(error) };
  }
}

export function relayEnroll(election: string, commitment: string): Promise<RelayResult> {
  return relay('relayEnroll', election, () => [election, BigInt(commitment)]);
}

/**
 * Relays an enrollment into an election that declares an attribute policy.
 *
 * Separate from `relayEnroll` because the contract exposes two entry points:
 * a gated election refuses the plain one, so that a voter the attester turned
 * down cannot simply submit the transaction themselves.
 */
export function relayEnrollAttested(
  election: string,
  commitment: string,
  personhoodNullifier: string,
  deadline: number,
  signature: string,
): Promise<RelayResult> {
  return relay('relayEnrollAttested', election, () => [
    election,
    BigInt(commitment),
    BigInt(personhoodNullifier),
    BigInt(deadline),
    signature,
  ]);
}

/**
 * Relays an enrolment that names nobody.
 *
 * The commitment was derived by the voter for this election alone and appears
 * in no registry, so the contract has nothing to look it up in: the platform's
 * signature is what says a verified human is behind it, and the tags are what
 * say neither that human nor their document has already enrolled here.
 */
export function relayEnrollPrivate(
  election: string,
  commitment: string,
  humanTag: string,
  documentTag: string,
  deadline: number,
  platformSignature: string,
  eligibilitySignature: string,
): Promise<RelayResult> {
  return relay('relayEnrollPrivate', election, () => [
    election,
    BigInt(commitment),
    BigInt(humanTag),
    BigInt(documentTag),
    BigInt(deadline),
    platformSignature,
    eligibilitySignature,
  ]);
}

export function relayVote(call: VoteCall): Promise<RelayResult> {
  return relay('relayVote', call.election, () => [
    call.election,
    call.voteCiphertext,
    BigInt(call.nullifier),
    BigInt(call.merkleRoot),
    BigInt(call.merkleDepth),
    call.pA.map(BigInt),
    call.pB.map(pair => pair.map(BigInt)),
    call.pC.map(BigInt),
  ]);
}
