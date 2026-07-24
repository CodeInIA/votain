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
import { chainInfo } from "./deployments";
import { encryptBallot } from "./paillier";
import {
  computeNullifier,
  fetchElectionGroup,
  generateVoteProof,
  getOrCreateIdentity,
  getStoredIdentity,
} from "./semaphore";
import { sendSponsoredCall } from "./zerodev";

// Hardhat's well-known account #1 (a PUBLIC test key, no value on any real
// network). Used ONLY to relay voter txs on the local chain, which has no
// ERC-4337 bundler/paymaster. Strictly gated on chainId 31337 below.
const LOCAL_CHAIN_ID = 31337;
const LOCAL_RELAY_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

/**
 * Sends a voter contract call. On the local dev chain it goes through a funded
 * Hardhat account directly (no ZeroDev on localhost); on Amoy it is a
 * gas-sponsored ERC-4337 UserOperation via ZeroDev.
 */
async function sendVoterCall(params: {
  to: `0x${string}`;
  humanReadableAbi: readonly string[];
  functionName: string;
  args: unknown[];
}): Promise<{ txHash: string; userOpHash: string }> {
  if (chainInfo.chainId === LOCAL_CHAIN_ID) {
    const { Contract, JsonRpcProvider, Wallet } = await import("ethers");
    const provider = new JsonRpcProvider(chainInfo.rpcUrl, chainInfo.chainId, { staticNetwork: true });
    const signer = new Wallet(LOCAL_RELAY_KEY, provider);
    const c = new Contract(params.to, params.humanReadableAbi as string[], signer);
    const tx = await c[params.functionName](...params.args);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, userOpHash: receipt.hash };
  }
  return sendSponsoredCall(params);
}

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
  const { txHash } = await sendVoterCall({
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

  // 4. Sponsored UserOp (Amoy) or direct local tx
  const { txHash, userOpHash } = await sendVoterCall({
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
