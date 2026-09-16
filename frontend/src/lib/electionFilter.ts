/**
 * One matching rule for every election list.
 *
 * Discover and the organizer dashboard show different sets of elections but
 * offer the same filters, so they must agree on what each filter MEANS. Keeping
 * the predicate here rather than in each page is what stops "restricted" or
 * "verified domain" quietly meaning something different depending on where you
 * are standing.
 */
import { matchesEligibilityFilter, isEligibilityFilterActive, type EligibilityFilter } from './eligibilityFilter';
import { type Election, type ElectionPhase, type VotingType } from '../data/seed';
import { closingSoon } from './phase';
import { DEFAULT_SORT, type ElectionSort } from './electionSort';
import { isEmptyPolicy } from './eligibility';

/**
 * Every phase an election on chain can be in, in the order it passes through
 * them, with the two that end it early at the end.
 *
 * All of them, where this used to offer four on the grounds that "draft and
 * terminal states are not useful filters". UPCOMING is what a voter plans
 * around, PENDING_VOTE is a state they are left sitting in, and cancelled and
 * voided are exactly what someone auditing a platform comes looking for. The
 * panel wraps and is collapsed by default, so the cost of a chip is small and
 * the cost of a missing one is a question that cannot be asked.
 */
export const PHASE_FILTERS: ElectionPhase[] = [
  'upcoming',
  'enrolling',
  'pending_vote',
  'active',
  'tallying',
  'closed',
  'voided',
  'cancelled',
];

export interface ElectionFilterState {
  query: string;
  phase: ElectionPhase | null;
  domainOnly: boolean;
  /**
   * Only elections that restrict who may enrol.
   *
   * Distinct from the age and nationality inputs beside it: those ask "would I
   * qualify", and an unrestricted election satisfies them trivially, so it
   * matches every value. This asks the other question, "which of these have
   * requirements at all", which no combination of the inputs can express.
   */
  restrictedOnly: boolean;
  /**
   * How the election is decided. A single choice rather than a set: the four
   * rules are alternatives, and someone narrowing by rule is looking for one of
   * them, the same way they narrow by phase.
   */
  votingType: VotingType | null;
  /**
   * Whether the organizer can still move the deadlines.
   *
   * Three states and not a toggle, because both answers are worth searching
   * for. Someone choosing where to take part wants the elections that cannot be
   * cut short; someone auditing the platform wants exactly the opposite. An
   * election that predates the flag matches neither, since it did not make the
   * promise and did not decline it.
   */
  schedule: 'fixed' | 'movable' | null;
  /**
   * Whether the organizer kept the power to call the election off.
   *
   * THREE STATES, LIKE THE ONE ABOVE, which it was not at first. It was a
   * single toggle for the promise only, on the grounds that keeping the power
   * is the default and a chip for it would collect almost the whole list.
   * That is equally true of movable dates, which get their own chip, so the
   * two controls were answering the same shape of question in two different
   * shapes for no reason a reader could see.
   *
   * Both answers are worth asking for: one to find the elections that cannot
   * be stopped, the other to audit the ones that can. An election from before
   * the flag matches neither.
   */
  cancel: 'no_cancel' | 'can_cancel' | null;
  /**
   * Created no earlier than this moment, as 'yyyy-mm-ddThh:mm' local, or empty.
   *
   * SEPARATE FROM EVERY OTHER DATE HERE, which is why it is worth a control.
   * An election announced today for next March and one deployed last March
   * that opens tomorrow are a year apart in age and adjacent in every date a
   * list shows. It is also the only date the organizer did not choose, so it
   * is the one worth narrowing by when the question is "what appeared
   * recently" rather than "what is happening soon".
   */
  createdFrom: string;
  /** Created no later than the END of this minute. See `matchesCreated`. */
  createdTo: string;
  /** Its next deadline falls within a day, whatever that deadline is. */
  closingSoon: boolean;
  eligibility: EligibilityFilter;
  /**
   * The order, which is not a filter and lives here anyway.
   *
   * It hides nothing, so `matchesElectionFilter` never reads it and
   * `isAnyFilterActive` never counts it: an order is not a reason to show the
   * dot that warns a list is being narrowed. It sits in this object because it
   * is the same control panel, the same "clear" button and the same key the
   * pager resets on, and a second piece of state threaded through both pages
   * to say one word would be the worse trade.
   */
  sort: ElectionSort;
  /**
   * Only the elections this voter has already cast a ballot in.
   *
   * A BOOLEAN BESIDE THE PHASE, not one of its values, because it is not one:
   * `voted` describes the reader, not the election, and an election is
   * `active` whether or not they have voted in it. It used to be a tab called
   * "Voted" sitting in a row of phases, which made a personal state look like
   * a stage of the contract and left the two impossible to combine.
   */
  votedOnly: boolean;
}

export const EMPTY_FILTERS: ElectionFilterState = {
  query: '',
  phase: null,
  domainOnly: false,
  restrictedOnly: false,
  votingType: null,
  schedule: null,
  cancel: null,
  createdFrom: '',
  createdTo: '',
  closingSoon: false,
  eligibility: {},
  sort: DEFAULT_SORT,
  votedOnly: false,
};

/**
 * Whether anything is narrowing the list.
 *
 * Drives the dot on the collapsed filter bar, and the "clear filters" link:
 * both need to account for every filter, not the two or three easiest to name.
 */
