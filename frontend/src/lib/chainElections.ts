/**
 * Chain → UI mapping layer.
 *
 * Reads ElectionV4 state and converts it into the same `Election` shape the
 * Phase A screens already consume, so components stay presentation-only.
 */
import { id } from "ethers";
import { getElection, getFactory, getReadProvider } from "./contracts";
import { eventArgs, queryLogsFrom, queryTopicLogs } from "./logs";
import { withDistinctNames } from "./ballotNames";
// The i18n singleton rather than the hook: this is a data layer, not a
// component. The labels below were hardcoded English and rendered that way in
// all thirteen locales. The tradeoff is that a language change does not
// retranslate an already-fetched election until it is refetched, which every
// navigation does.
import i18n from "../i18n/config";
import { getStoredCommitment, getStoredIdentity, getStoredVoteNullifier } from "./semaphore";
import type { Identity } from "@semaphore-protocol/identity";
import {
  commitmentsForElections,
  hasStoredElectionCommitments,
  identityForElection,
  storedElectionCommitment,
} from "./electionIdentity";
import type { Candidate, Election, ElectionPhase, VotingType } from "../data/seed";
import { getVoterPersonhood } from "./voterSession";
import { mapWithConcurrency } from "./utils";

/** Addresses asked of the factory per call. */
const ADDRESS_PAGE = 500;
import {
  asPersonhoodLevel,
  effectivePersonhood,
  personhoodSatisfied,
  policyHash,
  type EligibilityPolicy,
  type PersonhoodLevel,
} from "./eligibility";

/** One label per level, so the three names live in one place. */
export const PERSONHOOD_LABEL_KEY: Record<PersonhoodLevel, string> = {
  device: "eligibility.world_id_device",
  document: "eligibility.personhood_document",
  orb: "eligibility.personhood_orb",
};

// Index order MUST match ElectionV4's Phase enum exactly.
const PHASE_MAP: ElectionPhase[] = [
  "upcoming", "enrolling", "pending_vote", "active", "tallying", "closed", "voided", "cancelled",
];
const VOTING_TYPE_MAP: VotingType[] = [
  "simple_plurality",
  "absolute_majority",
  "two_thirds",
  "witness_threshold",
];

interface ElectionMetadata {
  description?: string;
  organizerName?: string;
  organizerDomain?: string;
  candidates?: Array<{ name: string; description?: string }>;
  privacyQuorum?: number;
  keyNonce?: string;
  eligibility?: EligibilityPolicy;
  /**
   * Legacy. Superseded by `eligibility.personhood`, which is covered by the
   * on-chain policy hash where this flag never was: anyone able to rewrite the
   * metadata could turn this one off and nothing would notice. Still read, so
   * elections created before the move keep displaying the bar they were sold
   * with, and still written by nothing.
   */
  requireOrb?: boolean;
  tags?: string[];
}

function parseMetadata(json: string): ElectionMetadata {
  try {
    return JSON.parse(json) as ElectionMetadata;
  } catch {
    return {};
  }
}

