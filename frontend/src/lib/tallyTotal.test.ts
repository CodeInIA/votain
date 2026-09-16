import { describe, it, expect } from 'vitest';
import { tallyTotal, hasPublishedResults } from '../data/seed';
import type { Election } from '../data/seed';

/**
 * What a published share is a share OF.
 *
 * The bug this pins: an election where one voter voted twice, which is the
 * coercion-resistance path working exactly as designed. The organizer's screen
 * read 100% for the single counted vote and the voter's read 50%, because two
 * of the four views that draw the same bar chart divided by BALLOTS and two
 * divided by the tally.
 */

const election = (votes: (number | undefined)[], over: Partial<Election> = {}): Election =>
  ({
    id: '0x1',
    title: 'An election',
    phase: 'closed',
    candidates: votes.map((v, i) => ({ id: `c${i}`, name: `Option ${i}`, votes: v })),
    castVotes: 0,
    totalEnrolled: 1,
    ...over,
  }) as Election;

describe('tallyTotal', () => {
  it('counts the votes, not the ballots that were cast', () => {
    // One voter, two ballots, one counted vote. `castVotes` is 2 and the tally
    // is 1: dividing by the first halves every candidate's share.
    const e = election([1, 0], { castVotes: 2, distinctVoters: 1 });

    expect(tallyTotal(e)).toBe(1);
    expect(e.castVotes).toBe(2);
    // The number the bar chart divides by, and therefore the share it draws.
    expect(Math.round((1 / tallyTotal(e)) * 100)).toBe(100);
    expect(Math.round((1 / e.castVotes) * 100)).toBe(50);
  });

  it('treats an option nobody voted for as zero, not as missing', () => {
    expect(tallyTotal(election([3, undefined, 2]))).toBe(5);
  });

  it('is zero before anything is published, and safe to divide by', () => {
    const unpublished = election([undefined, undefined], { phase: 'active' });
    expect(tallyTotal(unpublished)).toBe(0);
    expect(hasPublishedResults(unpublished)).toBe(false);
  });

  it('adds up to the number of people who voted, which is what the chain enforces', () => {
    // `publishResults` is checked against `distinctVoters`, so an honest tally
    // and that count are the same number. This is the relationship the two
    // screens disagreed about.
    const e = election([2, 1, 0], { castVotes: 5, distinctVoters: 3 });
    expect(tallyTotal(e)).toBe(e.distinctVoters);
  });
});
