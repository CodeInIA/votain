/**
 * Chain → UI mapping layer.
 *
 * Reads ElectionV4 state and converts it into the same `Election` shape the
 * Phase A screens already consume, so components stay presentation-only.
 */
import { getElection, getFactory } from "./contracts";
import { queryLogsFrom } from "./logs";
import { withDistinctNames } from "./ballotNames";
// The i18n singleton rather than the hook: this is a data layer, not a
// component. The labels below were hardcoded English and rendered that way in
// all thirteen locales. The tradeoff is that a language change does not
// retranslate an already-fetched election until it is refetched, which every
// navigation does.
import i18n from "../i18n/config";
import { getStoredCommitment, getStoredVoteNullifier } from "./semaphore";
import type { Candidate, Election, ElectionPhase, VotingType } from "../data/seed";
import { getVoterPersonhood } from "./voterSession";
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
    resultsPublished,
    metadataJson,
    policyHashOnChain,
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
    c.resultsPublished(),
    c.metadataJson(),
    c.eligibilityPolicyHash() as Promise<string>,
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
  const commitment = getStoredCommitment();
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
    ipfsCid,
    eligibilityPolicy,
    votingType: VOTING_TYPE_MAP[Number(votingType)] ?? "simple_plurality",
    thresholdValue: Number(thresholdValue),
    privacyQuorum: meta.privacyQuorum ?? (Number(thresholdValue) || 0),
    keyNonce: meta.keyNonce,
    isEnrolled,
    hasVoted,
    // The vote's anonymous on-chain identifier, shown to the voter as their own
    // receipt. Distinct from the transaction hash the history calls a reference.
    voteNullifier: hasVoted && votedNullifier !== null ? "0x" + votedNullifier.toString(16) : undefined,
    tags: meta.tags,
  };
}

/** Lists elections from the factory (newest first). */
export async function fetchElections(offset = 0, limit = 50): Promise<Election[]> {
  const factory = getFactory();
  const addressList = (await factory.getElections(offset, limit)) as string[];
  const elections = await Promise.all(addressList.map(fetchElection));
  return elections.reverse();
}

export interface ChainMember {
  commitment: string;
  index: number;
  enrolledAt?: Date;
  electionId: string;
  electionTitle: string;
}

/** Reads a single election's enrolled members from MemberEnrolled events. */
export async function fetchElectionMembers(
  electionAddress: string,
  electionTitle: string,
): Promise<ChainMember[]> {
  const election = getElection(electionAddress);
  const events = await queryLogsFrom(election, election.filters.MemberEnrolled());
  return Promise.all(
    events.map(async e => {
      const args = (e as unknown as { args: { identityCommitment: bigint; index: bigint } }).args;
      let enrolledAt: Date | undefined;
      try {
        const block = await e.getBlock();
        enrolledAt = block ? new Date(Number(block.timestamp) * 1000) : undefined;
      } catch {
        enrolledAt = undefined;
      }
      return {
        commitment: "0x" + args.identityCommitment.toString(16),
        index: Number(args.index),
        enrolledAt,
        electionId: electionAddress,
        electionTitle,
      };
    }),
  );
}
