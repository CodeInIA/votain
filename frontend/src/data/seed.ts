import type { EligibilityPolicy, PersonhoodLevel } from '../lib/eligibility';

export type ElectionPhase =
  | 'upcoming'       // deployed, enrollment not yet open
  | 'enrolling'
  | 'enrolled'
  | 'pending_vote'   // enrollment closed, voting not yet open (separate window w/ gap)
  | 'active'
  | 'voted'
  | 'tallying'
  | 'closed'
  | 'voided'
  | 'cancelled';

export type VotingType =
  | 'simple_plurality'
  | 'absolute_majority'
  | 'two_thirds'
  | 'witness_threshold';

export interface Candidate {
  id: string;
  name: string;
  description?: string;
  votes?: number;
  isWinner?: boolean;
  isTie?: boolean;
}

export interface EligibilityCriteria {
  id: string;
  label: string;
  status: 'met' | 'not-met' | 'unknown';
  description?: string;
}

export interface VoteRecord {
  electionId: string;
  electionTitle: string;
  candidateName: string;
  phase: ElectionPhase;
  date: Date;
  referenceNumber: string;
  nullifier: string;
}

/**
 * Whether an election's results are actually readable.
 *
 * Keyed on the tally being present, NOT on `ipfsCid`. That CID is the audit
 * trail of a tally pinned to IPFS and is empty whenever the organizer ran the
 * count in the app, which is the normal path (see `lib/organizer.ts`). Gating on
 * it made the public and voter views claim results were unavailable for a closed
 * election whose totals were sitting on chain, while the organizer's own view,
 * which tested the tally, showed them.
 *
 * One function so the three views cannot drift apart again.
 */
/**
 * The number a published result is a share OF.
 *
 * THE SUM OF THE COUNTERS, never `castVotes`. Those two are different figures
 * and the difference is the feature this system is proudest of: a voter who is
 * coerced can vote again, the later ballot replaces the earlier one, and
 * `castVotes` counts BOTH while the tally counts one. Divide by the wrong one
 * and every candidate's share shrinks by however many people changed their
 * mind, which is exactly when a result is most worth reading correctly.
 *
 * It was wrong in two of the four places that draw the same bar chart: an
 * election with one voter who voted twice read 100% on the organizer's screen
 * and 50% on the voter's, for the same single vote. One function now, so the
 * four cannot disagree again.
 */
export function tallyTotal(election: { candidates: Candidate[] }): number {
  return election.candidates.reduce((sum, c) => sum + (c.votes ?? 0), 0);
}

export function hasPublishedResults(election: {
  phase: ElectionPhase;
  candidates?: Candidate[];
  /** Read straight off the contract, for callers that hold no ballot. */
  resultsPublished?: boolean;
}): boolean {
  if (election.phase !== "closed") return false;
  // Two ways of knowing the same thing, and the rule stays in one place.
  // A fully read election carries the tally on its options; a digest, which
  // exists precisely so screens need not read the tally, carries the flag the
  // contract sets when results are published. Closed is necessary and never
  // sufficient: an election can be closed with nothing published yet.
  return election.resultsPublished ?? election.candidates?.some(c => c.votes !== undefined) ?? false;
}

