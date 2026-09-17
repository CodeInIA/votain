import { describe, it, expect } from 'vitest';

import { filterFromSearchParams, filterToSearchParams } from './electionFilterParams';
import { EMPTY_FILTERS, type ElectionFilterState } from './electionFilter';

/**
 * The filter state, through the address bar and back.
 *
 * The failure this guards against is silent: a filter that writes under one
 * name and reads under another simply stops existing when the reader presses
 * back, and nothing errors. So the round trip is asserted over the WHOLE
 * object rather than field by field, because a field that nobody remembered
 * to test is exactly the field that gets lost.
 */

const roundTrip = (filter: ElectionFilterState) =>
  filterFromSearchParams(filterToSearchParams(filter));

describe('carrying the filters in the URL', () => {
  it('brings every field back unchanged', () => {
    const everything: ElectionFilterState = {
      query: 'cooperativa',
      phase: 'enrolling',
      domainOnly: true,
      restrictedOnly: true,
      votingType: 'two_thirds',
      schedule: 'fixed',
      cancel: 'no_cancel',
      createdFrom: '2026-09-01T08:30',
      createdTo: '2026-09-30T20:00',
      closingSoon: true,
      enrolledOnly: true,
      votedOnly: true,
      canVoteNow: true,
      sort: 'closing',
      eligibility: {
        minAgeFrom: 18,
        minAgeTo: 65,
        nationality: 'ESP',
        personhood: ['document', 'orb'],
      },
    };

    expect(roundTrip(everything)).toEqual(everything);
  });

  it('brings an untouched list back untouched', () => {
    expect(roundTrip(EMPTY_FILTERS)).toEqual(EMPTY_FILTERS);
  });

  it('writes nothing for a list nobody has narrowed', () => {
    // A clean page should have a clean address bar: a query string restating
    // every default would make an ordinary link look like a saved search.
    expect(filterToSearchParams(EMPTY_FILTERS).toString()).toBe('');
  });

  it('leaves the default order out and names any other', () => {
    expect(filterToSearchParams({ ...EMPTY_FILTERS, sort: 'newest' }).get('sort')).toBeNull();
    expect(filterToSearchParams({ ...EMPTY_FILTERS, sort: 'oldest' }).get('sort')).toBe('oldest');
  });

  it('drops a search that is only spaces', () => {
    const params = filterToSearchParams({ ...EMPTY_FILTERS, query: '   ' });
    expect(params.toString()).toBe('');
  });
});

describe('a query string somebody typed', () => {
  const read = (search: string) => filterFromSearchParams(new URLSearchParams(search));

  it('ignores a value the app does not have', () => {
    // URLs get edited, truncated and mangled by chat apps. An unknown phase
    // is not an error to show, it is a filter that was never set.
    expect(read('phase=banana').phase).toBeNull();
    expect(read('rule=coin_toss').votingType).toBeNull();
    expect(read('sort=whatever').sort).toBe('newest');
    expect(read('dates=maybe').schedule).toBeNull();
    expect(read('cancel=perhaps').cancel).toBeNull();
  });

  it('ignores an age that is not a whole number in range', () => {
    for (const bad of ['age_from=abc', 'age_from=-4', 'age_from=999', 'age_from=18.5']) {
      expect(read(bad).eligibility.minAgeFrom).toBeUndefined();
    }
    expect(read('age_from=18').eligibility.minAgeFrom).toBe(18);
  });

  it('keeps only the personhood levels it recognises', () => {
    expect(read('who=orb,dragon,device').eligibility.personhood).toEqual(['orb', 'device']);
    // Nothing recognisable means the filter is absent, not empty.
    expect(read('who=dragon').eligibility.personhood).toBeUndefined();
  });

  it('treats any value but 1 as off, for the plain switches', () => {
    expect(read('domain=1').domainOnly).toBe(true);
    expect(read('domain=true').domainOnly).toBe(false);
    expect(read('').domainOnly).toBe(false);
  });

  it('still honours a link from when cancelling was one toggle', () => {
    // `nocancel=1` was the whole control before it grew a second answer, and
    // a shared link that quietly stops filtering is worse than an extra key.
    expect(read('nocancel=1').cancel).toBe('no_cancel');
    // The current key wins if somehow both are there.
    expect(read('nocancel=1&cancel=can_cancel').cancel).toBe('can_cancel');
  });
});
