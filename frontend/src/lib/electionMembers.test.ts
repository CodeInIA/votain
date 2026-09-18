import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What a member list costs to read.
 *
 * An event carries the block it was mined in and no timestamp, so the date
 * beside each member is a second read. Doing that read per MEMBER is one round
 * trip each, and enrolments arrive in bursts that share a block: a hundred
 * members enrolled across four blocks used to cost a hundred requests for four
 * distinct answers.
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    eventos: [] as Array<{ blockNumber: number; args: { identityCommitment: bigint; index: bigint } }>,
    bloquesPedidos: [] as number[],
  },
}));

vi.mock('./contracts', () => ({
  getElection: () => ({ filters: { MemberEnrolled: () => ({}) } }),
  getFactory: () => ({}),
  getReadProvider: () => ({
    getBlock: async (n: number) => {
      estado.bloquesPedidos.push(n);
      return { timestamp: 1_700_000_000 + n };
    },
  }),
}));

vi.mock('./logs', async () => ({
  // The real one: these tests are about reading events, and stubbing the
  // decode would leave the project's only cast unexercised.
  ...(await vi.importActual<typeof import('./logs')>('./logs')),
  queryLogsFrom: async () => estado.eventos,
  queryTopicLogs: async () => [],
}));

describe('fetchElectionMembers', () => {
  beforeEach(() => {
    estado.bloquesPedidos = [];
    vi.resetModules();
  });

  it('reads each block once, however many members share it', async () => {
    estado.eventos = Array.from({ length: 100 }, (_, i) => ({
      blockNumber: 10 + (i % 4),
      args: { identityCommitment: BigInt(i + 1), index: BigInt(i) },
    }));

    const { fetchElectionMembers } = await import('./chainElections');
    const members = await fetchElectionMembers('0xelection', 'An election');

    expect(members).toHaveLength(100);
    expect([...estado.bloquesPedidos].sort()).toEqual([10, 11, 12, 13]);
    // Every member still has the date of their own block, not a shared one.
    expect(members[0].enrolledAt).toEqual(new Date((1_700_000_000 + 10) * 1000));
    expect(members[1].enrolledAt).toEqual(new Date((1_700_000_000 + 11) * 1000));
  });

  it('keeps the list when a block cannot be read', async () => {
    estado.eventos = [
      { blockNumber: 7, args: { identityCommitment: 1n, index: 0n } },
    ];
    vi.doMock('./contracts', () => ({
      getElection: () => ({ filters: { MemberEnrolled: () => ({}) } }),
      getFactory: () => ({}),
      getReadProvider: () => ({
        getBlock: async () => {
          throw new Error('endpoint said no');
        },
      }),
    }));

    const { fetchElectionMembers } = await import('./chainElections');
    const members = await fetchElectionMembers('0xelection', 'An election');

    // The enrolment is a fact of the chain; when it happened is a nicety, and
    // losing one provider's answer must not cost the organizer their members.
    expect(members).toHaveLength(1);
    expect(members[0].enrolledAt).toBeUndefined();
  });
});