export function isAnyFilterActive(filter: ElectionFilterState): boolean {
  return (
    Boolean(filter.phase) ||
    filter.domainOnly ||
    filter.restrictedOnly ||
    Boolean(filter.votingType) ||
    Boolean(filter.schedule) ||
    Boolean(filter.cancel) ||
    isCreatedFilterActive(filter) ||
    filter.closingSoon ||
    filter.votedOnly ||
    isEligibilityFilterActive(filter.eligibility)
  );
}

/**
 * Whether "clear" has anything to undo.
 *
 * WIDER THAN `isAnyFilterActive`, and the difference is why both exist. That
 * one answers "is the list being narrowed", which drives the dot warning that
 * elections are hidden, and an order hides nothing so it must stay out of it.
 * This answers "is anything not as it started", which is what the button
 * resets: the search box and the order both belong in that and neither is a
 * filter.
 */
export function isAnythingToClear(filter: ElectionFilterState): boolean {
  return isAnyFilterActive(filter) || filter.query !== '' || filter.sort !== DEFAULT_SORT;
}

/** Whether either end of the creation range is set. */
export function isCreatedFilterActive(filter: ElectionFilterState): boolean {
  return Boolean(filter.createdFrom || filter.createdTo);
}

/** One minute, for running an upper bound to the end of the one that was picked. */
const MINUTE_MS = 60_000;

/**
 * 'yyyy-mm-ddThh:mm' is local time by specification, which is what the picker
 * gives. A bare 'yyyy-mm-dd' is still read, as midnight, so a range saved
 * before the controls offered a time keeps working.
 */
function parseLocal(value: string): number | null {
  if (!value) return null;
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm] = timePart ? timePart.split(':').map(Number) : [0, 0];
  const at = new Date(y, m - 1, d, hh || 0, mm || 0).getTime();
  return Number.isNaN(at) ? null : at;
}

/**
 * Whether the election was created inside the range asked for.
 *
 * THE UPPER BOUND RUNS TO THE END OF ITS MINUTE, the same rule and the same
 * reason as the gas history. Someone who puts the same moment at both ends is
 * asking for that moment, and compared against its start that is an empty
 * window: the honest-looking answer to a reasonable question would be "no
 * elections".
 *
 * AN ELECTION WITH NO CREATION DATE IS DROPPED, not kept. It was deployed
 * before the chain recorded one, so it cannot be placed in time and no range
 * can honestly claim it. Keeping it would put an election of unknown age
 * inside "created this week", which is the one claim this filter exists to
 * make reliably.
 */
function matchesCreated(election: Election, filter: ElectionFilterState): boolean {
  const from = parseLocal(filter.createdFrom);
  const to = parseLocal(filter.createdTo);
  if (from === null && to === null) return true;
  if (!election.createdAt) return false;

  const at = election.createdAt.getTime();
  if (from !== null && at < from) return false;
  if (to !== null && at >= to + MINUTE_MS) return false;
  return true;
}

/**
 * An election restricts enrolment when it asks anything of the voter beyond
 * being signed in. Through the shared predicate rather than a second copy of
 * the rule: demanding a document is a restriction even with no attribute rules
 * attached, and a filter that disagreed with the badge on the same card would
 * hide elections it was visibly labelling as restricted.
 */
function isRestricted(election: Election): boolean {
  return !isEmptyPolicy(election.eligibilityPolicy);
}

/**
 * Free-text search covers the title, the organizer's display name and the
 * domain, so typing "gob.es" finds the elections published under it and typing
 * an organizer's name finds theirs.
 */
export function matchesQuery(election: Election, needle: string): boolean {
  if (!needle) return true;
  return (
    election.title.toLowerCase().includes(needle) ||
    election.organizer.toLowerCase().includes(needle) ||
    (election.organizerDomain?.toLowerCase().includes(needle) ?? false)
  );
}

export function matchesElectionFilter(
  election: Election,
  filter: ElectionFilterState,
  /** Live DNS answer, from `useVerifiedDomains`. */
  isDomainVerified: (e: Election) => boolean,
): boolean {
  if (filter.phase && election.phase !== filter.phase) return false;
  if (filter.votedOnly && !election.hasVoted) return false;
  if (!matchesQuery(election, filter.query.trim().toLowerCase())) return false;
  if (filter.domainOnly && !isDomainVerified(election)) return false;
  if (filter.restrictedOnly && !isRestricted(election)) return false;
  if (filter.votingType && election.votingType !== filter.votingType) return false;
  // Compared against `true` and `false` rather than truthiness: an election
  // deployed before the flag existed carries `undefined`, and it belongs in
  // neither answer.
  if (filter.schedule === 'fixed' && election.fixedSchedule !== true) return false;
  if (filter.schedule === 'movable' && election.fixedSchedule !== false) return false;
  // Again compared against the two booleans and not truthiness: an election
  // from before the flag carries `undefined` and answered neither way.
  if (filter.cancel === 'no_cancel' && election.cancellable !== false) return false;
  if (filter.cancel === 'can_cancel' && election.cancellable !== true) return false;
  if (!matchesCreated(election, filter)) return false;
  if (filter.closingSoon && !closingSoon(election)) return false;
  return matchesEligibilityFilter(election.eligibilityPolicy, filter.eligibility);
}
