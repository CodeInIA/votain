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
import { eventArgs, queryLogsFrom } from "./logs";
import {
  ensureLocalRegistration,
  relayEnroll,
  relayEnrollPrivate,
  relayVote,
  type EnrollAttestationInput,
} from "./relay";
import type { Identity } from "@semaphore-protocol/identity";
import { identityForElection } from "./electionIdentity";
import { claimAttestation } from "./eligibility";
import { counterBaseFor, encryptBallot } from "./paillier";
import { mapWithConcurrency } from "./utils";

/** Elections read at once when a screen fans out over all of them. */
const READ_CONCURRENCY = 6;
import {
  computeNullifier,
  ensureRegistered,
  fetchElectionGroup,
  generateVoteProof,
  getOrCreateIdentity,
  getStoredIdentity,
  getStoredVoteNullifier,
  phraseIsUnprotected,
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
 * Whether this election hands out its own commitments.
 *
 * Read from the election rather than assumed, because the answer was frozen
 * into it at deployment: anything the current factory deploys enrols privately
 * and refuses the public paths, while an election from before that keeps them.
 * Cached per address, since it can never change.
 */
const privateEnrolment = new Map<string, boolean>();

async function enrolsPrivately(electionAddress: string): Promise<boolean> {
  const key = electionAddress.toLowerCase();
  const known = privateEnrolment.get(key);
  if (known !== undefined) return known;

  let answer = false;
  try {
    const attester: string = await getElection(electionAddress).platformAttester();
    answer = attester !== "0x0000000000000000000000000000000000000000";
  } catch (error: unknown) {
    // An election deployed before the function existed REVERTS rather than
    // answering zero. Same meaning: the old doors. Anything else (the RPC
    // down, a timeout) is not an answer at all: caching "public" then would
    // have this tab enrol and vote with the wrong identity until it reloads,
    // so it is thrown and asked again next time.
    if ((error as { code?: string } | null)?.code !== "CALL_EXCEPTION") throw error;
    answer = false;
  }
  privateEnrolment.set(key, answer);
  return answer;
}

/**
 * The identity a voter uses in one election, which is not the one the platform
 * knows them by.
 *
 * See `lib/electionIdentity`: the commitment that lands in an election's tree
 * is derived from the voter's secret and that election's address, so the chain
 * no longer shows that the same person joined two of them. Elections from
 * before that keep using the platform identity, because that is the leaf that
 * is already in their tree.
 */
export async function votingIdentity(electionAddress: string, master?: Identity) {
  // The caller passes one where prompting would be wrong: the history reads
  // whatever is already unlocked and shows nothing rather than summoning an
  // authenticator dialog to draw a list.
  const base = master ?? (await getOrCreateIdentity());
  return (await enrolsPrivately(electionAddress))
    ? identityForElection(base, electionAddress)
    : base;
}

/**
 * Enrols the voter into an election, via the relayer.
 *
 * `sessionId` is the attribute check the voter just passed, for the elections
 * that ask for one. What is done with it depends on the door:
 *
 *   private  the session goes to the server, which verifies it, consumes it and
 *            signs one authorisation covering both questions, over a commitment
 *            derived for this election alone.
 *   public   an attestation is claimed here, over the voter's platform
 *            commitment, which is what those elections already hold.
 *
 * The caller does not have to know which, and deliberately so: the two differ
 * in what reaches the chain about the voter, and that is not a decision to
 * spread across the interface.
 */
export async function enrollInElection(
  electionAddress: string,
  sessionId?: string,
): Promise<{ txHash: string }> {
  const identity = await getOrCreateIdentity();
  await ensureLocalRegistration(identity.commitment); // no-op off the local chain
  // The safety net for a voter carrying nothing but the phrase: their
  // registration happens when the identity is minted, but that call is best
  // effort, and a backend that was unreachable then would otherwise leave them
  // to discover it here as `NotPlatformVerified`. Skipped for anyone whose
  // phrase a passkey already holds, since reaching the vault is what registered
  // them in the first place.
  //
  // Still the PLATFORM identity, on both paths: it is what the registry holds,
  // and registering a per-election commitment would put the very link back that
  // deriving one exists to remove.
  if (phraseIsUnprotected()) await ensureRegistered(identity);

  if (await enrolsPrivately(electionAddress)) {
    const enrolling = await identityForElection(identity, electionAddress);
    return relayEnrollPrivate(electionAddress, enrolling.commitment, sessionId);
  }

  const attestation: EnrollAttestationInput | undefined = sessionId
    ? await claimAttestation(electionAddress, sessionId, identity.commitment)
    : undefined;
  return relayEnroll(electionAddress, identity.commitment, attestation);
}

/** Casts (or re-casts) a vote for `optionIndex` (blank = numOptions). */
export async function castVote(electionAddress: string, optionIndex: number): Promise<VoteResult> {
  // Re-derive from the passkey if the in-memory identity was lost (page reload),
  // then take the identity THIS election knows, which is a derived one wherever
  // the election enrols privately.
  const identity = await votingIdentity(electionAddress);

  const election = getElection(electionAddress);
  const [paillierPk, scope, metadataJson] = await Promise.all([
    election.paillierPublicKey(),
    election.scope(),
    election.metadataJson(),
  ]);

  // 1. Encrypt ballot, in the base THIS election records. Using the current
  //    constant instead would make every ballot cast after a base change
  //    unreadable to a tally that correctly follows the election's own.
  const ciphertext = encryptBallot(paillierPk, optionIndex, counterBaseFor(metadataJson));

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
    const args = eventArgs<{
      nullifier: bigint;
      voteCiphertext: string;
      nonce: bigint;
      timestamp: bigint;
    }>(e);
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

  // In parallel, then the first match in the order given, so the answer is
  // the same as the one-at-a-time loop gave, without waiting on every miss.
  const found = await mapWithConcurrency(elections, READ_CONCURRENCY, el =>
    fetchVoteReceipts(el.contractAddress, nullifier),
  );
  for (let i = 0; i < elections.length; i++) {
    const el = elections[i];
    const receipts = found[i];
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
  const known = elections.flatMap(el => {
    const nullifier = getStoredVoteNullifier(el.contractAddress);
    return nullifier === null ? [] : [{ el, nullifier }];
  });
  const found = await mapWithConcurrency(known, READ_CONCURRENCY, ({ el, nullifier }) =>
    fetchVoteReceipts(el.contractAddress, nullifier),
  );
  for (let i = 0; i < known.length; i++) {
    const { el, nullifier } = known[i];
    const receipts = found[i];
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
  const master = getStoredIdentity();
  if (!master) return [];

  const entries: VoteHistoryEntry[] = [];
  const looked = await mapWithConcurrency(elections, READ_CONCURRENCY, async el => {
    const election = getElection(el.contractAddress);
    const scope: bigint = el.scope ?? BigInt(await election.scope());
    // Per election, because that is what the ballot was cast with wherever the
    // election enrols privately. Computing this from the platform identity
    // found nothing at all there, which reads as "you never voted".
    const identity = await votingIdentity(el.contractAddress, master);
    const nullifier = computeNullifier(identity, scope);
    return { el, nullifier, receipts: await fetchVoteReceipts(el.contractAddress, nullifier) };
  });
  for (const { el, nullifier, receipts } of looked) {
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
