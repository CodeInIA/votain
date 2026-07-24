/**
 * Voter actions: enroll and cast/change vote.
 *
 * Pipeline for a vote:
 *   1. Encrypt the ballot with the election's Paillier public key.
 *   2. Read the voter's current nullifier nonce (re-vote support).
 *   3. Rebuild the Semaphore group from chain events and generate the ZK
 *      membership proof binding keccak(ciphertext ‖ nonce) as the message.
 *   4. Send castVote as a gas-sponsored UserOperation via ZeroDev.
 */
import { getElection, ELECTION_ABI } from "./contracts";
import { encryptBallot } from "./paillier";
import {
  computeNullifier,
  fetchElectionGroup,
  generateVoteProof,
  getOrCreateIdentity,
  getStoredIdentity,
} from "./semaphore";
import { sendSponsoredCall } from "./zerodev";

export interface VoteResult {
  txHash: string;
  userOpHash: string;
  nullifier: bigint;
  nonce: bigint;
  referenceNumber: string;
}

/** Enrolls the local Semaphore identity into an election (sponsored UserOp). */
export async function enrollInElection(electionAddress: string): Promise<{ txHash: string }> {
  const identity = await getOrCreateIdentity();
  const { txHash } = await sendSponsoredCall({
    to: electionAddress as `0x${string}`,
    humanReadableAbi: ELECTION_ABI,
    functionName: "enroll",
    args: [identity.commitment],
  });
  return { txHash };
}

/** Casts (or re-casts) a vote for `optionIndex` (blank = numOptions). */
export async function castVote(electionAddress: string, optionIndex: number): Promise<VoteResult> {
  // Re-derive from the passkey if the in-memory identity was lost (page reload).
  const identity = await getOrCreateIdentity();

  const election = getElection(electionAddress);
  const [paillierPk, scope] = await Promise.all([election.paillierPublicKey(), election.scope()]);

  // 1. Encrypt ballot
  const ciphertext = encryptBallot(paillierPk, optionIndex);

  // 2. Read the current nonce (re-vote support) from the deterministic nullifier
  const nullifier = computeNullifier(identity, BigInt(scope));
  const nonce: bigint = await election.nullifierNonces(nullifier);

  // 3. Membership proof against the on-chain group, bound to ciphertext+nonce
  const group = await fetchElectionGroup(electionAddress);
  const proof = await generateVoteProof(identity, group, ciphertext, nonce, BigInt(scope));

  // 4. Sponsored UserOp
  const { txHash, userOpHash } = await sendSponsoredCall({
    to: electionAddress as `0x${string}`,
    humanReadableAbi: ELECTION_ABI,
    functionName: "castVote",
    args: [
      ciphertext,
      proof.nullifier,
      proof.merkleTreeRoot,
      proof.merkleTreeDepth,
      proof.pA,
      proof.pB,
      proof.pC,
    ],
  });

  return {
    txHash,
    userOpHash,
    nullifier: proof.nullifier,
    nonce,
    referenceNumber: `${txHash.slice(0, 10)}…${proof.nullifier.toString(16).slice(0, 8)}`,
  };
}

/** Looks up the vote history for the locally stored identity in one election. */
export async function fetchVoteReceipts(electionAddress: string, nullifier: bigint) {
  const election = getElection(electionAddress);
  const events = await election.queryFilter(election.filters.VoteCast(nullifier));
  return events.map(e => {
    const { args } = e as unknown as {
      args: { nullifier: bigint; voteCiphertext: string; nonce: bigint; timestamp: bigint };
    };
    return {
      nullifier: args.nullifier,
      nonce: args.nonce,
      timestamp: new Date(Number(args.timestamp) * 1000),
      txHash: e.transactionHash,
    };
  });
}

export interface VoteHistoryEntry {
  electionId: string;
  electionTitle: string;
  phase: string;
  lastVoteAt: Date;
  voteCount: number;
  referenceNumber: string;
  nullifier: string;
}

/**
 * Builds the voter's participation history across a set of live elections.
 * The candidate is intentionally NOT recoverable — anonymity means history can
 * only prove *that* and *when* you voted, never *what* you chose.
 */
export async function fetchVoteHistory(
  elections: { contractAddress: string; title: string; phase: string; scope?: bigint }[],
): Promise<VoteHistoryEntry[]> {
  const identity = getStoredIdentity();
  if (!identity) return [];

  const entries: VoteHistoryEntry[] = [];
  for (const el of elections) {
    const election = getElection(el.contractAddress);
    const scope: bigint = el.scope ?? BigInt(await election.scope());
    const nullifier = computeNullifier(identity, scope);
    const receipts = await fetchVoteReceipts(el.contractAddress, nullifier);
    if (receipts.length === 0) continue;

    const last = receipts[receipts.length - 1];
    entries.push({
      electionId: el.contractAddress,
      electionTitle: el.title,
      phase: el.phase,
      lastVoteAt: last.timestamp,
      voteCount: receipts.length,
      referenceNumber: `${last.txHash.slice(0, 10)}…`,
      nullifier: nullifier.toString(16).slice(0, 16),
    });
  }
  return entries.sort((a, b) => b.lastVoteAt.getTime() - a.lastVoteAt.getTime());
}