export interface Election {
  id: string;
  title: string;
  description: string;
  phase: ElectionPhase;
  organizer: string;
  organizerAddress: string;
  /** Domain the organizer had verified when this election was created. The
   *  badge re-checks it live, so a lapsed one shows struck through. */
  organizerDomain?: string;
  enrollStart: Date;
  enrollEnd: Date;
  voteStart: Date;
  voteEnd: Date;
  candidates: Candidate[];
  eligibility: EligibilityCriteria[];
  /** How distinct a human the election insists the voter is, taken from the
   *  hash-committed policy. */
  personhood?: PersonhoodLevel;
  /** True when that level is `orb`. Kept for the views that only ask that. */
  requiresOrb?: boolean;
  totalEnrolled: number;
  /** Ballots on chain, re-votes included. Not the number of people. */
  castVotes: number;
  /** People who voted at least once. What a published tally has to add up to. */
  distinctVoters?: number;
  /**
   * The public half of verifying a published result.
   *
   * Present only once results are published. Needs no decryption key: it
   * compares the counters the organizer published against the number of voters
   * the contract counted, which anyone can read. It catches invented or dropped
   * ballots. It cannot catch votes moved between options, since that keeps the
   * total intact.
   */
  tallyCheck?: { declared: number; voters: number; matches: boolean };
  contractAddress: string;
  ipfsCid?: string;
  /** Attribute restrictions on enrolment, verified against the contract's hash. */
  eligibilityPolicy?: EligibilityPolicy;
  votingType: VotingType;
  /**
   * Yes votes needed to approve, and only meaningful for `witness_threshold`.
   * Distinct from `privacyQuorum`, which is how many ballots must exist before
   * a result may be revealed at all.
   */
  thresholdValue?: number;
  privacyQuorum: number;
  /**
   * The organizer gave up the power to move any deadline.
   *
   * Undefined for seed elections and for anything deployed before the flag
   * existed, which is not the same as false and is shown as neither.
   */
  fixedSchedule?: boolean;
  /**
   * The organizer may call this election off.
   *
   * A promise apart from the dates: an election can keep its schedule and still
   * be stopped, or run to the end whatever happens. Undefined for seed elections
   * and anything deployed before the flag, which is not the same as false.
   */
  cancellable?: boolean;
  /**
   * When the election was deployed, from the chain's own clock.
   *
   * NOT ANY DATE IN THE SCHEDULE. An election announced today for next March
   * and one deployed last March that opens tomorrow are a year apart in age
   * and adjacent in every date the lists show. It is also the only date here
   * the organizer did not choose: every other one came out of the wizard and
   * can be set to anything, this one is written by the chain.
   *
   * Undefined for seed elections and anything deployed before the immutable
   * existed, like the two promises above.
   */
  createdAt?: Date;
  /** Public per-election salt for deriving the tally key from the organizer's
   *  wallet signature. Present only on elections whose key is re-derivable
   *  (not stored). */
  keyNonce?: string;
  isEnrolled?: boolean;
  hasVoted?: boolean;
  userVote?: string;
  /**
   * The vote's anonymous on-chain identifier, as `0x` hex.
   *
   * Named for what it is. It used to be called `referenceNumber`, which is also
   * what the history and the confirmation screen call a TRANSACTION HASH, so
   * one name meant two different values and either could be handed to the
   * verifier expecting the other to work.
   */
  voteNullifier?: string;
  tags?: string[];
}

const now = new Date();
const past  = (d: number) => new Date(now.getTime() - d * 86_400_000);
const future = (d: number) => new Date(now.getTime() + d * 86_400_000);

