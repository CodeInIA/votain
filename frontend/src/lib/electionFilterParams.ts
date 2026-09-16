/**
 * The filter state, written into the address bar and read back out.
 *
 * WHY THE URL AND NOT SOMEWHERE ELSE. Filters used to live in component
 * state, so opening an election and pressing back came home to an unfiltered
 * list: the page had been unmounted and remounted, and nothing had ever
 * recorded what the reader was looking for. Session storage would fix that
 * one trip and break another, because then the navigation link to Discover
 * would also restore a filter from twenty minutes ago and the list would look
 * broken with no visible cause.
 *
 * The address bar has neither problem. Back restores the query with the page,
 * a fresh link has no query and no filters, a reload keeps what was on
 * screen, and a filtered list becomes something that can be sent to someone
 * else, which is worth having on a page whose whole job is finding elections.
 *
 * ONLY WHAT IS SET IS WRITTEN. An untouched list has a clean URL, and every
 * value that equals the default is left out rather than spelled out, so the
 * query says what the reader chose rather than restating the form.
 *
 * NOTHING IS TRUSTED ON THE WAY IN. A URL is typed, edited, truncated and
 * shared, so every value is checked against what the app accepts and anything
 * else is dropped back to its default. A filter nobody can name is better
 * than a page that renders an error over a bad query string.
 */
import { EMPTY_FILTERS, PHASE_FILTERS, type ElectionFilterState } from './electionFilter';
import { DEFAULT_SORT, SORT_OPTIONS, type ElectionSort } from './electionSort';
import { PERSONHOOD_LEVELS, type PersonhoodLevel } from './eligibility';
import { VOTING_TYPES } from './votingTypes';
import type { ElectionPhase, VotingType } from '../data/seed';

/**
 * Short names, because they are read by people in a link.
 *
 * Kept in one object so the writer and the reader cannot disagree about a
 * spelling, which is the only way a round trip can silently lose a filter.
 */
const KEY = {
  query: 'q',
  phase: 'phase',
  domainOnly: 'domain',
  restrictedOnly: 'restricted',
  votingType: 'rule',
  schedule: 'dates',
  cancel: 'cancel',
  noCancelLegacy: 'nocancel',
  createdFrom: 'from',
  createdTo: 'to',
  closingSoon: 'soon',
  enrolledOnly: 'enrolled',
  votedOnly: 'voted',
  canVoteNow: 'canvote',
  savedOnly: 'saved',
  sort: 'sort',
  minAgeFrom: 'age_from',
  minAgeTo: 'age_to',
  nationality: 'nat',
  personhood: 'who',
} as const;

/** Only ever `1`, so the absence of the key is the only other state. */
const ON = '1';

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** A whole number within the bounds an age control can mean, or undefined. */
function age(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 120 ? n : undefined;
}

export function filterToSearchParams(filter: ElectionFilterState): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string | undefined | null) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  };

  set(KEY.query, filter.query.trim());
  set(KEY.phase, filter.phase);
  if (filter.domainOnly) set(KEY.domainOnly, ON);
  if (filter.restrictedOnly) set(KEY.restrictedOnly, ON);
  set(KEY.votingType, filter.votingType);
  set(KEY.schedule, filter.schedule);
  set(KEY.cancel, filter.cancel);
  set(KEY.createdFrom, filter.createdFrom);
  set(KEY.createdTo, filter.createdTo);
  if (filter.closingSoon) set(KEY.closingSoon, ON);
  if (filter.enrolledOnly) set(KEY.enrolledOnly, ON);
  if (filter.votedOnly) set(KEY.votedOnly, ON);
  if (filter.canVoteNow) set(KEY.canVoteNow, ON);
  if (filter.savedOnly) set(KEY.savedOnly, ON);
  // The default order is the absence of the key, like every other default.
  if (filter.sort !== DEFAULT_SORT) set(KEY.sort, filter.sort);

  const { minAgeFrom, minAgeTo, nationality, personhood } = filter.eligibility;
  set(KEY.minAgeFrom, minAgeFrom === undefined ? null : String(minAgeFrom));
  set(KEY.minAgeTo, minAgeTo === undefined ? null : String(minAgeTo));
  set(KEY.nationality, nationality);
  // Comma separated rather than a repeated key: shorter to read, and the
  // order of the levels is not information.
  if (personhood && personhood.length > 0) set(KEY.personhood, personhood.join(','));

  return params;
}

export function filterFromSearchParams(params: URLSearchParams): ElectionFilterState {
  const personhood = (params.get(KEY.personhood) ?? '')
    .split(',')
    .filter((level): level is PersonhoodLevel =>
      (PERSONHOOD_LEVELS as readonly string[]).includes(level),
    );

  const minAgeFrom = age(params.get(KEY.minAgeFrom));
  const minAgeTo = age(params.get(KEY.minAgeTo));
  const nationality = params.get(KEY.nationality) ?? undefined;

  /**
   * `nocancel=1` from before the chip had two answers.
   *
   * A link sent while the control was a single toggle should still find the
   * elections it was about, and reading one extra key costs nothing next to a
   * shared URL that quietly stops filtering.
   */
  const legacyNoCancel = params.get(KEY.noCancelLegacy) === ON ? 'no_cancel' : null;

  return {
    ...EMPTY_FILTERS,
    query: params.get(KEY.query) ?? '',
    phase: oneOf<ElectionPhase>(params.get(KEY.phase), PHASE_FILTERS),
    domainOnly: params.get(KEY.domainOnly) === ON,
    restrictedOnly: params.get(KEY.restrictedOnly) === ON,
    votingType: oneOf<VotingType>(params.get(KEY.votingType), VOTING_TYPES),
    schedule: oneOf(params.get(KEY.schedule), ['fixed', 'movable'] as const),
    cancel: oneOf(params.get(KEY.cancel), ['no_cancel', 'can_cancel'] as const) ?? legacyNoCancel,
    createdFrom: params.get(KEY.createdFrom) ?? '',
    createdTo: params.get(KEY.createdTo) ?? '',
    closingSoon: params.get(KEY.closingSoon) === ON,
    enrolledOnly: params.get(KEY.enrolledOnly) === ON,
    votedOnly: params.get(KEY.votedOnly) === ON,
    canVoteNow: params.get(KEY.canVoteNow) === ON,
    savedOnly: params.get(KEY.savedOnly) === ON,
    sort: oneOf<ElectionSort>(params.get(KEY.sort), SORT_OPTIONS) ?? DEFAULT_SORT,
    eligibility: {
      ...(minAgeFrom !== undefined && { minAgeFrom }),
      ...(minAgeTo !== undefined && { minAgeTo }),
      ...(nationality ? { nationality } : {}),
      ...(personhood.length > 0 && { personhood }),
    },
  };
}
