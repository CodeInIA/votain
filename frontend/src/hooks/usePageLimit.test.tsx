import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePageLimit } from './usePageLimit';

describe('usePageLimit', () => {
  it('draws one page and says there is more', () => {
    const { result } = renderHook(() => usePageLimit(Array.from({ length: 30 }, (_, i) => i), 10));

    expect(result.current.visible).toHaveLength(10);
    expect(result.current.hasMore).toBe(true);
  });

  it('widens by a page at a time until the list runs out', () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const { result } = renderHook(() => usePageLimit(items, 10));

    act(() => result.current.loadMore());
    expect(result.current.visible).toHaveLength(20);

    act(() => result.current.loadMore());
    expect(result.current.visible).toHaveLength(25);
    expect(result.current.hasMore).toBe(false);
  });

  it('starts again when the list becomes a different list', () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    const { result, rerender } = renderHook(
      ({ tab }: { tab: string }) => usePageLimit(items, 10, tab),
      { initialProps: { tab: 'all' } },
    );

    act(() => result.current.loadMore());
    act(() => result.current.loadMore());
    expect(result.current.visible).toHaveLength(30);

    // Someone who paged to the bottom of one tab and then picked another is
    // starting a different list: leaving the limit where it was would drop
    // thirty rows of the new one on them at once.
    rerender({ tab: 'closed' });
    expect(result.current.visible).toHaveLength(10);
  });
});
