import { describe, it, expect } from 'vitest';

import { DEFAULT_SORT, SORT_OPTIONS, sortElections, sortNeedsEverything } from './electionSort';
import { EMPTY_FILTERS, isAnyFilterActive } from './electionFilter';
import type { Election, ElectionPhase } from '../data/seed';

/**
 * The order a list is shown in, and how much of the list the order covers.
 *
 * The second half is the part worth testing. Creation order is carried by the
 * ADDRESS list, which is read whole in one call, so the pager can walk it from
 * either end and be exact on the first page. The other orderings read values
 * that only exist once an election is hydrated, and Discover hydrates a page
 * at a time, so they can only be exact where everything has been read.
 */

const DAY = 86_400_000;
const soon = new Date(Date.now() + 2 * 3_600_000);
const later = new Date(Date.now() + 5 * DAY);

const election = (id: string, over: Partial<Election> = {}): Election =>
  ({
    id,
    title: id,
    phase: 'active' as ElectionPhase,
    enrollStart: new Date(Date.now() - DAY),
    enrollEnd: new Date(Date.now() - 3_600_000),
    voteStart: new Date(Date.now() - 3_600_000),
    voteEnd: later,
    totalEnrolled: 0,
    ...over,
  }) as Election;

const ids = (list: Election[]) => list.map(e => e.id);

describe('ordering a list of elections', () => {
  it('leaves the creation orders exactly as the pager delivered them', () => {
    // Not an oversight. Nothing on an election carries a creation date, and
    // re-deriving one from a date it does have would answer a different
    // question: an election created today and announced for next year is the
    // newest one and the last to open.
    const list = [election('c'), election('b'), election('a')];
    expect(ids(sortElections(list, 'newest'))).toEqual(['c', 'b', 'a']);
    expect(ids(sortElections(list, 'oldest'))).toEqual(['c', 'b', 'a']);
  });

  it('puts the next deadline first, whichever deadline it is', () => {
    const list = [
      election('far', { voteEnd: later }),
      election('enrolling-soon', { phase: 'enrolling', enrollEnd: soon, voteEnd: later }),
      election('voting-soon', { voteEnd: soon }),
    ];
    // The enrolling one is measured against the close of enrolment, the active
    // one against the close of voting, and the two share a deadline here.
    expect(ids(sortElections(list, 'closing'))[2]).toBe('far');
  });

  it('sinks the elections with no deadline left', () => {
    // A closed election has no next boundary, and "what should I act on" wants
    // it at the bottom rather than wherever a missing value happens to land.
    const list = [election('done', { phase: 'closed' }), election('live', { voteEnd: soon })];
    expect(ids(sortElections(list, 'closing'))).toEqual(['live', 'done']);
  });

  it('orders by how many people are in, largest first', () => {
    const list = [election('few', { totalEnrolled: 2 }), election('many', { totalEnrolled: 90 })];
    expect(ids(sortElections(list, 'enrolled'))).toEqual(['many', 'few']);
  });

  it('never mutates what it was given', () => {
    // These lists come straight out of a hook's state.
    const list = [election('b', { totalEnrolled: 1 }), election('a', { totalEnrolled: 9 })];
    sortElections(list, 'enrolled');
    expect(ids(list)).toEqual(['b', 'a']);
  });
});

describe('which orderings need the whole list', () => {
  it('says so for the ones that read a hydrated value', () => {
    expect(sortNeedsEverything('closing')).toBe(true);
    expect(sortNeedsEverything('enrolled')).toBe(true);
  });

  it('says no for the two the address list already settles', () => {
    expect(sortNeedsEverything('newest')).toBe(false);
    expect(sortNeedsEverything('oldest')).toBe(false);
  });
});

describe('an order is not a filter', () => {
  it('never lights the dot that warns a list is being narrowed', () => {
    // The dot and the "clear filters" link exist to say something is HIDDEN.
    // Every ordering shows the same elections, so counting one would make the
    // panel claim a filter that is not there.
    for (const sort of SORT_OPTIONS) {
      expect(isAnyFilterActive({ ...EMPTY_FILTERS, sort })).toBe(false);
    }
  });

  it('comes back to the default when the filters are cleared', () => {
    expect(EMPTY_FILTERS.sort).toBe(DEFAULT_SORT);
    expect(SORT_OPTIONS[0]).toBe(DEFAULT_SORT);
  });
});
