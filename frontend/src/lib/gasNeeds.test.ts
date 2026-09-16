import { describe, it, expect } from 'vitest';
import {
  remainingVoters,
  electionNeed,
  openNeeds,
  totalShortfall,
  canFundOneVote,
  fundingVerdict,
  stillOpen,
  VOTE_COST_FALLBACK,
} from './gasNeeds';
import type { Election } from '../data/seed';

/**
 * A ballot's cost is measured from the chain now, so these tests state it
 * instead of importing a constant: the arithmetic is the subject here, not
 * whatever today's gas price happens to make it.
 */
const COST = VOTE_COST_FALLBACK;

const election = (over: Partial<Election> = {}): Election =>
  ({
    id: '0xe1',
    contractAddress: '0xe1',
    title: 'An election',
    description: '',
    phase: 'active',
    organizer: 'Someone',
    organizerAddress: '0xorg',
    enrollStart: new Date(),
    enrollEnd: new Date(),
    voteStart: new Date(),
    voteEnd: new Date(),
    candidates: [],
    eligibility: [],
    totalEnrolled: 100,
    castVotes: 0,
    votingType: 'simple_plurality',
    privacyQuorum: 0,
    ...over,
  }) as Election;

describe('what an election still owes', () => {
  it('counts people who have not voted, not ballots that were cast', () => {
    // A voter who changed their mind cast two ballots and is one person who no
    // longer needs paying for. Counting ballots would undercount who is left.
    const e = election({ totalEnrolled: 10, castVotes: 8, distinctVoters: 4 });
    expect(remainingVoters(e)).toBe(6);
  });

  it('never goes negative when more ballots exist than voters', () => {
    const e = election({ totalEnrolled: 3, castVotes: 9, distinctVoters: 3 });
    expect(remainingVoters(e)).toBe(0);
  });

  it('treats an unknown voter count as nobody having voted', () => {
    const e = election({ totalEnrolled: 5, distinctVoters: undefined });
    expect(remainingVoters(e)).toBe(5);
  });

  it('is short by exactly what the reserve does not cover', () => {
    const e = election({ totalEnrolled: 10, distinctVoters: 0 });
    const need = electionNeed(e, 0.15, COST);
    expect(need.estimatedCost).toBeCloseTo(10 * COST);
    expect(need.shortfall).toBeCloseTo(0.15);
  });

  it('is short by nothing when the reserve is bigger than the bill', () => {
    const need = electionNeed(election({ totalEnrolled: 2, distinctVoters: 0 }), 5, COST);
    expect(need.shortfall).toBe(0);
  });

  it('ignores elections that can no longer take a vote', () => {
    // A closed election owes nobody: whatever is still reserved for it is on
    // its way back, and counting it would hold the organizer's own money
    // hostage to an election that is over.
    expect(stillOpen(election({ phase: 'closed' }))).toBe(false);
    expect(stillOpen(election({ phase: 'tallying' }))).toBe(false);
    expect(stillOpen(election({ phase: 'cancelled' }))).toBe(false);
    expect(stillOpen(election({ phase: 'enrolling' }))).toBe(true);

    const needs = openNeeds(
      [election({ phase: 'closed', totalEnrolled: 500 }), election({ phase: 'active', totalEnrolled: 10 })],
      () => 0,
      COST,
    );
    expect(needs).toHaveLength(1);
    expect(totalShortfall(needs)).toBeCloseTo(10 * COST);
  });
});

describe('what a voter is told', () => {
  it('refuses a vote nothing can pay for', () => {
    expect(canFundOneVote(0, 0, COST)).toBe(false);
    // Never let someone spend two minutes on a proof that cannot be relayed.
    expect(canFundOneVote(COST / 2, 0, COST)).toBe(false);
    expect(canFundOneVote(0, COST, COST)).toBe(true);
  });

  it('counts only the reserve as a guarantee', () => {
    // The free balance is real money that will be spent, and also money the
    // organizer can withdraw at any moment. Adding the two together would tell
    // a voter the second kind is as good as the first.
    const verdict = fundingVerdict(election({ totalEnrolled: 10, distinctVoters: 0 }), 0.3, 3, COST);
    expect(verdict.guaranteed).toBe(10);
    expect(verdict.possible).toBe(110);
    expect(verdict.unfunded).toBe(false);
    expect(verdict.short).toBe(false);
  });

  it('says it is short when it cannot cover everyone still expected', () => {
    const verdict = fundingVerdict(election({ totalEnrolled: 100, distinctVoters: 0 }), 0.06, 0, COST);
    expect(verdict.guaranteed).toBe(2);
    expect(verdict.short).toBe(true);
    // Short is not the same as unfunded: two people can still vote today.
    expect(verdict.unfunded).toBe(false);
  });

  it('is not short once everyone who enrolled has voted', () => {
    const verdict = fundingVerdict(election({ totalEnrolled: 100, distinctVoters: 100 }), 0, 0, COST);
    expect(verdict.short).toBe(false);
    // Unfunded all the same, which is the honest answer to "could I vote now".
    expect(verdict.unfunded).toBe(true);
  });
});
