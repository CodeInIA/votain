/**
 * Noticing that an election's dates moved while somebody was reading them.
 *
 * An organizer who kept the power can call `closeEnrollmentEarly`, and the
 * contract writes `enrollEnd = block.timestamp`. A page that read the chain
 * once at mount keeps counting down to a deadline that no longer exists. These
 * pin the three ways it finds out, and the two cases where it must stay quiet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useScheduleWatch } from './useScheduleWatch';

const AHORA = new Date('2026-09-21T12:00:00Z').getTime();
const EN = (ms: number) => new Date(AHORA + ms);

function eleccion(over: Partial<Parameters<typeof useScheduleWatch>[0]> = {}) {
  return {
    phase: 'active' as const,
    fixedSchedule: false,
    enrollStart: EN(-3_600_000),
    enrollEnd: EN(-1_800_000),
    voteStart: EN(-1_000),
    voteEnd: EN(120_000),
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  // Visible by default; the polling half is meant to respect this.
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('watching an election schedule', () => {
  it('asks again just after the next boundary passes', () => {
    const refresh = vi.fn();
    // `fixedSchedule` so the slow ask is off and only the boundary can fire:
    // the timeout is armed either way, because a window running out is not
    // somebody moving it.
    renderHook(() => useScheduleWatch(eleccion({ fixedSchedule: true }), refresh));

    vi.advanceTimersByTime(119_000);
    expect(refresh).not.toHaveBeenCalled();

    // `voteEnd` is 120s out; a second past it the chain's clock has moved too.
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalled();
  });

  it('asks on its own while a deadline could still be pulled in', () => {
    const refresh = vi.fn();
    // Far from any boundary, so only the slow ask can fire.
    renderHook(() => useScheduleWatch(eleccion({ voteEnd: EN(86_400_000) }), refresh));

    vi.advanceTimersByTime(59_000);
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the organizer gave up the power to move dates', () => {
    const refresh = vi.fn();
    renderHook(() =>
      useScheduleWatch(eleccion({ fixedSchedule: true, voteEnd: EN(86_400_000) }), refresh),
    );

    vi.advanceTimersByTime(10 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stays quiet once the election is decided, where nothing can move', () => {
    const refresh = vi.fn();
    renderHook(() => useScheduleWatch(eleccion({ phase: 'closed' }), refresh));

    vi.advanceTimersByTime(10 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not ask while the tab is in the background', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const refresh = vi.fn();
    renderHook(() => useScheduleWatch(eleccion({ voteEnd: EN(86_400_000) }), refresh));

    vi.advanceTimersByTime(5 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does nothing at all without an election', () => {
    const refresh = vi.fn();
    renderHook(() => useScheduleWatch(undefined, refresh));

    vi.advanceTimersByTime(10 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
