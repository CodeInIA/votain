import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRefreshOnReturn } from './useRefreshOnReturn';

/**
 * What a phone does to a page that asks for a signature.
 *
 * The wallet app takes the screen, this one is backgrounded, and the
 * transaction lands while nothing here is watching. Coming back, the screen
 * still shows the state from before it was sent, and the organizer had to
 * reload by hand. These pin when the refresh fires and, just as importantly,
 * when it does not.
 */

/** Drives document.hidden, which is read-only in jsdom. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useRefreshOnReturn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  afterEach(() => vi.useRealTimers());

  it('refreshes on returning from the wallet app', () => {
    const onReturn = vi.fn();
    renderHook(() => useRefreshOnReturn(onReturn));

    setHidden(true);
    vi.advanceTimersByTime(8_000); // signing takes a while
    setHidden(false);

    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('ignores a glance at the notification shade', () => {
    const onReturn = vi.fn();
    renderHook(() => useRefreshOnReturn(onReturn));

    setHidden(true);
    vi.advanceTimersByTime(300);
    setHidden(false);

    // Re-reading the chain on every flicker is its own kind of rude.
    expect(onReturn).not.toHaveBeenCalled();
  });

  it('does nothing when the page becomes visible without having left', () => {
    const onReturn = vi.fn();
    renderHook(() => useRefreshOnReturn(onReturn));

    setHidden(false);

    expect(onReturn).not.toHaveBeenCalled();
  });

  it('calls the callback it was last rendered with', () => {
    const viejo = vi.fn();
    const nuevo = vi.fn();
    const { rerender } = renderHook(({ cb }) => useRefreshOnReturn(cb), {
      initialProps: { cb: viejo },
    });

    rerender({ cb: nuevo });
    setHidden(true);
    vi.advanceTimersByTime(8_000);
    setHidden(false);

    // The listener is attached once, so a stale closure would refresh using
    // state from a render that is long gone.
    expect(viejo).not.toHaveBeenCalled();
    expect(nuevo).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the screen is gone', () => {
    const onReturn = vi.fn();
    const { unmount } = renderHook(() => useRefreshOnReturn(onReturn));

    unmount();
    setHidden(true);
    vi.advanceTimersByTime(8_000);
    setHidden(false);

    expect(onReturn).not.toHaveBeenCalled();
  });
});
