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
import { type Election, type ElectionPhase } from '../data/seed';
import { isEmptyPolicy } from './eligibility';

/** Phases worth offering as a chip. Draft and terminal states are not useful filters. */
export const PHASE_FILTERS: ElectionPhase[] = ['enrolling', 'active', 'tallying', 'closed'];

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
  eligibility: EligibilityFilter;
}

export const EMPTY_FILTERS: ElectionFilterState = {
  query: '',
  phase: null,
  domainOnly: false,
  restrictedOnly: false,
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
  return matchesEligibilityFilter(election.eligibilityPolicy, filter.eligibility);
}