export const ELECTIONS: Election[] = [
  {
    id: 'e1',
    title: 'Madrid City Council - District 5 Representative',
    description:
      'Elect the representative for District 5 (Carabanchel) to the Madrid City Council for the 2025–2029 term. All verified residents aged 18+ are eligible.',
    phase: 'active',
    organizer: 'Madrid Municipal Authority',
    organizerAddress: '0xOrg1aaa',
    enrollStart: past(10),
    enrollEnd: past(3),
    voteStart: past(3),
    voteEnd: future(1),
    votingType: 'simple_plurality',
    privacyQuorum: 10,
    totalEnrolled: 4218,
    castVotes: 2841,
    contractAddress: '0xCon1aaa',
    isEnrolled: true,
    hasVoted: false,
    tags: ['government', 'local'],
    candidates: [
      { id: 'c1', name: 'Ana García López',    description: 'Progressive Alliance candidate, urban mobility specialist' },
      { id: 'c2', name: 'Carlos Martínez Ruiz', description: 'People\'s Party candidate, former district manager' },
      { id: 'c3', name: 'Sofía Herrera Vega',  description: 'Green Coalition candidate, environmental engineer' },
      { id: 'c4', name: 'Blank Vote / Abstain', description: '' },
    ],
    eligibility: [
      { id: 'age',     label: 'Age ≥ 18 years',    status: 'met' },
      { id: 'residency', label: 'Madrid residency', status: 'met' },
      { id: 'district', label: 'District 5 resident', status: 'met' },
    ],
  },
  {
    id: 'e2',
    title: 'University of Barcelona - Student Union Elections 2025',
    description:
      'Annual election for the student union board. All enrolled students at UB are eligible to vote.',
    phase: 'enrolling',
    organizer: 'Universidad de Barcelona',
    organizerAddress: '0xOrg2bbb',
    enrollStart: past(2),
    enrollEnd: future(5),
    voteStart: future(5),
    voteEnd: future(12),
    votingType: 'absolute_majority',
    privacyQuorum: 5,
    totalEnrolled: 312,
    castVotes: 0,
    contractAddress: '0xCon2bbb',
    isEnrolled: false,
    hasVoted: false,
    tags: ['university', 'student'],
    candidates: [
      { id: 'c5', name: 'Pau Soler Camps',       description: 'Engineering faculty representative' },
      { id: 'c6', name: 'Marta Ibáñez Puig',     description: 'Humanities faculty representative' },
      { id: 'c7', name: 'Diego Romero Nieto',    description: 'Sciences faculty representative' },
      { id: 'c8', name: 'Blank Vote / Abstain',  description: '' },
    ],
    eligibility: [
      { id: 'enrolled', label: 'Enrolled student at UB', status: 'met' },
      { id: 'orb',      label: 'Orb verification',       status: 'unknown', description: 'Requires biometric scan at a World ID orb.' },
    ],
  },
  {
    id: 'e3',
    title: 'Catalonia Residents Advisory - Infrastructure Priorities',
    description:
      'Advisory vote on infrastructure investment priorities for the 2025–2030 period. Orb-verified Catalonia residents only.',
    phase: 'tallying',
    organizer: 'Generalitat de Catalunya',
    organizerAddress: '0xOrg3ccc',
    enrollStart: past(20),
    enrollEnd: past(7),
    voteStart: past(7),
    voteEnd: past(1),
    votingType: 'simple_plurality',
    privacyQuorum: 15,
    totalEnrolled: 18742,
    castVotes: 14209,
    contractAddress: '0xCon3ccc',
    isEnrolled: true,
    hasVoted: true,
    userVote: 'c10',
    voteNullifier: 'VTN-2025-003841',
    tags: ['government', 'regional', 'infrastructure'],
    candidates: [
      { id: 'c9',  name: 'High-speed rail expansion',  description: 'Connect all towns >5k pop. by 2030' },
      { id: 'c10', name: 'Renewable energy grid',      description: 'Solar + wind infrastructure in rural areas' },
      { id: 'c11', name: 'Coastal flood defences',     description: 'Climate resilience infrastructure' },
      { id: 'c12', name: 'Digital broadband rollout',  description: 'Fibre to all municipalities by 2027' },
      { id: 'c13', name: 'Blank Vote / Abstain',       description: '' },
    ],
    eligibility: [
      { id: 'residency', label: 'Catalonia residency', status: 'met' },
      { id: 'orb',       label: 'Orb verification',    status: 'met' },
    ],
  },
  {
    id: 'e4',
    title: 'Bilbao Neighbourhood Association - Annual Board',
    description:
      'Election of the Ategorrieta-Uribarri neighbourhood association board members for the 2025 term.',
    phase: 'closed',
    organizer: 'Bilbao City Council',
    organizerAddress: '0xOrg4ddd',
    enrollStart: past(35),
    enrollEnd: past(21),
    voteStart: past(21),
    voteEnd: past(14),
    votingType: 'simple_plurality',
    privacyQuorum: 5,
    totalEnrolled: 587,
    castVotes: 421,
    contractAddress: '0xCon4ddd',
    ipfsCid: 'QmResult4ddd',
    isEnrolled: true,
    hasVoted: true,
    userVote: 'c15',
    voteNullifier: 'VTN-2025-001122',
    tags: ['neighbourhood', 'local'],
    candidates: [
      { id: 'c14', name: 'Itziar Zubicaray',  description: 'Incumbent president', votes: 198, isWinner: true },
      { id: 'c15', name: 'Eneko Larrañaga',   description: 'First-time candidate',  votes: 142 },
      { id: 'c16', name: 'Ainhoa Etxeberria', description: 'Youth representative',  votes: 67 },
      { id: 'c17', name: 'Blank Vote',         description: '',                      votes: 14 },
    ],
    eligibility: [
      { id: 'residency', label: 'Bilbao residency', status: 'met' },
      { id: 'orb',       label: 'Orb verification', status: 'met' },
    ],
  },
  {
    id: 'e5',
    title: 'Seville Tech Hub - Co-founder Vote 2025',
    description:
      'Internal vote to select co-founders for the new Seville Tech Hub cooperative. Member witnesses required.',
    phase: 'voided',
    organizer: 'Seville Tech Hub Collective',
    organizerAddress: '0xOrg5eee',
    enrollStart: past(50),
    enrollEnd: past(43),
    voteStart: past(43),
    voteEnd: past(36),
    votingType: 'witness_threshold',
    privacyQuorum: 20,
    totalEnrolled: 23,
    castVotes: 4,
    contractAddress: '0xCon5eee',
    tags: ['cooperative', 'tech'],
    candidates: [
      { id: 'c18', name: 'Candidate A' },
      { id: 'c19', name: 'Candidate B' },
    ],
    eligibility: [
      { id: 'member', label: 'Collective member', status: 'met' },
    ],
  },
  {
    id: 'e6',
    title: 'Valencia Green Party - Internal Primary',
    description:
      'Internal primary to choose the Valencia Green Party candidate for the 2026 regional elections.',
    phase: 'cancelled',
    organizer: 'Valencia Green Party',
    organizerAddress: '0xOrg6fff',
    enrollStart: past(15),
    enrollEnd: future(2),
    voteStart: future(2),
    voteEnd: future(9),
    votingType: 'two_thirds',
    privacyQuorum: 10,
    totalEnrolled: 0,
    castVotes: 0,
    contractAddress: '0xCon6fff',
    tags: ['party', 'primary'],
    candidates: [
      { id: 'c20', name: 'Lucía Fernández' },
      { id: 'c21', name: 'Jordi Palau' },
    ],
    eligibility: [
      { id: 'party', label: 'Party member', status: 'met' },
    ],
  },
];

export const VOTER_HISTORY: VoteRecord[] = [
  {
    electionId: 'e3',
    electionTitle: 'Catalonia Residents Advisory - Infrastructure Priorities',
    candidateName: 'Renewable energy grid',
    phase: 'tallying',
    date: past(3),
    referenceNumber: 'VTN-2025-003841',
    nullifier: '0x1234…abcd',
  },
  {
    electionId: 'e4',
    electionTitle: 'Bilbao Neighbourhood Association - Annual Board',
    candidateName: 'Eneko Larrañaga',
    phase: 'closed',
    date: past(18),
    referenceNumber: 'VTN-2025-001122',
    nullifier: '0x5678…ef01',
  },
];

export function getElection(id: string): Election | undefined {
  return ELECTIONS.find(e => e.id === id);
}

export function getElectionsByPhase(phase: ElectionPhase): Election[] {
  return ELECTIONS.filter(e => e.phase === phase);
}