const toDate = (ts: bigint): Date => new Date(Number(ts) * 1000);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Reads one election's full state and maps it to the UI model. */
export async function fetchElection(address: string): Promise<Election> {
  const c = getElection(address);

  const [
    name,
    organizerAddress,
    votingType,
    thresholdValue,
    numOptions,
    enrollStart,
    enrollEnd,
    voteStart,
    voteEnd,
    phase,
    memberCount,
    voteCount,
    distinctVoters,
    resultsPublished,
    metadataJson,
    policyHashOnChain,
    fixedSchedule,
    cancellable,
    createdAt,
    platformAttester,
    privacyQuorumOnChain,
  ] = await Promise.all([
    c.name(),
    c.organizer(),
    c.votingType(),
    c.thresholdValue(),
    c.numOptions(),
    c.enrollStart(),
    c.enrollEnd(),
    c.voteStart(),
    c.voteEnd(),
    c.phase(),
    c.memberCount(),
    c.voteCount(),
    c.distinctVoters(),
    c.resultsPublished(),
    c.metadataJson(),
    c.eligibilityPolicyHash() as Promise<string>,
    c.fixedSchedule() as Promise<boolean>,
    c.cancellable() as Promise<boolean>,
    c.createdAt() as Promise<bigint>,
    // Which door this election enrols through, and therefore which commitment
    // of ours its tree would hold. Elections from before private enrolment have
    // no such function and revert rather than answering zero.
    (c.platformAttester() as Promise<string>).catch(() => ZERO_ADDRESS),
    // The floor `publishResults` enforces. The metadata keeps a copy for
    // display, but only the contract's own value is binding.
    (c.privacyQuorum() as Promise<bigint>).catch(() => null),
  ]);

  const meta = parseMetadata(metadataJson);

  // The attribute policy comes from the metadata, checked against the hash the
  // contract stores, which is the same check the backend makes before it will
  // attest anything. Reading it here rather than asking the backend per election
  // is what lets lists and cards show restrictions without a request each, and
  // it removes a second source of truth that could disagree with the first.
  //
  // A policy whose hash does not match is treated as no policy: it is either
  // written by something that disagrees about the canonical form, or it was
  // never consistent, and either way it is not what enrollment is gated on.
  let eligibilityPolicy: EligibilityPolicy | undefined;
  if (meta.eligibility) {
    const declared = await policyHash(meta.eligibility);
    if (declared === String(policyHashOnChain).toLowerCase()) {
      eligibilityPolicy = meta.eligibility;
    } else {
      console.warn(`Election ${address}: eligibility policy does not match its published hash`);
    }
  }

  // What this voter's own World ID session reached, as last reconciled against
  // `/api/me`. A hint for display only: the binding check is the backend's, on
  // the signed credential, at the moment it is asked to sign an attestation.
  const heldLevel = asPersonhoodLevel(getVoterPersonhood());

  // The policy wins when it states a level, because that statement is inside
  // the bytes the on-chain hash commits to. `requireOrb` is only consulted for
  // elections deployed before the field existed, which have no policy to ask.
  const personhood: PersonhoodLevel = eligibilityPolicy?.personhood
    ? eligibilityPolicy.personhood
    : meta.requireOrb
      ? "orb"
      : effectivePersonhood(eligibilityPolicy);

  const candidates: Candidate[] = (meta.candidates ?? []).map((cand, i) => ({
    id: `option-${i}`,
    name: cand.name,
    description: cand.description,
  }));
  candidates.push({ id: `option-${Number(numOptions)}`, name: i18n.t("election.blank_vote") });

  let ipfsCid: string | undefined;
  if (resultsPublished) {
    const [cid, tally, outcome, winnerIndex] = await Promise.all([
      c.resultsCid(),
      c.tally(),
      c.outcome(),
      c.winnerIndex(),
    ]);
    ipfsCid = cid || undefined;
    const counts = (tally as bigint[]).map(Number);
    candidates.forEach((cand, i) => {
      cand.votes = counts[i] ?? 0;
    });
    // Whether these counters are what the ballots hold is checked on the
    // results screen, against the proof published with them: see `TallyCheck`.

    // Outcome: 1=WINNER, 2=TIE
    if (Number(outcome) === 1) candidates[Number(winnerIndex)].isWinner = true;
    if (Number(outcome) === 2) {
      const max = Math.max(...counts.slice(0, Number(numOptions)));
      candidates.forEach((cand, i) => {
        if (i < Number(numOptions) && counts[i] === max) cand.isTie = true;
      });
    }
  }

  // The uncircumventable half of the uniqueness rule. Everything upstream runs
  // in the organizer's browser and can be skipped by building the creation
  // transaction by hand, but no election reaches a voter except through this
  // function. Applied AFTER the blank option is appended and after the results
  // are attached, in the reader's own language, so it catches the collision
  // that actually happens on screen rather than the one the organizer was
  // shown, and so it cannot drop a field written onto the originals. Returns
  // the list untouched when nothing collides, which is every normal election.
  const ballot = withDistinctNames(candidates);
  if (ballot !== candidates) {
    console.warn(`Election ${address}: ballot options share a name; positions appended`);
  }

  // Voter-specific view state. The PUBLIC commitment is enough for the enrolled
  // check and, unlike the full identity, is readable in PRF mode without a
  // passkey prompt (so it survives reloads / new sessions).
  /**
   * The commitment THIS election would hold.
   *
   * Derived from the secret where the election enrols privately, and the
   * platform commitment where it does not. Derived FIRST, before the cache:
   * the cache only knows the elections this browser has already visited, which
   * is why a second browser holding the same identity was told it had not
   * enrolled in an election it had.
   */
  const master = getStoredIdentity();
  let commitment: bigint | null;
  if (platformAttester !== ZERO_ADDRESS) {
    commitment = master
      ? (await identityForElection(master, address)).commitment
      : storedElectionCommitment(address);
  } else {
    commitment = getStoredCommitment();
  }

  let isEnrolled: boolean | undefined;
  if (commitment !== null) {
    isEnrolled = await c.hasMember(commitment);
  }

  // "Already voted": verify the device's remembered vote nullifier on-chain.
  let hasVoted: boolean | undefined;
  const votedNullifier = getStoredVoteNullifier(address);
  if (votedNullifier !== null) {
    hasVoted = (await c.nullifierNonces(votedNullifier)) > 0n;
  }

  const basePhase = PHASE_MAP[Number(phase)] ?? "upcoming";

  return {
    id: address,
    contractAddress: address,
    title: name,
    description: meta.description ?? "",
    phase: basePhase,
    organizer: meta.organizerName ?? organizerAddress,
    organizerAddress,
    // The domain the election was created under. Kept as a snapshot: a
    // verification that lapses later must not rewrite the past.
    organizerDomain: meta.organizerDomain,
    enrollStart: toDate(enrollStart),
    enrollEnd: toDate(enrollEnd),
    voteStart: toDate(voteStart),
    voteEnd: toDate(voteEnd),
    candidates: ballot,
    eligibility: [
      // The bar this election actually sets, not just that it sets one. A voter
      // who can only reach the lowest of the three needs to know that before
      // they get their passport out.
      {
        id: "platform",
        label: i18n.t(PERSONHOOD_LABEL_KEY[personhood]),
        // A stored commitment proves this browser has a Votain identity, which
        // is not the same as meeting THIS election's bar, and reading it as
        // such put a green tick in front of voters the enrollment then refused
        // with `orb_required`. Enrollment settles it: the contract will not
        // take a member the level was not met for. Before that, the session's
        // own level answers, and an unknown level stays unknown.
        status: isEnrolled
          ? "met"
          : commitment !== null && personhoodSatisfied(personhood, heldLevel)
            ? "met"
            : "unknown",
      },
      { id: "enrolled", label: i18n.t("eligibility.enrolled"), status: isEnrolled ? "met" : "not-met" },
    ],
    personhood,
    requiresOrb: personhood === "orb",
    totalEnrolled: Number(memberCount),
    castVotes: Number(voteCount),
    distinctVoters: Number(distinctVoters),
    ipfsCid,
    eligibilityPolicy,
    votingType: VOTING_TYPE_MAP[Number(votingType)] ?? "simple_plurality",
    thresholdValue: Number(thresholdValue),
    privacyQuorum:
      privacyQuorumOnChain !== null ? Number(privacyQuorumOnChain) : (meta.privacyQuorum ?? 0),
    fixedSchedule: Boolean(fixedSchedule),
    cancellable: Boolean(cancellable),
    createdAt: new Date(Number(createdAt) * 1000),
    keyNonce: meta.keyNonce,
    isEnrolled,
    hasVoted,
    // The vote's anonymous on-chain identifier, shown to the voter as their own
    // receipt. Distinct from the transaction hash the history calls a reference.
    voteNullifier: hasVoted && votedNullifier !== null ? "0x" + votedNullifier.toString(16) : undefined,
    tags: meta.tags,
  };
}

