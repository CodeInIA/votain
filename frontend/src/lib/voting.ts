/**
 * Voter actions: enroll and cast/change vote.
 *
 * Pipeline for a vote (see `ballot.ts` for the construction):
 *   1. Find the voter's place in their own chain of ballots, which only their
 *      secret can do, and the ballot the new one must cancel.
 *   2. Encrypt the choice under the election's tally keys, with a cancellation
 *      of the previous ballot (of nothing, on a first one), and prove it all in
 *      zero knowledge.
 *   3. Submit through the relayer, so every ballot reaches the chain from the
 *      same address and the sender reveals nothing (see relay.ts).
 *
 * A first ballot and a re-vote look the same on chain and share no public
 * value, so nobody watching can tell that a voter changed their mind.
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
import { fetchBallots, prepareBallot, voterChain } from "./ballot";
import { mapWithConcurrency } from "./utils";
import {
  ensureRegistered,
  getOrCreateIdentity,
  getStoredBallotTag,
  getStoredIdentity,
  phraseIsUnprotected,
  rememberVote,
} from "./semaphore";

/** Elections read at once when a screen fans out over all of them. */
const READ_CONCURRENCY = 6;

export interface VoteResult {
  txHash: string;
  /** The ballot's tag: public, and linked to no other ballot of this voter's. */
  tag: bigint;
  /** Which step of the voter's own chain this ballot is; zero for the first. */
  k: bigint;
  /**
   * What the voter is shown and can hand to anyone: the TRANSACTION HASH.
   * The tag is `tag`; both are accepted by the receipt lookup.
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

  const prepared = await prepareBallot(electionAddress, identity, optionIndex);

  // Relayed submission, carrying no session identifier, so nothing on chain
  // ties this ballot to a voter. The issuer still sees the request's network
  // origin, which is a metadata link this design does not close (see relay.ts).
  const { txHash } = await relayVote({ election: electionAddress, ballot: prepared.calldata, proof: prepared.proof });

  // Remember this device voted here (public tag) so the UI can show "already
  // voted" without a passkey prompt later.
  rememberVote(electionAddress, prepared.ballot.tag);

  return { txHash, tag: prepared.ballot.tag, k: prepared.k, referenceNumber: txHash };
}

/** One ballot as a receipt shows it. */
interface BallotReceipt {
  tag: bigint;
  txHash: string;
  timestamp: Date;
}

/** The ballot filed under one tag, or null. A tag is cast at most once. */
async function fetchBallotByTag(electionAddress: string, tag: bigint): Promise<BallotReceipt | null> {
  const election = getElection(electionAddress);
  const [event] = await queryLogsFrom(election, election.filters.BallotCast(tag));
  if (!event) return null;
  const args = eventArgs<{ tag: bigint; timestamp: bigint }>(event);
  return { tag: args.tag, txHash: event.transactionHash, timestamp: new Date(Number(args.timestamp) * 1000) };
}

/**
 * A vote receipt anyone can look up, holder or not.
 *
 * The point of a public receipt is that a THIRD PARTY can check one somebody
 * shows them: an auditor, a journalist, a losing candidate. So this takes no
 * identity, no session and no stored secret, only the string on the receipt,
 * and reads the same public events the voter's own history reads.
 *
 * What it can confirm is that a ballot was recorded, when, and in which
 * election. What it can never confirm is WHAT was voted, nor whether the same
 * voter cast other ballots: each ballot's tag is unrelated to the others, which
 * is exactly what keeps a re-vote invisible to whoever demanded the first one.
 */
export interface PublicReceipt {
  electionId: string;
  electionTitle: string;
  phase: string;
  /** Full, `0x`-prefixed. This is the value the chain indexed the ballot by. */
  tag: string;
  txHash: string;
  timestamp: Date;
}

/** Reads a query as a tag, in either of the two forms a receipt shows it. */
function parseTag(query: string): bigint | null {
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
 * Finds one receipt from a transaction hash or a ballot tag.
 *
 * BOTH are tried for a `0x` string of 32 bytes, because a tag is a field
 * element and prints at exactly the same width as a transaction hash: there is
 * no way to tell them apart by looking. The transaction lookup goes first
 * because it is one request and settles the question; only when no such
 * transaction exists is the same string tried as a tag.
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

  const tag = parseTag(trimmed);
  if (tag === null) return null;

  // In parallel, then the first match in the order given, so the answer is
  // the same as a one-at-a-time loop gives, without waiting on every miss.
  const found = await mapWithConcurrency(elections, READ_CONCURRENCY, el =>
    fetchBallotByTag(el.contractAddress, tag),
  );
  for (let i = 0; i < elections.length; i++) {
    const ballot = found[i];
    if (!ballot) continue;
    const el = elections[i];
    return {
      electionId: el.contractAddress,
      electionTitle: el.title,
      phase: el.phase,
      tag: `0x${tag.toString(16)}`,
      txHash: ballot.txHash,
      timestamp: ballot.timestamp,
    };
  }
  return null;
}

/** The transaction path: one receipt, read for the BallotCast it emitted. */
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
    if (parsed?.name !== "BallotCast") continue;

