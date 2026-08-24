/**
 * Chain → UI mapping layer.
 *
 * Reads ElectionV4 state and converts it into the same `Election` shape the
 * Phase A screens already consume, so components stay presentation-only.
 */
import { getElection, getFactory } from "./contracts";
import { queryLogsFrom } from "./logs";
import { getStoredCommitment, getStoredVoteNullifier } from "./semaphore";
import type { Candidate, Election, ElectionPhase, VotingType } from "../data/seed";

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
  ]);

  const meta = parseMetadata(metadataJson);

  const candidates: Candidate[] = (meta.candidates ?? []).map((cand, i) => ({
    id: `option-${i}`,
    name: cand.name,
    description: cand.description,
  }));
  candidates.push({ id: `option-${Number(numOptions)}`, name: "Blank Vote / Abstain" });

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
    candidates,
    eligibility: [
      { id: "platform", label: "World ID verified", status: commitment !== null ? "met" : "unknown" },
      { id: "enrolled", label: "Enrolled in this election", status: isEnrolled ? "met" : "not-met" },
    ],
    totalEnrolled: Number(memberCount),
    castVotes: Number(voteCount),
    ipfsCid,
    votingType: VOTING_TYPE_MAP[Number(votingType)] ?? "simple_plurality",
    privacyQuorum: meta.privacyQuorum ?? (Number(thresholdValue) || 0),
    keyNonce: meta.keyNonce,
    isEnrolled,
    hasVoted,
    // The vote's anonymous on-chain identifier (nullifier), shown as the receipt.
    referenceNumber: hasVoted && votedNullifier !== null ? "0x" + votedNullifier.toString(16) : undefined,
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
