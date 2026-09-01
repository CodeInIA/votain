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
import { getElection, getReadProvider } from "./contracts";
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
  getStoredVoteNullifier,
  rememberVote,
} from "./semaphore";

export interface VoteResult {
  txHash: string;
  nullifier: bigint;
  nonce: bigint;
  /**
   * What the voter is shown and can hand to anyone: the TRANSACTION HASH.
   *
   * Spelled out because the word "reference" used to name two different values,
   * this one and the vote nullifier on `Election`, and the verifier was given
   * whichever the caller happened to have. It is the transaction hash
   * throughout now; the nullifier is `Election.voteNullifier`.
   */
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

/**
 * A vote receipt anyone can look up, holder or not.
 *
 * The point of publishing a nullifier is that a THIRD PARTY can check a receipt
 * somebody shows them: an auditor, a journalist, a losing candidate. So this
 * takes no identity, no session and no stored secret, only the string on the
 * receipt, and it reads the same public events the voter's own history reads.
 *
 * What it can confirm is that a ballot was recorded, when, and in which
 * election. What it can never confirm is WHAT was voted, which is the same
 * limit the voter's own history has and is the property the whole design is
 * built to keep.
 */
export interface PublicReceipt {
  electionId: string;
  electionTitle: string;
  phase: string;
  /** Full, `0x`-prefixed. This is the value the chain indexed the vote by. */
  nullifier: string;
  txHash: string;
  timestamp: Date;
  /** Every ballot this nullifier cast here. A re-vote replaces, so the last wins. */
  voteCount: number;
}

/** Reads a query as a nullifier, in either of the two forms a receipt shows it. */
function parseNullifier(query: string): bigint | null {
  const trimmed = query.trim();
  try {
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed);
    if (/^\d+$/.test(trimmed)) return BigInt(trimmed);
  } catch {
    return null;
  }
  return null;
}

/**
 * Finds one receipt from a transaction hash or a nullifier.
 *
 * BOTH are tried for a `0x` string of 32 bytes, because a nullifier is a field
 * element and prints at exactly the same width as a transaction hash: there is
 * no way to tell them apart by looking. The transaction lookup goes first
 * because it is one request and settles the question; only when no such
 * transaction exists is the same string tried as a nullifier.
 */
export async function findVoteReceipt(
  query: string,
  elections: { contractAddress: string; title: string; phase: string }[],
): Promise<PublicReceipt | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const known = new Map(elections.map(e => [e.contractAddress.toLowerCase(), e]));

  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    const found = await receiptFromTransaction(trimmed, known);
    if (found) return found;
  }

  const nullifier = parseNullifier(trimmed);
  if (nullifier === null) return null;

  for (const el of elections) {
    const receipts = await fetchVoteReceipts(el.contractAddress, nullifier);
    if (receipts.length === 0) continue;
    const last = receipts[receipts.length - 1];
    return {
      electionId: el.contractAddress,
      electionTitle: el.title,
      phase: el.phase,
      nullifier: `0x${nullifier.toString(16)}`,
      txHash: last.txHash,
      timestamp: last.timestamp,
      voteCount: receipts.length,
    };
  }
  return null;
}

/** The transaction path: one receipt, read for the VoteCast it emitted. */
async function receiptFromTransaction(
  txHash: string,
  known: Map<string, { contractAddress: string; title: string; phase: string }>,
): Promise<PublicReceipt | null> {
  const receipt = await getReadProvider()
    .getTransactionReceipt(txHash)
    .catch(() => null);
  if (!receipt) return null;

  for (const log of receipt.logs) {
    const election = known.get(log.address.toLowerCase());
    // A log from a contract this app does not know is not a Votain ballot, and
    // decoding it against our ABI would be reading a stranger's data.
    if (!election) continue;

    let parsed;
    try {
      parsed = getElection(election.contractAddress).interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== "VoteCast") continue;

    const nullifier = parsed.args.nullifier as bigint;
    const all = await fetchVoteReceipts(election.contractAddress, nullifier);
    return {
      electionId: election.contractAddress,
      electionTitle: election.title,
      phase: election.phase,
      nullifier: `0x${nullifier.toString(16)}`,
      txHash: receipt.hash,
      timestamp: new Date(Number(parsed.args.timestamp) * 1000),
      voteCount: all.length || 1,
    };
  }
  return null;
}

export interface VoteHistoryEntry {
  electionId: string;
  electionTitle: string;
  phase: string;
  lastVoteAt: Date;
  voteCount: number;
  /** The transaction hash of the last ballot. See `VoteResult`. */
  referenceNumber: string;
  /** The vote nullifier, full and `0x`-prefixed. Both are accepted by the verifier. */
  nullifier: string;
}

/**
 * The votes THIS BROWSER cast, read without the voting identity.
 *
 * `fetchVoteHistory` re-derives a nullifier per election from the Semaphore
 * secret, which in PRF mode is not stored at rest: after a reload it needs a
 * passkey tap before it can answer at all. But the nullifier of a ballot is a
 * PUBLIC value, sitting in the `VoteCast` event, and `rememberVote` already
 * writes each one down at the moment the vote is cast. So for a read there is
 * nothing to derive and nothing to unlock.
 *
 * What it cannot see is a ballot this browser has never heard of: one cast on
 * another device and not yet learned through an unlock. That is the honest
 * limit and the reason the full lookup still exists. After an unlock the two
 * agree, until the voter uses another device again.
 *
 * Cheaper as well as promptless: it queries only the elections this browser has
 * a record for, rather than every election in the list.
 */
export async function fetchLocalVoteHistory(
  elections: { contractAddress: string; title: string; phase: string }[],
): Promise<VoteHistoryEntry[]> {
  const entries: VoteHistoryEntry[] = [];
  for (const el of elections) {
    const nullifier = getStoredVoteNullifier(el.contractAddress);
    if (nullifier === null) continue;

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
      nullifier: `0x${nullifier.toString(16)}`,
    });
  }
  return entries.sort((a, b) => b.lastVoteAt.getTime() - a.lastVoteAt.getTime());
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

    // Learned once, so this browser stops needing the passkey to answer the
    // same question again. The nullifier is public, sitting in the event just
    // read, and this device already records the ones for its own ballots; what
    // is new is that a ballot cast elsewhere becomes visible here afterwards.
    //
    // Only where a vote actually exists. Writing the nullifier of an election
    // the voter skipped would put a link between them and that election on this
    // disk, and buy nothing for it.
    rememberVote(el.contractAddress, nullifier);

    const last = receipts[receipts.length - 1];
    entries.push({
      electionId: el.contractAddress,
      electionTitle: el.title,
      phase: el.phase,
      lastVoteAt: last.timestamp,
      voteCount: receipts.length,
      referenceNumber: last.txHash,
      // Full, not the first 16 hex characters it used to carry: a truncated
      // nullifier cannot be looked up, so exporting or copying one gave the
      // voter a string that verifies nothing.
      nullifier: `0x${nullifier.toString(16)}`,
    });
  }
  return entries.sort((a, b) => b.lastVoteAt.getTime() - a.lastVoteAt.getTime());
}
