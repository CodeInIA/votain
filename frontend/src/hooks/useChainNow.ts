import { useEffect, useState } from 'react';
import { getReadProvider } from '../lib/contracts';
import { isChainConfigured } from '../lib/deployments';

/**
 * How far the two clocks have to disagree before the difference means anything.
 *
 * A live network's blocks drift by seconds, and a few seconds is never a fact
 * about the election: it is a fact about block production. A local node whose
 * time was advanced by seeding sits DAYS ahead, which is the case this exists
 * for. Five minutes is comfortably past the first and nowhere near the second.
 */
export const CLOCK_GAP_MS = 5 * 60 * 1000;

export interface ChainNow {
  /** The latest block's timestamp, or null until the read lands or if it fails. */
  chainNowMs: number | null;
  /** Read once at mount, so the value does not change between two renders. */
  browserNowMs: number;
  /** The better of the two, which is what a caller almost always wants. */
  nowMs: number;
  /** Whether the chain answered, for a caller that must not guess. */
  known: boolean;
}

/**
 * The clock the contracts actually keep time by.
 *
 * Every deadline on chain is judged against `block.timestamp`, so the browser's
 * clock is the wrong reference for any question of the form "has this passed
 * yet". On a local node seeded with `evm_increaseTime` the two are days apart,
 * and comparisons made against the browser come out backwards: an enrolment
 * window that closed on schedule an hour of chain time ago still looks future
 * here, so anything inferring "the organizer closed this early" from the gap
 * infers it about every election on the chain.
 *
 * Extracted from `CreateElection`, which had the only copy of this and used it
 * to stop the wizard offering dates the chain would reject. A second reader
 * turned up and the reasoning should not be written twice.
 *
 * Falls back to the browser clock rather than blocking: with no chain
 * configured there is nothing to ask, and a wrong-by-seconds answer beats a
 * component that renders nothing.
 */
export function useChainNow(): ChainNow {
  const [chainNowMs, setChainNowMs] = useState<number | null>(null);
  // Through a lazy initializer: `Date.now()` during render is impure, and a
  // clock that ticks between renders makes the same input decide differently
  // from one keystroke to the next.
  const [browserNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isChainConfigured()) return;
    let cancelled = false;
    void (async () => {
      try {
        const block = await getReadProvider().getBlock('latest');
        if (!cancelled && block) setChainNowMs(Number(block.timestamp) * 1000);
      } catch {
        // Left null on purpose. See the fallback above.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return {
    chainNowMs,
    browserNowMs,
    nowMs: chainNowMs ?? browserNowMs,
    known: chainNowMs !== null,
  };
}
