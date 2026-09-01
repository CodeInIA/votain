import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What an unlock is worth after it happens.
 *
 * The Semaphore secret is never stored at rest, so before this the passkey had
 * to be tapped on every reload to see anything cast from another device. A
 * ballot's nullifier is public, though, and sits in the event the lookup just
 * read: writing it down turns one tap into a permanent answer.
 *
 * The rule these pin is that it records ONLY where a vote exists. Storing the
 * nullifier of an election the voter skipped would put a link between them and
 * that election on this disk, and buy nothing for it.
 *
 * Driven through `queryLogsFrom`, the boundary where the chain is actually
 * read, so the real `fetchVoteReceipts` runs rather than a stand-in for it.
 */

const remembered: Array<[string, string]> = [];
/** Election addresses that will report one ballot. */
const votedIn = new Set<string>();

vi.mock('./semaphore', () => ({
  computeNullifier: () => 42n,
  getStoredIdentity: () => ({ commitment: 1n }),
  getStoredVoteNullifier: () => null,
  rememberVote: (address: string, nullifier: bigint) => {
    remembered.push([address, nullifier.toString()]);
  },
}));

vi.mock('./contracts', () => ({
  getElection: (address: string) => ({
    address,
    scope: async () => 7n,
    filters: { VoteCast: () => ({}) },
  }),
  getReadProvider: () => ({}),
}));

vi.mock('./logs', () => ({
  queryLogsFrom: async (election: { address: string }) =>
    votedIn.has(election.address)
      ? [
          {
            args: { nullifier: 42n, voteCiphertext: '0x', nonce: 0n, timestamp: 1_700_000_000n },
            transactionHash: '0xtx',
          },
        ]
      : [],
}));

vi.mock('./relay', () => ({
  ensureLocalRegistration: async () => {},
  relayEnroll: async () => ({ txHash: '0x' }),
  relayVote: async () => ({ txHash: '0x' }),
}));

vi.mock('./paillier', () => ({ encryptBallot: () => '0x' }));

beforeEach(() => {
  remembered.length = 0;
  votedIn.clear();
});

describe('what a passkey unlock leaves behind', () => {
  it('writes down the nullifier of the ballot it finds', async () => {
    votedIn.add('0xvoted');
    const { fetchVoteHistory } = await import('./voting');

    const entries = await fetchVoteHistory([
      { contractAddress: '0xvoted', title: 'Voted here', phase: 'closed' },
      { contractAddress: '0xskipped', title: 'Skipped', phase: 'closed' },
    ]);

    expect(entries.map(e => e.electionId)).toEqual(['0xvoted']);
    expect(remembered).toEqual([['0xvoted', '42']]);
  });

  it('writes nothing for an election the voter skipped', async () => {
    const { fetchVoteHistory } = await import('./voting');

    await fetchVoteHistory([
      { contractAddress: '0xa', title: 'A', phase: 'closed' },
      { contractAddress: '0xb', title: 'B', phase: 'closed' },
    ]);

    expect(remembered).toHaveLength(0);
  });
});
