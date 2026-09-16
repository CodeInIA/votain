import { describe, it, expect } from 'vitest';

import {
  EMPTY_FILTERS,
  isAnyFilterActive,
  matchesElectionFilter,
  type ElectionFilterState,
} from './electionFilter';
import type { Election, VotingType } from '../data/seed';

/**
 * The shared matching rule, exercised through the filter that was added last.
 *
 * The rule an election is decided by is now on the cards, so it had to be
 * filterable: seeing "Two-thirds Majority" on a card and having no way to ask
 * for only those is the kind of gap that makes a label feel decorative.
 */

const election = (over: Partial<Election>): Election =>
  ({
    id: '0x1',
    title: 'Board renewal',
    organizer: 'Cooperativa La Espiga',
    phase: 'active',
    votingType: 'simple_plurality' as VotingType,
    ...over,
  }) as unknown as Election;

const filters = (over: Partial<ElectionFilterState>): ElectionFilterState => ({
  ...EMPTY_FILTERS,
  ...over,
});

// No election in these tests claims a verified domain, so the predicate is
// asked about the filters themselves rather than about DNS.
const noneVerified = () => false;
const matches = (e: Election, f: Partial<ElectionFilterState>) =>
  matchesElectionFilter(e, filters(f), noneVerified);

describe('filtering by how an election is decided', () => {
  it('keeps only the rule asked for', () => {
    expect(matches(election({ votingType: 'two_thirds' }), { votingType: 'two_thirds' })).toBe(true);
    expect(matches(election({ votingType: 'simple_plurality' }), { votingType: 'two_thirds' })).toBe(
      false,
    );
  });

  it('keeps every rule when none is asked for', () => {
    const types: VotingType[] = [
      'simple_plurality',
      'absolute_majority',
      'two_thirds',
      'witness_threshold',
    ];
    for (const votingType of types) {
      expect(matches(election({ votingType }), {})).toBe(true);
    }
  });

  it('narrows alongside the other filters rather than replacing them', () => {
    const e = election({ votingType: 'witness_threshold', phase: 'closed' });
    expect(matches(e, { votingType: 'witness_threshold', phase: 'closed' })).toBe(true);
    // The rule matches and the phase does not: an AND, so the election is out.
    expect(matches(e, { votingType: 'witness_threshold', phase: 'active' })).toBe(false);
  });

  it('counts as an active filter, so the collapsed bar shows its dot', () => {
    // The dot is the only sign a list is being narrowed once the bar is shut.
    // Every filter has to be accounted for here, not just the easiest to name.
    expect(isAnyFilterActive(EMPTY_FILTERS)).toBe(false);
    expect(isAnyFilterActive(filters({ votingType: 'two_thirds' }))).toBe(true);
  });
});

describe('the new properties a reader can narrow by', () => {
  const soon = new Date(Date.now() + 2 * 3_600_000);
  const later = new Date(Date.now() + 5 * 86_400_000);
  const at = (phase: Election['phase'], deadline: Date, over: Partial<Election> = {}) =>
    election({ phase, voteEnd: deadline, enrollEnd: deadline, ...over });

  it('finds elections whose next deadline is within a day', () => {
    // Whatever that deadline is: enrolling is measured against the close of
    // enrolment, active against the close of voting.
    expect(matches(at('active', soon), { closingSoon: true })).toBe(true);
    expect(matches(at('enrolling', soon), { closingSoon: true })).toBe(true);
    expect(matches(at('active', later), { closingSoon: true })).toBe(false);
    // A closed election has no next deadline at all.
    expect(matches(at('closed', soon), { closingSoon: true })).toBe(false);
  });

  it('separates published results from a closed election', () => {
    // The distinction this filter exists for: closed is not readable, and
    // someone looking for something to READ would otherwise find it and leave
    // empty handed.
    const noTally = at('closed', later, { candidates: [{ id: 'a', name: 'A' }] });
    const published = at('closed', later, { candidates: [{ id: 'a', name: 'A', votes: 3 }] });

    expect(matches(noTally, { withResults: true })).toBe(false);
    expect(matches(published, { withResults: true })).toBe(true);
  });

  it('tells a promise from a refusal from a silence', () => {
    const promised = at('active', later, { fixedSchedule: true });
    const declined = at('active', later, { fixedSchedule: false });
    // Deployed before the flag existed: it made no promise and declined none,
    // so it belongs in neither answer rather than in the unflattering one.
    const unknown = at('active', later, { fixedSchedule: undefined });

    expect(matches(promised, { schedule: 'fixed' })).toBe(true);
    expect(matches(declined, { schedule: 'fixed' })).toBe(false);
    expect(matches(unknown, { schedule: 'fixed' })).toBe(false);

    expect(matches(declined, { schedule: 'movable' })).toBe(true);
    expect(matches(promised, { schedule: 'movable' })).toBe(false);
    expect(matches(unknown, { schedule: 'movable' })).toBe(false);
  });

  it('counts each of them as narrowing the list', () => {
    // The dot on the collapsed bar and the "clear filters" link both read this,
    // and a filter missing from it is one the reader cannot tell is on.
    expect(isAnyFilterActive(filters({ closingSoon: true }))).toBe(true);
    expect(isAnyFilterActive(filters({ withResults: true }))).toBe(true);
    expect(isAnyFilterActive(filters({ schedule: 'fixed' }))).toBe(true);
    expect(isAnyFilterActive(EMPTY_FILTERS)).toBe(false);
  });
});
