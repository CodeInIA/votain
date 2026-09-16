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
  /** Its next deadline falls within a day, whatever that deadline is. */
  closingSoon: boolean;
  eligibility: EligibilityFilter;
}

export const EMPTY_FILTERS: ElectionFilterState = {
  query: '',
  phase: null,
  domainOnly: false,
  restrictedOnly: false,
  votingType: null,
  schedule: null,
  closingSoon: false,
  eligibility: {},
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
    filter.closingSoon ||
    isEligibilityFilterActive(filter.eligibility)
  );
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
  if (filter.closingSoon && !closingSoon(election)) return false;
  return matchesEligibilityFilter(election.eligibilityPolicy, filter.eligibility);
}