/** How many elections the factory holds. One cheap call, no hydration. */
export async function fetchElectionCount(): Promise<number> {
  return Number(await getFactory().electionsCount());
}

/**
 * Every election address, newest first.
 *
 * Addresses are cheap and hydration is not: this is one view call for the lot,
 * where turning those addresses into elections is about eighteen calls EACH.
 * Splitting the two is what lets a screen know how many elections exist, and in
 * what order, without paying to read any of them.
 *
 * Newest first because that is the order every list shows. The factory appends,
 * so its own array runs oldest first, and a screen that paged it in that order
 * would open on the oldest elections in the system.
 */
export async function fetchElectionAddresses(): Promise<string[]> {
  const factory = getFactory();
  const total = Number(await factory.electionsCount());
  if (total === 0) return [];
  // In pages, because one call returning every address grows without bound
  // and an RPC endpoint caps the size of a response long before the chain
  // caps the number of elections.
  const offsets = Array.from({ length: Math.ceil(total / ADDRESS_PAGE) }, (_, i) => i * ADDRESS_PAGE);
  const pages = await mapWithConcurrency(offsets, 4, offset =>
    factory.getElections(offset, ADDRESS_PAGE) as Promise<string[]>,
  );
  return pages.flat().reverse();
}

/** Hydrates the given addresses, preserving the order they were given in. */
export async function hydrateElections(addresses: string[]): Promise<Election[]> {
  return Promise.all(addresses.map(fetchElection));
}

