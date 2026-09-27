/**
 * Reading one election, and telling a dropped connection from a missing one.
 *
 * Both used to end in the same "page not found", and a read the RPC never
 * answered left the page on a spinner for good. Seen on the local chain when
 * the proxy reset a connection mid-read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { fetchElection } = vi.hoisted(() => ({ fetchElection: vi.fn() }));

vi.mock('../lib/deployments', () => ({ isChainConfigured: () => true }));
vi.mock('../data/seed', () => ({ ELECTIONS: [], getSeedElection: () => undefined }));
vi.mock('../lib/chainElections', () => ({ fetchElection }));

import { useElection, ELECTION_READ_TIMEOUT_MS } from './useElections';

const ADDRESS = '0x6DF9099ef81A8d06bc753f4AF7A0D73c58723aed';
const ELECTION = { contractAddress: ADDRESS, title: 'Transport Sector Board' };

/** What ethers throws for an address with no contract behind it. */
const noContract = () => Object.assign(new Error('could not decode result data'), { code: 'BAD_DATA' });
/** What it throws when the connection drops. */
const dropped = () => Object.assign(new Error('failed to fetch'), { code: 'NETWORK_ERROR' });

beforeEach(() => {
  fetchElection.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useElection', () => {
  it('retries once after a dropped connection, and the reader never sees it', async () => {
    fetchElection.mockRejectedValueOnce(dropped()).mockResolvedValueOnce(ELECTION);

    const { result } = renderHook(() => useElection(ADDRESS));

    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 });
    expect(result.current.election).toEqual(ELECTION);
    expect(result.current.unreachable).toBe(false);
    expect(fetchElection).toHaveBeenCalledTimes(2);
  });

  it('says the chain did not answer, not that the election is missing', async () => {
    fetchElection.mockRejectedValue(dropped());

    const { result } = renderHook(() => useElection(ADDRESS));

    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 });
    expect(result.current.election).toBeUndefined();
    expect(result.current.unreachable).toBe(true);
  });

  it('does not retry an address that answered it holds no election', async () => {
    fetchElection.mockRejectedValue(noContract());

    const { result } = renderHook(() => useElection(ADDRESS));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unreachable).toBe(false);
    expect(fetchElection).toHaveBeenCalledTimes(1);
  });

  it('gives up on a read that is never answered instead of spinning for good', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    fetchElection.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useElection(ADDRESS));
    expect(result.current.loading).toBe(true);

    // The first read times out, the retry waits a second, and times out too.
    await act(async () => { await vi.advanceTimersByTimeAsync(ELECTION_READ_TIMEOUT_MS); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(ELECTION_READ_TIMEOUT_MS); });

    expect(result.current.loading).toBe(false);
    expect(result.current.unreachable).toBe(true);
  });
});
