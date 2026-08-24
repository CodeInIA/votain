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
  totalEnrolled: number;
  castVotes: number;
  contractAddress: string;
  ipfsCid?: string;
  votingType: VotingType;
  privacyQuorum: number;
  /** Public per-election salt for deriving the tally key from the organizer's
   *  passkey. Present only on elections whose key is re-derivable (not stored). */
  keyNonce?: string;
  isEnrolled?: boolean;
  hasVoted?: boolean;
  userVote?: string;
  referenceNumber?: string;
  tags?: string[];
}

const now = new Date();
const past  = (d: number) => new Date(now.getTime() - d * 86_400_000);
const future = (d: number) => new Date(now.getTime() + d * 86_400_000);

export const ELECTIONS: Election[] = [
  {
    id: 'e1',
    title: 'Madrid City Council — District 5 Representative',
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
    title: 'University of Barcelona — Student Union Elections 2025',
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
    title: 'Catalonia Residents Advisory — Infrastructure Priorities',
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
    referenceNumber: 'VTN-2025-003841',
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
    title: 'Bilbao Neighbourhood Association — Annual Board',
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
    referenceNumber: 'VTN-2025-001122',
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
    title: 'Seville Tech Hub — Co-founder Vote 2025',
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
    title: 'Valencia Green Party — Internal Primary',
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
    electionTitle: 'Catalonia Residents Advisory — Infrastructure Priorities',
    candidateName: 'Renewable energy grid',
    phase: 'tallying',
    date: past(3),
    referenceNumber: 'VTN-2025-003841',
    nullifier: '0x1234…abcd',
  },
  {
    electionId: 'e4',
    electionTitle: 'Bilbao Neighbourhood Association — Annual Board',
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
