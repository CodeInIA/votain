import { describe, it, expect } from 'vitest';
import { replacedBallots, turnoutPct, votersOf } from './turnout';
import type { Election } from '../data/seed';

/**
 * Turnout is people over people.
 *
 * The bug this pins: the election page divided BALLOTS by the roll and capped
 * the answer at 100, so an election with five enrolled, three voters and five
 * ballots read 100% on the page and 60% on the card that opened it. The cap is
 * what made it hard to see: the number was never impossible, only wrong.
 */

const election = (over: Partial<Election>): Election =>
  ({
    id: '0x1',
    title: 'An election',
    castVotes: 0,
    totalEnrolled: 0,
    ...over,
  }) as Election;

describe('votersOf', () => {
  it('counts people, not the ballots they cast', () => {
    // The coercion-resistance path: two voters changed their mind.
    const e = election({ totalEnrolled: 5, castVotes: 5, distinctVoters: 3 });

    expect(votersOf(e)).toBe(3);
    expect(replacedBallots(e)).toBe(2);
  });

  it('falls back to ballots for an election that counts no voters', () => {
    // Seed elections carry no `distinctVoters`. Ballots are all there is, and
    // the roll is the most they can honestly stand for.
    const e = election({ totalEnrolled: 4, castVotes: 9, distinctVoters: undefined });

    expect(votersOf(e)).toBe(4);
    expect(replacedBallots(e)).toBe(5);
  });

  it('reports no replaced ballots when everyone voted once', () => {
    expect(replacedBallots(election({ totalEnrolled: 3, castVotes: 3, distinctVoters: 3 }))).toBe(0);
  });
});

describe('turnoutPct', () => {
  it('is people over the roll', () => {
    expect(turnoutPct(election({ totalEnrolled: 5, castVotes: 5, distinctVoters: 3 }))).toBe(60);
  });

  it('does not pass 100% when a voter votes twice', () => {
    // One enrolled voter, two ballots. Ballots over the roll would be 200%.
    expect(turnoutPct(election({ totalEnrolled: 1, castVotes: 2, distinctVoters: 1 }))).toBe(100);
  });

  it('is zero before anybody is enrolled, rather than a division by zero', () => {
    expect(turnoutPct(election({ totalEnrolled: 0, castVotes: 0, distinctVoters: 0 }))).toBe(0);
  });
});