    const tag = parsed.args.tag as bigint;
    return {
      electionId: election.contractAddress,
      electionTitle: election.title,
      phase: election.phase,
      tag: `0x${tag.toString(16)}`,
      txHash: receipt.hash,
      timestamp: new Date(Number(parsed.args.timestamp) * 1000),
    };
  }
  return null;
}

export interface VoteHistoryEntry {
  electionId: string;
  electionTitle: string;
  phase: string;
  lastVoteAt: Date;
  /**
   * Ballots this voter cast here, when known. Only the full lookup, which holds
   * the secret, can count them: nothing public links one ballot to another.
   */
  voteCount?: number;
  /** The transaction hash of the last ballot. See `VoteResult`. */
  referenceNumber: string;
  /** The last ballot's tag, full and `0x`-prefixed. Both are accepted by the verifier. */
  tag: string;
}

/**
 * The votes THIS BROWSER cast, read without the voting identity.
 *
 * `fetchVoteHistory` walks each election's ballots with the voter's secret,
 * which in PRF mode is not stored at rest: after a reload it needs a passkey
 * tap before it can answer at all. But a ballot's tag is PUBLIC, sitting in the
 * `BallotCast` event, and `rememberVote` writes down the latest one at the
 * moment the vote is cast. So for a read there is nothing to derive and
 * nothing to unlock.
 *
 * What it cannot see is a ballot this browser has never heard of, one cast on
 * another device and not yet learned through an unlock, nor how many ballots
 * came before. That is the honest limit and the reason the full lookup exists.
 */
export async function fetchLocalVoteHistory(
  elections: { contractAddress: string; title: string; phase: string }[],
): Promise<VoteHistoryEntry[]> {
  const known = elections.flatMap(el => {
    const tag = getStoredBallotTag(el.contractAddress);
    return tag === null ? [] : [{ el, tag }];
  });
  const found = await mapWithConcurrency(known, READ_CONCURRENCY, ({ el, tag }) =>
    fetchBallotByTag(el.contractAddress, tag),
  );
  const entries: VoteHistoryEntry[] = [];
  for (let i = 0; i < known.length; i++) {
    const ballot = found[i];
    if (!ballot) continue;
    const { el, tag } = known[i];
    entries.push({
      electionId: el.contractAddress,
      electionTitle: el.title,
      phase: el.phase,
      lastVoteAt: ballot.timestamp,
      referenceNumber: ballot.txHash,
      tag: `0x${tag.toString(16)}`,
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
  elections: { contractAddress: string; title: string; phase: string }[],
): Promise<VoteHistoryEntry[]> {
  const master = getStoredIdentity();
  if (!master) return [];

  const looked = await mapWithConcurrency(elections, READ_CONCURRENCY, async el => {
    const scope: bigint = await getElection(el.contractAddress).scope();
    // Per election, because that is what the ballot was cast with wherever the
    // election enrols privately. Walking with the platform identity found
    // nothing at all there, which reads as "you never voted".
    const identity = await votingIdentity(el.contractAddress, master);
    const { mine } = voterChain(identity.secretScalar, scope, await fetchBallots(el.contractAddress));
    return { el, mine };
  });

  const entries: VoteHistoryEntry[] = [];
  for (const { el, mine } of looked) {
    const last = mine.at(-1);
    if (!last) continue;

    // Learned once, so this browser stops needing the passkey to answer the
    // same question again. Only where a vote actually exists: writing a tag for
    // an election the voter skipped would put a link between them and that
    // election on this disk, and buy nothing for it.
    rememberVote(el.contractAddress, last.tag);

    entries.push({
      electionId: el.contractAddress,
      electionTitle: el.title,
      phase: el.phase,
      lastVoteAt: last.timestamp,
      voteCount: mine.length,
      referenceNumber: last.txHash,
      tag: `0x${last.tag.toString(16)}`,
    });
  }
  return entries.sort((a, b) => b.lastVoteAt.getTime() - a.lastVoteAt.getTime());
}
