import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * Reading a list nobody wants all of.
 *
 * Two traps, and the hook exists for both. The first: fetch ten, filter to
 * "mine", show nothing. An organizer whose elections sit further down would see
 * an empty dashboard with their own data unread, and no amount of scrolling
 * helps because nothing asked for more. So the filter lives in the hook and the
 * hook keeps pulling until it has enough MATCHES, not enough rows.
 *
 * The second: reading everything to find the few that were ever going to be
 * shown. The chain indexes elections by organizer and by enrolled voter, so
 * those lists resolve to a handful of addresses before anything is read at all,
 * and the test that matters is that the wide read never happens.
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    /** Addresses the factory holds, newest first. */
    todas: [] as string[],
    mias: [] as string[],
    inscritas: [] as string[],
    commitment: 1n as bigint | null,
    /** Every address handed to the hydrator, in order. */
    hidratadas: [] as string[],
    /** Times the whole factory was asked for its addresses. */
    lecturasAmplias: 0,
  },
}));

vi.mock('../lib/deployments', () => ({ isChainConfigured: () => true }));
vi.mock('../data/seed', () => ({ ELECTIONS: [] }));
vi.mock('../lib/semaphore', () => ({ getStoredCommitment: () => estado.commitment }));

vi.mock('../lib/chainElections', () => ({
  fetchElectionAddresses: async () => {
    estado.lecturasAmplias += 1;
    return estado.todas;
  },
  fetchOrganizerElectionAddresses: async () => estado.mias,
  fetchEnrolledElectionAddresses: async () => estado.inscritas,
  hydrateElections: async (addresses: string[]) => {
    estado.hidratadas.push(...addresses);
    return addresses.map(a => ({ id: a, organizerAddress: a.startsWith('mia') ? '0xmia' : '0xotra' }));
  },
}));

function direcciones(n: number, prefijo = 'e'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefijo}${i}`);
}

describe('useElectionPages', () => {
  beforeEach(() => {
    estado.todas = [];
    estado.mias = [];
    estado.inscritas = [];
    estado.commitment = 1n;
    estado.hidratadas = [];
    estado.lecturasAmplias = 0;
    vi.resetModules();
  });

  it('hands out a page, in the order the chain layer gave it', async () => {
    estado.todas = direcciones(30);
    const { useElectionPages } = await import('./useElectionPages');
    const { result } = renderHook(() => useElectionPages({ pageSize: 5 }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.elections.map(e => e.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
    expect(result.current.total).toBe(30);
  });

  it('keeps fetching until the page is FULL of matches, not of rows', async () => {
    // One in twenty is this organizer's, and none of them are near the top. A
    // single chunk would match nothing at all.
    estado.todas = [...direcciones(57, 'otra'), ...direcciones(3, 'mia')];
    const { useElectionPages } = await import('./useElectionPages');
    const { result } = renderHook(() =>
      useElectionPages({ pageSize: 3, keep: e => e.organizerAddress === '0xmia' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.elections).toHaveLength(3));

    expect(result.current.elections.map(e => e.id)).toEqual(['mia0', 'mia1', 'mia2']);
  });

  it('holds a page in reserve, so asking for more is already answered', async () => {
    estado.todas = direcciones(60);
    const { useElectionPages } = await import('./useElectionPages');
    const { result } = renderHook(() => useElectionPages({ pageSize: 5 }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Five drawn, more than five read: that surplus IS the prefetch.
    expect(result.current.elections).toHaveLength(5);
    expect(estado.hidratadas.length).toBeGreaterThanOrEqual(10);
    // And not the whole factory, which is the thing being avoided.
    expect(estado.hidratadas.length).toBeLessThan(60);
  });

  it('stops asking once the factory is exhausted', async () => {
    estado.todas = direcciones(4);
    const { useElectionPages } = await import('./useElectionPages');
    const { result } = renderHook(() => useElectionPages({ pageSize: 10 }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.elections).toHaveLength(4);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.complete).toBe(true);
  });

  it('asks the organizer index instead of reading the whole platform', async () => {
    estado.todas = direcciones(500);
    estado.mias = ['mia0', 'mia1'];
    const { useElectionPages } = await import('./useElectionPages');
    const { result } = renderHook(() =>
      useElectionPages({ scope: 'mine', organizer: '0xmia', hydrateAll: true }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.all.map(e => e.id)).toEqual(['mia0', 'mia1']);
    // The point of the whole exercise: five hundred elections, two reads.
    expect(estado.hidratadas).toEqual(['mia0', 'mia1']);
    expect(estado.lecturasAmplias).toBe(0);
  });

  it('waits for the wallet rather than reading the wrong scope', async () => {
    estado.todas = direcciones(20);
    const { useElectionPages } = await import('./useElectionPages');
    const { result, rerender } = renderHook(
      ({ organizer }: { organizer?: string }) => useElectionPages({ scope: 'mine', organizer }),
      { initialProps: {} as { organizer?: string } },
    );

    expect(result.current.loading).toBe(true);
    expect(estado.hidratadas).toEqual([]);

    estado.mias = ['mia0'];
    rerender({ organizer: '0xmia' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.elections.map(e => e.id)).toEqual(['mia0']);
  });

  it('shows an empty list, not a spinner, when there is no wallet at all', async () => {
    const { useElectionPages } = await import('./useElectionPages');
    const { result } = renderHook(() => useElectionPages({ scope: 'mine', organizer: null }));

    // `undefined` means "ask me later" and `null` means "there is nobody".
    // Reading them as the same value leaves a disconnected organizer watching a
    // spinner that never stops.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.elections).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });

  it('reads the voter\'s whole enrolment when the screen adds it up', async () => {
    estado.todas = direcciones(400);
    estado.inscritas = direcciones(30, 'ins');
    const { useElectionPages } = await import('./useElectionPages');
    const { result } = renderHook(() =>
      useElectionPages({ scope: 'enrolled', hydrateAll: true, pageSize: 5 }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.complete).toBe(true));

    // Everything in scope is read, because the header counts it and warns on it.
    expect(result.current.all).toHaveLength(30);
    // Only a page is handed out to draw.
    expect(result.current.elections).toHaveLength(5);
    expect(estado.hidratadas).toHaveLength(30);
  });

  it('looks nothing up for a device with no identity', async () => {
    estado.todas = direcciones(400);
    estado.commitment = null;
    const { useElectionPages } = await import('./useElectionPages');
    const { result } = renderHook(() => useElectionPages({ scope: 'enrolled' }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.all).toEqual([]);
    expect(estado.hidratadas).toEqual([]);
  });
});
