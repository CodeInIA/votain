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
   * Only elections the organizer gave up the power to call off.
   *
   * A toggle where the one above has three states, and for the same reason the
   * verified-domain chip is a toggle: keeping the power to cancel is the
   * default every election has ever been created with, so a chip for it would
   * collect almost the whole list and read as a category of suspicion. The
   * promise is the rare thing, and the rare thing is what is worth searching
   * for.
   */
  noCancel: boolean;
  /**
   * Created no earlier than this day, as 'yyyy-mm-dd' local, or empty.
   *
   * SEPARATE FROM EVERY OTHER DATE HERE, which is why it is worth a control.
   * An election announced today for next March and one deployed last March
   * that opens tomorrow are a year apart in age and adjacent in every date a
   * list shows. It is also the only date the organizer did not choose, so it
   * is the one worth narrowing by when the question is "what appeared
   * recently" rather than "what is happening soon".
   */
  createdFrom: string;
  /** Created no later than the END of this day. See `matchesElectionFilter`. */
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
}

export const EMPTY_FILTERS: ElectionFilterState = {
  query: '',
  phase: null,
  domainOnly: false,
  restrictedOnly: false,
  votingType: null,
  schedule: null,
  noCancel: false,
  createdFrom: '',
  createdTo: '',
  closingSoon: false,
  eligibility: {},
  sort: DEFAULT_SORT,
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
    filter.noCancel ||
    isCreatedFilterActive(filter) ||
    filter.closingSoon ||
    isEligibilityFilterActive(filter.eligibility)
  );
}

/** Whether either end of the creation range is set. */
export function isCreatedFilterActive(filter: ElectionFilterState): boolean {
  return Boolean(filter.createdFrom || filter.createdTo);
}

/** A whole day, for running an upper bound to the end of the one that was picked. */
const DAY_MS = 86_400_000;

/** 'yyyy-mm-dd' is local time by specification, which is what the picker gives. */
function parseLocalDay(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  const at = new Date(y, m - 1, d).getTime();
  return Number.isNaN(at) ? null : at;
}

/**
 * Whether the election was created inside the range asked for.
 *
 * THE UPPER BOUND RUNS TO THE END OF ITS DAY, the same rule the gas history
 * settled on for minutes. Someone who puts the same day at both ends is asking
 * for that day, and compared against midnight at its start that is an empty
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
  const from = parseLocalDay(filter.createdFrom);
  const to = parseLocalDay(filter.createdTo);
  if (from === null && to === null) return true;
  if (!election.createdAt) return false;

  const at = election.createdAt.getTime();
  if (from !== null && at < from) return false;
  if (to !== null && at >= to + DAY_MS) return false;
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
function matchesQuery(election: Election, needle: string): boolean {
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
  if (!matchesQuery(election, filter.query.trim().toLowerCase())) return false;
  if (filter.domainOnly && !isDomainVerified(election)) return false;
  if (filter.restrictedOnly && !isRestricted(election)) return false;
  if (filter.votingType && election.votingType !== filter.votingType) return false;
  // Compared against `true` and `false` rather than truthiness: an election
  // deployed before the flag existed carries `undefined`, and it belongs in
  // neither answer.
  if (filter.schedule === 'fixed' && election.fixedSchedule !== true) return false;
  if (filter.schedule === 'movable' && election.fixedSchedule !== false) return false;
  // Again `=== false` and not `!`: an election from before the flag carries
  // `undefined`, and it never made this promise either.
  if (filter.noCancel && election.cancellable !== false) return false;
  if (!matchesCreated(election, filter)) return false;
  if (filter.closingSoon && !closingSoon(election)) return false;
  return matchesEligibilityFilter(election.eligibilityPolicy, filter.eligibility);
}
