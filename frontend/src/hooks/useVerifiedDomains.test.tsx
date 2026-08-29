import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const checkElectionDomain = vi.fn();
vi.mock('../lib/organizerDomains', () => ({
  checkElectionDomain: (...args: unknown[]) => checkElectionDomain(...args),
}));

const { useVerifiedDomains } = await import('./useVerifiedDomains');

const ELECTIONS = [
  { organizerAddress: '0xAAA', organizerDomain: 'votain.app' },
  { organizerAddress: '0xAAA', organizerDomain: 'votain.app' },
  { organizerAddress: '0xBBB', organizerDomain: 'example.org' },
  { organizerAddress: '0xCCC' },
];

beforeEach(() => {
  checkElectionDomain.mockReset();
  checkElectionDomain.mockResolvedValue({ status: 'verified' });
});

describe('useVerifiedDomains', () => {
  it('checks each distinct organizer and domain pair once, not once per election', async () => {
    renderHook(() => useVerifiedDomains(ELECTIONS));
    await waitFor(() => expect(checkElectionDomain).toHaveBeenCalledTimes(2));
  });

  /**
   * The regression this hook froze the app with.
   *
   * Callers derive their list during render, `elections.filter(...)`, so the
   * array is a new object every time. Depending on that identity re-ran the
   * effect on every render, and because the effect sets state, each run caused
   * the next: an infinite loop that hung the page and fired a DNS request per
   * turn. Re-rendering with an equal-but-not-identical array must do nothing.
   */
  it('does not re-check when re-rendered with an equal but freshly built array', async () => {
    const { rerender } = renderHook(({ list }) => useVerifiedDomains(list), {
      initialProps: { list: ELECTIONS.map(e => ({ ...e })) },
    });
    await waitFor(() => expect(checkElectionDomain).toHaveBeenCalledTimes(2));

    for (let i = 0; i < 5; i++) rerender({ list: ELECTIONS.map(e => ({ ...e })) });

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(checkElectionDomain).toHaveBeenCalledTimes(2);
  });

  it('re-checks when the domains actually change', async () => {
    const { rerender } = renderHook(({ list }) => useVerifiedDomains(list), {
      initialProps: { list: [ELECTIONS[0]] },
    });
    await waitFor(() => expect(checkElectionDomain).toHaveBeenCalledTimes(1));

    rerender({ list: [{ organizerAddress: '0xAAA', organizerDomain: 'other.example' }] });
    await waitFor(() => expect(checkElectionDomain).toHaveBeenCalledTimes(2));
  });

  it('returns a predicate whose identity only changes with the answer', async () => {
    const { result, rerender } = renderHook(({ list }) => useVerifiedDomains(list), {
      initialProps: { list: ELECTIONS.map(e => ({ ...e })) },
    });
    await waitFor(() => expect(result.current(ELECTIONS[0])).toBe(true));

    // A stable predicate is what keeps callers' useMemo from recomputing
    // forever, which was the other half of the freeze.
    const before = result.current;
    rerender({ list: ELECTIONS.map(e => ({ ...e })) });
    expect(result.current).toBe(before);
  });

  it('reports an election with no domain, and an unverified one, as not verified', async () => {
    checkElectionDomain.mockResolvedValue({ status: 'no_record' });
    const { result } = renderHook(() => useVerifiedDomains(ELECTIONS));
    await waitFor(() => expect(checkElectionDomain).toHaveBeenCalled());

    expect(result.current(ELECTIONS[0])).toBe(false);
    expect(result.current({ organizerAddress: '0xCCC' })).toBe(false);
  });

  it('does nothing at all when no election carries a domain', async () => {
    renderHook(() => useVerifiedDomains([{ organizerAddress: '0xCCC' }]));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(checkElectionDomain).not.toHaveBeenCalled();
  });
});
