/**
 * Keeps an election's dates honest while somebody is looking at them.
 *
 * THE DATES ARE NOT FIXED, which is the part that makes this necessary. An
 * organizer who kept the power to move deadlines can call
 * `closeEnrollmentEarly`, `openVotingEarly` or `closeVotingEarly`, and the
 * contract writes the new boundary: `enrollEnd = block.timestamp`, and
 * `voteStart` with it. Anybody already on the page keeps counting down to a
 * deadline that no longer exists, in a phase the election has left, and nothing
 * ever tells them otherwise, because the page reads the chain once when it
 * mounts.
 *
 * THREE WAYS TO NOTICE, cheapest first.
 *
 *   Coming back.  Handled by `useRefreshOnReturn` at the call site, the same
 *                 way the organizer's own pages already do it.
 *   A boundary.   A timeout to the next date in the schedule, which is when the
 *                 phase changes on its own. Exact, free while nothing happens,
 *                 and it covers the ordinary case of an election running its
 *                 course under an open tab.
 *   Asking.       Only while a deadline could move under the reader: the phase
 *                 is one the organizer can cut short AND they kept the power to
 *                 do it. An election with `fixedSchedule` cannot surprise
 *                 anybody, and a decided one has nothing left to move, so
 *                 neither is polled at all.
 *
 * Only while the tab is visible. A backgrounded page that keeps asking is a
 * page charging somebody's battery to refresh pixels nobody is looking at, and
 * `useRefreshOnReturn` catches them up the moment they return anyway.
 */
import { useEffect, useRef } from 'react';

import type { ElectionPhase } from '../data/seed';

/** Slow on purpose: this is a correction, not a live feed. */
const ASK_EVERY_MS = 60_000;

interface Watchable {
  phase: ElectionPhase;
  fixedSchedule?: boolean;
  enrollStart: Date;
  enrollEnd: Date;
  voteStart: Date;
  voteEnd: Date;
}

/**
 * The phases where a boundary is still ahead and an organizer could pull it in.
 *
 * Typed as `ElectionPhase` rather than as strings, and that is not tidiness: the
 * first version of this spelled them in upper case, matched nothing, and did
 * nothing at all. The unit tests passed because their fixtures were spelled the
 * same wrong way — the test agreed with the bug. A browser measuring the reads
 * on a live election is what caught it, and the type is what stops it coming
 * back.
 *
 * `voted` is in: having voted does not stop an organizer closing the window
 * early, and the page still shows that countdown.
 */
const CUTTABLE = new Set<ElectionPhase>([
  'upcoming',
  'enrolling',
  'enrolled',
  'pending_vote',
  'active',
  'voted',
]);

export function useScheduleWatch(
  election: Watchable | undefined,
  refresh: () => void | Promise<void>,
): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);

  const phase = election?.phase;
  const fixed = election?.fixedSchedule ?? false;
  // Primitives, so the effect does not re-run because a Date was rebuilt into
  // an equal but different object on every fetch.
  const boundaries = election
    ? [election.enrollStart, election.enrollEnd, election.voteStart, election.voteEnd]
        .map(d => d.getTime())
        .join(',')
    : '';

  useEffect(() => {
    if (!election || !phase || !CUTTABLE.has(phase)) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    // The next boundary the schedule itself will cross.
    const siguiente = boundaries
      .split(',')
      .map(Number)
      .filter(t => t > Date.now())
      .sort((a, b) => a - b)[0];
    if (siguiente !== undefined) {
      // A second past it, so the chain's own clock has certainly moved on: the
      // phase is derived from `block.timestamp`, not from ours.
      timers.push(setTimeout(() => void latest.current(), siguiente - Date.now() + 1000));
    }

    if (fixed) return () => timers.forEach(clearTimeout);

    const intervalo = setInterval(() => {
      if (document.visibilityState === 'visible') void latest.current();
    }, ASK_EVERY_MS);

    return () => {
      timers.forEach(clearTimeout);
      clearInterval(intervalo);
    };
  }, [election, phase, fixed, boundaries]);
}