/**
 * Enough of an election to search it, and nothing more.
 *
 * The receipt lookup and the vote history both walk EVERY election and both
 * need exactly three fields. Hydrating the full model for that was eighteen
 * calls per election to use two of them, and neither screen can be paginated
 * instead: a receipt that is not searched for is reported as forged, and a vote
 * in an election that was not loaded simply does not appear in your history.
 * So the list stays complete and the reading gets cheaper.
 */
export interface ElectionDigest {
  contractAddress: string;
  title: string;
  phase: ElectionPhase;
  /** Whether a tally has been published, which decides where a receipt links. */
  resultsPublished: boolean;
}

export async function fetchElectionDigests(addresses?: string[]): Promise<ElectionDigest[]> {
  const list = addresses ?? (await fetchElectionAddresses());
  return Promise.all(
    list.map(async address => {
      const c = getElection(address);
      const [name, phase, resultsPublished] = await Promise.all([
        c.name(),
        c.phase(),
        c.resultsPublished(),
      ]);
      return {
        contractAddress: address,
        title: String(name),
        phase: PHASE_MAP[Number(phase)] ?? "upcoming",
        resultsPublished: Boolean(resultsPublished),
      };
    }),
  );
}

/**
 * The elections one organizer created, from the event the factory already
 * indexes them by.
 *
 * `ElectionCreated` declares `organizer` as an indexed argument, which means the
 * chain keeps a lookup the dashboard was not using: it read every election ever
 * created and kept the ones whose `organizer` field matched. On a platform with
 * a thousand elections that is a thousand hydrations to show the four that are
 * yours, and it is why the dashboard's totals could not be both exact and cheap.
 *
 * FALLS BACK TO THE FULL LIST rather than to an empty one. An endpoint that
 * refuses the log query, or a deployment block recorded wrongly, must not be
 * able to tell an organizer they have no elections. The caller filters by
 * organizer anyway, so the fallback is the old behaviour: correct, and slow.
 */
export async function fetchOrganizerElectionAddresses(organizer: string): Promise<string[]> {
  const factory = getFactory();
  try {
    const logs = await queryLogsFrom(factory, factory.filters.ElectionCreated(null, organizer));
    const addresses = logs.map(
      log => eventArgs<{ electionAddress: string }>(log).electionAddress,
    );
    return addresses.reverse();
  } catch (error) {
    console.warn("Could not read the organizer's election index; reading them all:", error);
    return fetchElectionAddresses();
  }
}

/**
 * The elections one voter enrolled in, in a single query.
 *
 * `MemberEnrolled` indexes the identity commitment, so every enrolment this
 * voter ever made can be asked for at once, across all elections, instead of
 * asking each election "is this commitment a member of yours". The commitment is
 * public (it is on the chain in the clear), so this reveals nothing that reading
 * the chain does not already reveal.
 *
 * INTERSECTED WITH THE FACTORY'S OWN LIST, because a topic query names no
 * contract: any address at all can emit an event with this signature and this
 * commitment, and without the intersection anyone could inject rows into a
 * voter's list of elections. Ordered by the factory, not by the logs, so the
 * result is in the same newest-first order as every other list.
 */
