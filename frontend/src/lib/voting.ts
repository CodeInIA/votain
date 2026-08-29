/**
 * Voter actions: enroll and cast/change vote.
 *
 * Pipeline for a vote:
 *   1. Encrypt the ballot with the election's Paillier public key.
 *   2. Read the voter's current nullifier nonce (re-vote support).
 *   3. Rebuild the Semaphore group from chain events and generate the ZK
 *      membership proof binding keccak(ciphertext ‖ nonce) as the message.
 *   4. Submit castVote through the relayer, so every ballot reaches the chain
 *      from the same address and the sender reveals nothing (see relay.ts).
 */
import { getElection } from "./contracts";
import { queryLogsFrom } from "./logs";
import {
  ensureLocalRegistration,
  relayEnroll,
  relayVote,
  type EnrollAttestationInput,
} from "./relay";
import { encryptBallot } from "./paillier";
import {
  computeNullifier,
  fetchElectionGroup,
  generateVoteProof,
  getOrCreateIdentity,
  getStoredIdentity,
  rememberVote,
} from "./semaphore";

export interface VoteResult {
  txHash: string;
  nullifier: bigint;
  nonce: bigint;
  referenceNumber: string;
}

/**
 * Enrolls the voter's Semaphore identity into an election, via the relayer.
 *
 * `attestation` is required by elections that declare an attribute policy and
 * refused by those that do not, so the caller passes whichever the election
 * asked for. See `lib/eligibility.ts` for how one is obtained.
 */
export async function enrollInElection(
  electionAddress: string,
  attestation?: EnrollAttestationInput,
): Promise<{ txHash: string }> {
  const identity = await getOrCreateIdentity();
  await ensureLocalRegistration(identity.commitment); // no-op off the local chain
  return relayEnroll(electionAddress, identity.commitment, attestation);
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

  // 4. Relayed submission, carrying no session identifier, so nothing on chain
  //    ties this ballot to a voter. The issuer still sees the request's network
  //    origin, which is a metadata link this design does not close (see relay.ts).
  const { txHash } = await relayVote({
    election: electionAddress,
    voteCiphertext: ciphertext,
    nullifier: proof.nullifier,
    merkleRoot: proof.merkleTreeRoot,
    merkleDepth: proof.merkleTreeDepth,
    pA: proof.pA,
    pB: proof.pB,
    pC: proof.pC,
  });

  // Remember this device voted here (public nullifier) so the UI can show
  // "already voted" without a passkey prompt later.
  rememberVote(electionAddress, proof.nullifier);

  return {
    txHash,
    nullifier: proof.nullifier,
    nonce,
    // Full, copyable receipt (the on-chain tx hash). The UI truncates it for
    // display but copies the whole value.
    referenceNumber: txHash,
  };
}

/** Looks up the vote history for the locally stored identity in one election. */
export async function fetchVoteReceipts(electionAddress: string, nullifier: bigint) {
  const election = getElection(electionAddress);
  const events = await queryLogsFrom(election, election.filters.VoteCast(nullifier));
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
 * The candidate is intentionally NOT recoverable: anonymity means history can
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
      referenceNumber: last.txHash,
      nullifier: nullifier.toString(16).slice(0, 16),
    });
  }
  return entries.sort((a, b) => b.lastVoteAt.getTime() - a.lastVoteAt.getTime());
}
