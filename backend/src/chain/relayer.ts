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
  'function relayVote(address election, (uint256 votersRoot, uint256 ballotsRoot, uint256 epoch, uint256 tag, uint256 epochTag, uint256 leaf, uint256[2] voteA, uint256[] voteB, uint256[2] cancelA, uint256[] cancelB) ballot, (uint256[2] a, uint256[2][2] b, uint256[2] c) proof)',
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
  'error TagAlreadyCast()',
  'error EpochAlreadyCast()',
  'error WrongEpoch()',
  'error TreeFull()',
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

/** A ballot and its proof as the browser sends them: every number a decimal string. */
export interface VoteCall {
  election: string;
  ballot: {
    votersRoot: string;
    ballotsRoot: string;
    epoch: string;
    tag: string;
    epochTag: string;
    leaf: string;
    voteA: string[];
    voteB: string[];
    cancelA: string[];
    cancelB: string[];
  };
  proof: { a: string[]; b: string[][]; c: string[] };
}

/**
 * Points in one of a ballot's B lists: two numbers per slot, and the largest
 * circuit has 51 slots (50 options and the blank vote; ElectionV4.MAX_OPTIONS).
 */
const MAX_POINT_VALUES = 2 * 51;

const isDecimal = (v: unknown): v is string => typeof v === 'string' && /^\d{1,78}$/.test(v);
const decimals = (v: unknown, length: number | [number, number]): boolean => {
  if (!Array.isArray(v)) return false;
  const [min, max] = typeof length === 'number' ? [length, length] : length;
  return v.length >= min && v.length <= max && v.every(isDecimal);
};

/**
 * Whether a body is shaped like a ballot and its proof, before anything is
 * simulated. The chain is the judge of whether it is a VALID one; this only
 * keeps an oversized or malformed body from reaching the simulation at all.
 */
export function isVoteCall(body: unknown): body is VoteCall {
  const { election, ballot, proof } = (body ?? {}) as Partial<VoteCall>;
  if (typeof election !== 'string' || !ballot || !proof) return false;
  const scalars = ['votersRoot', 'ballotsRoot', 'epoch', 'tag', 'epochTag', 'leaf'] as const;
  return (
    scalars.every(key => isDecimal(ballot[key])) &&
    decimals(ballot.voteA, 2) &&
    decimals(ballot.cancelA, 2) &&
    decimals(ballot.voteB, [2, MAX_POINT_VALUES]) &&
    decimals(ballot.cancelB, [2, MAX_POINT_VALUES]) &&
    decimals(proof.a, 2) &&
    decimals(proof.c, 2) &&
    Array.isArray(proof.b) &&
    proof.b.length === 2 &&
    proof.b.every(pair => decimals(pair, 2))
  );
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
  const { ballot, proof } = call;
  return relay('relayVote', call.election, () => [
    call.election,
    {
      votersRoot: BigInt(ballot.votersRoot),
      ballotsRoot: BigInt(ballot.ballotsRoot),
      epoch: BigInt(ballot.epoch),
      tag: BigInt(ballot.tag),
      epochTag: BigInt(ballot.epochTag),
      leaf: BigInt(ballot.leaf),
      voteA: ballot.voteA.map(BigInt),
      voteB: ballot.voteB.map(BigInt),
      cancelA: ballot.cancelA.map(BigInt),
      cancelB: ballot.cancelB.map(BigInt),
    },
    { a: proof.a.map(BigInt), b: proof.b.map(pair => pair.map(BigInt)), c: proof.c.map(BigInt) },
  ]);
}