export async function fetchEnrolledElectionAddresses(
  master: Identity | null,
  platformCommitment: bigint | null,
): Promise<string[]> {
  // NOTHING TO MATCH WITH, so nothing to read. A device with no identity and
  // no derived commitments would otherwise pay for the factory list and a log
  // query to arrive at an empty array.
  if (!master && platformCommitment === null && !hasStoredElectionCommitments()) return [];

  const known = await fetchElectionAddresses();

  /**
   * One HKDF and one Semaphore identity per election, done locally and
   * remembered, so a second visit costs nothing. Without the secret this reads
   * back only what this device derived before.
   */
  const mine = await commitmentsForElections(master, known);

  try {
    // EVERY enrolment, not this voter's. The index is keyed on the commitment,
    // and since each election holds a different one of ours there is no single
    // value to filter on any more: that is precisely what stops anybody else
    // asking this question. So the log set comes back whole, in one query, and
    // the matching happens here, where the secret is.
    const logs = await queryTopicLogs(getReadProvider(), [
      id("MemberEnrolled(uint256,uint256,uint256)"),
    ]);

    const leaves = new Map<string, Set<string>>();
    for (const log of logs) {
      const address = log.address.toLowerCase();
      const commitment = BigInt(log.topics[1]).toString();
      const set = leaves.get(address) ?? new Set<string>();
      set.add(commitment);
      leaves.set(address, set);
    }

    return known.filter(address => {
      const key = address.toLowerCase();
      const set = leaves.get(key);
      if (!set) return false;
      const derived = mine.get(key);
      // The derived one for anything deployed since enrolments went private,
      // and the platform commitment for everything older, whose trees hold it.
      if (derived !== undefined && set.has(derived.toString())) return true;
      return platformCommitment !== null && set.has(platformCommitment.toString());
    });
  } catch (error) {
    console.warn("Could not read the enrolment index; reading them all:", error);
    return known;
  }
}

export interface ChainMember {
  commitment: string;
  index: number;
  enrolledAt?: Date;
  electionId: string;
  electionTitle: string;
}

/**
 * Reads a single election's enrolled members from MemberEnrolled events.
 *
 * ONE BLOCK READ PER BLOCK, not per member, which is the whole cost of this
 * function. An event carries no timestamp, only the block it was mined in, and
 * `e.getBlock()` fetches that block again for every event: a hundred members
 * meant a hundred round trips for what is usually a handful of distinct blocks,
 * because enrolments arrive in bursts and several share one. Asking for each
 * block once collapses that.
 *
 * A block that cannot be read leaves the date undefined rather than failing the
 * list. The enrolment is a fact of the chain; when it happened is a nicety, and
 * losing a provider's answer about one block should not cost the organizer their
 * member list.
 */
export async function fetchElectionMembers(
  electionAddress: string,
  electionTitle: string,
): Promise<ChainMember[]> {
  const election = getElection(electionAddress);
  const events = await queryLogsFrom(election, election.filters.MemberEnrolled());

  const provider = getReadProvider();
  const times = new Map<number, Date | undefined>();
  await Promise.all(
    [...new Set(events.map(e => e.blockNumber))].map(async blockNumber => {
      try {
        const block = await provider.getBlock(blockNumber);
        times.set(blockNumber, block ? new Date(Number(block.timestamp) * 1000) : undefined);
      } catch {
        times.set(blockNumber, undefined);
      }
    }),
  );

  return events.map(e => {
    const args = eventArgs<{ identityCommitment: bigint; index: bigint }>(e);
    return {
      commitment: "0x" + args.identityCommitment.toString(16),
      index: Number(args.index),
      enrolledAt: times.get(e.blockNumber),
      electionId: electionAddress,
      electionTitle,
    };
  });
}
