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
