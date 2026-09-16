import { describe, it, expect } from 'vitest';

import {
  EMPTY_FILTERS,
  PHASE_FILTERS,
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

  it('offers every phase an election on chain can be in', () => {
    // A "results published" filter used to sit beside these, until the contract
    // settled it: `phase()` returns CLOSED only when `resultsPublished` is set,
    // so the two asked the same question and one of them had to go.
    expect(PHASE_FILTERS).toContain('upcoming');
    expect(PHASE_FILTERS).toContain('pending_vote');
    expect(PHASE_FILTERS).toContain('cancelled');
    expect(PHASE_FILTERS).toContain('voided');
    // In the order an election passes through them, with the early endings last.
    expect(PHASE_FILTERS.indexOf('enrolling')).toBeGreaterThan(PHASE_FILTERS.indexOf('upcoming'));
    expect(PHASE_FILTERS.indexOf('closed')).toBeGreaterThan(PHASE_FILTERS.indexOf('active'));
  });

  it('narrows to one phase at a time', () => {
    expect(matches(at('upcoming', later), { phase: 'upcoming' })).toBe(true);
    expect(matches(at('active', later), { phase: 'upcoming' })).toBe(false);
    expect(matches(at('pending_vote', later), { phase: 'pending_vote' })).toBe(true);
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
    expect(isAnyFilterActive(filters({ schedule: 'fixed' }))).toBe(true);
    expect(isAnyFilterActive(EMPTY_FILTERS)).toBe(false);
  });
});

describe('the two promises are not one promise', () => {
  const later = new Date(Date.now() + 5 * 86_400_000);

  it('filters on the dates without touching whether it can be called off', () => {
    // An election can keep its schedule and still be stopped, or run to the end
    // whatever happens. Someone asking for fixed dates is not asking about the
    // second, and folding them together would answer a question nobody asked.
    const fixedAndFinal = election({
      phase: 'active', voteEnd: later, fixedSchedule: true, cancellable: false,
    });
    const fixedButStoppable = election({
      phase: 'active', voteEnd: later, fixedSchedule: true, cancellable: true,
    });

    expect(matches(fixedAndFinal, { schedule: 'fixed' })).toBe(true);
    expect(matches(fixedButStoppable, { schedule: 'fixed' })).toBe(true);
  });

  it('filters on the cancellation promise without touching the dates', () => {
    // And the other way round, which is the combination nobody expects: dates
    // the organizer can still bring forward on an election they can no longer
    // call off. It is on the chain, so the filter has to be able to find it.
    const movableAndFinal = election({
      phase: 'active', voteEnd: later, fixedSchedule: false, cancellable: false,
    });
    const movableAndStoppable = election({
      phase: 'active', voteEnd: later, fixedSchedule: false, cancellable: true,
    });

    expect(matches(movableAndFinal, { cancel: 'no_cancel' })).toBe(true);
    expect(matches(movableAndStoppable, { cancel: 'no_cancel' })).toBe(false);
    // The other answer, which is a question someone auditing the platform
    // asks and the panel could not express until it had both chips.
    expect(matches(movableAndStoppable, { cancel: 'can_cancel' })).toBe(true);
    expect(matches(movableAndFinal, { cancel: 'can_cancel' })).toBe(false);
    // Neither chip on: it narrows nothing and both are still in the list.
    expect(matches(movableAndStoppable, { cancel: null })).toBe(true);
  });

  it('leaves out the election that never answered the question', () => {
    // `undefined` is not `false` and it is not `true` either. Deployed before
    // the flag, it made no promise and declined none, so it belongs in
    // neither answer: `!election.cancellable` would have collected it into
    // the first.
    const unknown = election({ phase: 'active', voteEnd: later, cancellable: undefined });
    expect(matches(unknown, { cancel: 'no_cancel' })).toBe(false);
    expect(matches(unknown, { cancel: 'can_cancel' })).toBe(false);
  });

  it('counts either cancel chip as narrowing the list', () => {
    expect(isAnyFilterActive(filters({ cancel: 'no_cancel' }))).toBe(true);
    expect(isAnyFilterActive(filters({ cancel: 'can_cancel' }))).toBe(true);
  });
});

describe('narrowing by the date nobody chose', () => {
  const on = (iso: string) => new Date(`${iso}T12:00:00`);
  const made = (iso?: string) =>
    election({ phase: 'active', createdAt: iso ? on(iso) : undefined });

  it('keeps what falls inside the range', () => {
    expect(matches(made('2026-09-10'), { createdFrom: '2026-09-01', createdTo: '2026-09-30' })).toBe(true);
    expect(matches(made('2026-08-31'), { createdFrom: '2026-09-01' })).toBe(false);
  });

  it('runs the upper bound to the END of its day', () => {
    // The same day at both ends means that day. Compared against midnight at
    // its start it would be an empty window, and "no elections" would be the
    // honest-looking answer to a perfectly reasonable question.
    expect(matches(made('2026-09-10'), { createdFrom: '2026-09-10', createdTo: '2026-09-10' })).toBe(true);
    expect(matches(made('2026-09-11'), { createdTo: '2026-09-10' })).toBe(false);
  });

  it('drops an election whose age the chain never recorded', () => {
    // Deployed before the immutable existed. It cannot be placed in time, and
    // putting it inside "created this week" is the one claim this filter
    // exists to make reliably.
    expect(matches(made(), { createdFrom: '2026-09-01' })).toBe(false);
    // With no range asked for it is not being placed in time at all.
    expect(matches(made(), {})).toBe(true);
  });

  it('counts as narrowing the list from either end alone', () => {
    expect(isAnyFilterActive(filters({ createdFrom: '2026-09-01' }))).toBe(true);
    expect(isAnyFilterActive(filters({ createdTo: '2026-09-01' }))).toBe(true);
  });
});
