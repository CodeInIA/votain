/**
 * What an election still owes its voters, in gas.
 *
 * WHY A NUMBER AND NOT A THRESHOLD. "Warn the organizer when the balance is
 * low" needs a definition of low, and a constant cannot have one: half a POL is
 * nothing for an election with two thousand voters and alarming for one with
 * three. The meaningful figure is the one the chain already publishes, which is
 * how many people enrolled and have not voted yet. Every one of them was told
 * their ballot would be paid for.
 *
 * WHY IT IS AN ESTIMATE, and says so. The real cost of a relay depends on the
 * gas price at the moment it is mined, which nobody knows in advance. This
 * multiplies the remaining voters by an observed average, so it is the right
 * order of magnitude and never an exact promise. Everything built on it is
 * phrased as "about".
 */
import type { Election } from '../data/seed';

/**
 * What a ballot costs is now MEASURED, not assumed, and so it is passed in.
 *
 * It used to be a constant here, which meant every figure on the site rested on
 * a number nobody had checked and that never moved when the gas price did. It
 * comes from `lib/voteCost.ts`, which divides past reimbursements by the gas
 * price they were paid at and reprices the result at today's.
 *
 * Re-exported so the screens have one import for the whole subject, and so the
 * fallback is reachable where a component has nothing better.
 */
export { VOTE_COST_FALLBACK } from './voteCost';

export interface FundingSplit {
  /** Moved inside the paymaster, from the organizer's free balance. */
  fromBalance: bigint;
  /** Sent with the transaction, because the balance did not cover it. */
  fromWallet: bigint;
}

/**
 * Where the gas for an election comes from, balance first.
 *
 * ONE RULE, FOUR CALLERS. It was worked out separately when funding an existing
 * election, when creating one, and in the two hints that tell the organizer what
 * is about to happen, which is four chances for the sentence on screen to
 * disagree with the transaction underneath it.
 *
 * The balance comes first because it is already inside the contract: sending new
 * value while a balance sits there would have the organizer topping up twice and
 * withdrawing the difference afterwards. The wallet is only asked for the
 * shortfall, which is what keeps the gas screen the single door money crosses.
 *
 * In wei, like the chain: floats from a form are converted by the caller, and
 * any rounding lands in the display rather than in the transfer.
 */
export function splitFunding(wanted: bigint, available: bigint): FundingSplit {
  const fromBalance = wanted < available ? wanted : available;
  return { fromBalance, fromWallet: wanted - fromBalance };
}

/** ETH as a decimal, in wei. For the hints, which start from a form field. */
export function toWei(amount: number): bigint {
  return BigInt(Math.round((Number.isFinite(amount) ? amount : 0) * 1e18));
}

/** Phases where a vote can still arrive, and therefore still has to be paid for. */
const CAN_STILL_COST_MONEY: Election['phase'][] = [
  'upcoming',
  'enrolling',
  'pending_vote',
  'active',
];

export function stillOpen(election: Election): boolean {
  return CAN_STILL_COST_MONEY.includes(election.phase);
}

export interface ElectionNeed {
  election: Election;
  /** Enrolled and not yet known to have voted. */
  remainingVoters: number;
  /** Roughly what those ballots will cost, in the chain's native token. */
  estimatedCost: number;
  /** Committed to this election and not withdrawable. */
  reserved: number;
  /** What the reserve does not cover, and the shared balance would have to. */
  shortfall: number;
}

/**
 * `distinctVoters` counts PEOPLE, not ballots, which is what makes it the right
 * figure here: a voter who changed their mind cast two ballots and is one person
 * who no longer needs paying for. `castVotes` would undercount who is left.
 *
 * While voting runs it is unknown, since re-votes cannot be told apart, so the
 * whole roll is counted: an estimate of gas still needed errs towards enough.
 */
export function remainingVoters(election: Election): number {
  const voted = election.distinctVoters ?? 0;
  return Math.max(0, election.totalEnrolled - voted);
}

export function electionNeed(
  election: Election,
  reserved: number,
  voteCost: number,
): ElectionNeed {
  const remaining = remainingVoters(election);
  const estimatedCost = remaining * voteCost;
  return {
    election,
    remainingVoters: remaining,
    estimatedCost,
    reserved,
    shortfall: Math.max(0, estimatedCost - reserved),
  };
}

/**
 * What the organizer's free balance is holding up across their open elections.
 *
 * Only the open ones: a closed election cannot take another vote, so whatever is
 * still reserved for it is already on its way back and owes nobody anything.
 */
export function openNeeds(
  elections: Election[],
  reservedFor: (election: Election) => number,
  voteCost: number,
): ElectionNeed[] {
  return elections.filter(stillOpen).map(e => electionNeed(e, reservedFor(e), voteCost));
}

export function totalShortfall(needs: ElectionNeed[]): number {
  return needs.reduce((sum, need) => sum + need.shortfall, 0);
}

/**
 * Whether one election can pay for the ballot someone is about to cast.
 *
 * Deliberately asks about ONE vote and not about all of them. A voter deciding
 * whether to enrol is not owed a guarantee that everyone else can vote too, and
 * refusing them because the election is underfunded in aggregate would turn a
 * warning into a lockout. What must never happen is letting someone spend two
 * minutes on a proof that cannot be relayed.
 */
export function canFundOneVote(
  reserved: number,
  organizerFree: number,
  voteCost: number,
): boolean {
  return reserved + organizerFree >= voteCost;
}

/**
 * How the funding of one election should read to a voter.
 *
 * `guaranteed` counts only the reserve, because only the reserve cannot be
 * withdrawn from under them. The shared balance is real money that will be spent
 * if needed, and it is also money the organizer may take back at any moment, so
 * it is never counted as a promise.
 */
export interface FundingVerdict {
  /** Ballots the reserve alone covers. */
  guaranteed: number;
  /** Ballots the reserve plus the organizer's free balance covers. */
  possible: number;
  /** Nothing can be relayed right now. */
  unfunded: boolean;
  /** Enough for some, but not for everyone still expected to vote. */
  short: boolean;
}

export function fundingVerdict(
  election: Election,
  reserved: number,
  organizerFree: number,
  voteCost: number,
): FundingVerdict {
  const guaranteed = Math.floor(reserved / voteCost);
  const possible = Math.floor((reserved + organizerFree) / voteCost);
  return {
    guaranteed,
    possible,
    unfunded: !canFundOneVote(reserved, organizerFree, voteCost),
    short: possible < remainingVoters(election),
  };
}
