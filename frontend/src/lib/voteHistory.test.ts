import { describe, it, expect, vi, beforeEach } from 'vitest';
import { poseidon4 } from 'poseidon-lite';

import { ballotTag } from './ballotCrypto';

/**
 * What an unlock is worth after it happens.
 *
 * The voter's secret is never stored at rest, so before this the passkey had
 * to be tapped on every reload to see anything cast from another device. A
 * ballot's tag is public, though, and sits in the event the lookup just read:
 * writing the latest one down turns one tap into a permanent answer.
 *
 * The rule these pin is that it records ONLY where a vote exists. Storing a
 * tag for an election the voter skipped would put a link between them and
 * that election on this disk, and buy nothing for it.
 *
 * Driven through `queryLogsFrom`, the boundary where the chain is actually
 * read, so the real chain walk runs rather than a stand-in for it.
 */

const SECRET = 5n;
const SCOPE = 7n;
const tagAt = (k: bigint) => ballotTag(poseidon4, SECRET, SCOPE, k);

const remembered: Array<[string, bigint]> = [];
/** Election address => the tags its ballots were cast under, in order. */
const ballotsIn = new Map<string, bigint[]>();

vi.mock('./semaphore', () => ({
  getStoredIdentity: () => ({ commitment: 1n, secretScalar: SECRET }),
  getStoredBallotTag: () => null,
  rememberVote: (address: string, tag: bigint) => {
    remembered.push([address, tag]);
  },
}));

vi.mock('./contracts', () => ({
  getElection: (address: string) => ({
    address,
    scope: async () => SCOPE,
    // An election from before private enrolment: the call REVERTS, which is
    // how the chain says "the old doors", and the platform identity votes.
    platformAttester: async () => {
      throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' });
    },
    filters: { BallotCast: () => ({}) },
  }),
  getReadProvider: () => ({}),
}));

vi.mock('./logs', async () => ({
  // The real one: these tests are about reading events, and stubbing the
  // decode would leave the project's only cast unexercised.
  ...(await vi.importActual<typeof import('./logs')>('./logs')),
  queryLogsFrom: async (election: { address: string }) =>
    (ballotsIn.get(election.address) ?? []).map((tag, index) => ({
      args: { tag, index: BigInt(index), leaf: 0n, voteA: [0n, 1n], voteB: [], timestamp: 1_700_000_000n + BigInt(index) },
      transactionHash: `0xtx${index}`,
    })),
}));

vi.mock('./relay', () => ({
  ensureLocalRegistration: async () => {},
  relayEnroll: async () => ({ txHash: '0x' }),
  relayVote: async () => ({ txHash: '0x' }),
}));

beforeEach(() => {
  remembered.length = 0;
  ballotsIn.clear();
});

describe('what a passkey unlock leaves behind', () => {
  it('writes down the tag of the latest ballot it finds', async () => {
    ballotsIn.set('0xvoted', [tagAt(0n)]);
    const { fetchVoteHistory } = await import('./voting');

    const entries = await fetchVoteHistory([
      { contractAddress: '0xvoted', title: 'Voted here', phase: 'closed' },
      { contractAddress: '0xskipped', title: 'Skipped', phase: 'closed' },
    ]);

    expect(entries.map(e => e.electionId)).toEqual(['0xvoted']);
    expect(remembered).toEqual([['0xvoted', tagAt(0n)]]);
  });

  it('writes nothing for an election the voter skipped', async () => {
    ballotsIn.set('0xa', [999n]); // somebody else's ballot
    const { fetchVoteHistory } = await import('./voting');

    await fetchVoteHistory([
      { contractAddress: '0xa', title: 'A', phase: 'closed' },
      { contractAddress: '0xb', title: 'B', phase: 'closed' },
    ]);

    expect(remembered).toHaveLength(0);
  });
});

describe('a voter reading their own chain', () => {
  it("counts their own ballots, whoever else voted in between, and ends at the last", async () => {
    ballotsIn.set('0xe', [tagAt(0n), 111n, tagAt(1n), 222n, tagAt(2n)]);
    const { fetchVoteHistory } = await import('./voting');

    const [entry] = await fetchVoteHistory([{ contractAddress: '0xe', title: 'E', phase: 'active' }]);

    expect(entry.voteCount).toBe(3);
    expect(entry.referenceNumber).toBe('0xtx4');
    expect(entry.tag).toBe(`0x${tagAt(2n).toString(16)}`);
  });
});
