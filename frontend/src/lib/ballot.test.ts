/**
 * Which epoch a ballot names.
 *
 * The contract accepts the current epoch or the one that just ended. Naming the
 * previous one is what lets a voter replace a vote forced on them without
 * waiting for the next clock hour, and choosing between the two AT RANDOM is
 * what keeps that from showing: a ballot naming the previous epoch must not
 * mean "this voter already cast this hour".
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./contracts', () => ({ getElection: () => ({}), getReadProvider: () => ({}) }));
vi.mock('./semaphore', () => ({ fetchElectionGroup: async () => ({}) }));

import { chooseEpoch, EpochAlreadyUsedError, PREVIOUS_EPOCH_MARGIN_SECONDS } from './ballot';

const HOUR = 3600n;
const CURRENT = 490_000n;
/** Ten minutes into the current epoch: plenty of time to prove. */
const EARLY = CURRENT * HOUR + 600n;
/** One minute before the epoch turns: too late for the previous one. */
const LATE = (CURRENT + 1n) * HOUR - 60n;

const base = { current: CURRENT, epochLength: HOUR, now: EARLY, currentUsed: false, previousUsed: false };

describe('chooseEpoch', () => {
  it('draws between the two when both are free, so neither says anything', () => {
    expect(chooseEpoch({ ...base, coin: () => true })).toBe(CURRENT - 1n);
    expect(chooseEpoch({ ...base, coin: () => false })).toBe(CURRENT);
  });

  it('gives a voter who just cast an immediate second ballot', () => {
    // The case this exists for: a vote forced on the voter used the current
    // epoch, and the override takes the previous one rather than waiting.
    expect(chooseEpoch({ ...base, currentUsed: true })).toBe(CURRENT - 1n);
    expect(chooseEpoch({ ...base, previousUsed: true })).toBe(CURRENT);
  });

  it('refuses once both are spent, and says when the next one opens', () => {
    try {
      chooseEpoch({ ...base, currentUsed: true, previousUsed: true });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EpochAlreadyUsedError);
      expect((e as EpochAlreadyUsedError).nextAt.getTime()).toBe(Number((CURRENT + 1n) * HOUR) * 1000);
    }
  });

  it('never names the previous epoch too close to the turn, where it would arrive stale', () => {
    // LATE is inside the margin, which is what makes this case the one it is.
    expect((CURRENT + 1n) * HOUR - LATE <= PREVIOUS_EPOCH_MARGIN_SECONDS).toBe(true);
    // Both free: the coin is not even asked.
    expect(chooseEpoch({ ...base, now: LATE, coin: () => true })).toBe(CURRENT);
    // Current spent: the voter waits the minute rather than proving for nothing.
    expect(() => chooseEpoch({ ...base, now: LATE, currentUsed: true })).toThrow(EpochAlreadyUsedError);
  });

  it('has no previous epoch at the very start of time', () => {
    expect(chooseEpoch({ ...base, current: 0n, now: 600n, coin: () => true })).toBe(0n);
  });
});
