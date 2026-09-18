import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchGasHistory } from './organizer';

/**
 * The gas tank's movement list.
 *
 * The longest list this app can produce: `VoteSponsored` fires once per
 * sponsored vote, so one election with two thousand voters leaves two thousand
 * rows. Every one of them used to cost its own block read, and a block that
 * could not be read used to be dated today.
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    deposits: [] as unknown[],
    withdrawals: [] as unknown[],
    sponsored: [] as unknown[],
    funded: [] as unknown[],
    released: [] as unknown[],
    /** Elections the factory says belong to this organizer. */
    mine: [] as string[],
    /** Every block number asked for, including repeats. */
    bloquesPedidos: [] as number[],
    bloqueFalla: false,
  },
}));

// The paymaster's filters are stubbed as the plain names of the three event
// kinds, so the log reader below can tell which one it was asked for.
vi.mock('./contracts', () => ({
  getFactory: () => ({}),
  getElection: () => ({}),
  getPaymaster: () => ({
    filters: {
      Deposited: () => 'deposits',
      Withdrawn: () => 'withdrawals',
      VoteSponsored: () => 'sponsored',
      ElectionFunded: () => 'funded',
      ReserveReleased: () => 'released',
    },
  }),
  getReadProvider: () => ({
    getBlock: async (n: number) => {
      estado.bloquesPedidos.push(n);
      if (estado.bloqueFalla) throw new Error('endpoint said no');
      return { timestamp: 1_700_000_000 + n * 10 };
    },
  }),
}));

vi.mock('./logs', async () => ({
  // The real one: these tests are about reading events, and stubbing the
  // decode would leave the project's only cast unexercised.
  ...(await vi.importActual<typeof import('./logs')>('./logs')),
  queryLogsFrom: async (_contract: unknown, filter: unknown) =>
    estado[filter as 'deposits' | 'withdrawals' | 'sponsored' | 'funded' | 'released'] ?? [],
}));

// `ElectionFunded` is indexed by election, not by organizer, so the reader has
// to know which elections are theirs before it can keep the right rows.
vi.mock('./chainElections', () => ({
  fetchOrganizerElectionAddresses: async () => estado.mine,
}));

/** One log as ethers hands it over, with only the fields the reader uses. */
const log = (blockNumber: number, field: 'amount' | 'cost', wei: bigint, hash: string) => ({
  args: { [field]: wei },
  transactionHash: hash,
  blockNumber,
});

// At the top level, not inside one describe: the second block below shares this
// state, and leaving the reset in the first one let its rows leak into tests
// that were asserting on an exact list.
beforeEach(() => {
  estado.deposits = [];
  estado.withdrawals = [];
  estado.sponsored = [];
  estado.funded = [];
  estado.released = [];
  estado.mine = [];
  estado.bloquesPedidos = [];
  estado.bloqueFalla = false;
});

describe('fetchGasHistory', () => {
  it('reads each block once, however many votes it sponsored', async () => {
    // Two hundred sponsored votes, mined across three blocks.
    estado.sponsored = Array.from({ length: 200 }, (_, i) =>
      log(500 + (i % 3), 'cost', 10_000_000_000_000_000n, `0x${i}`),
    );

    const movements = await fetchGasHistory('0xorg');

    expect(movements).toHaveLength(200);
    // The saving is the whole point: three reads, not two hundred.
    expect(estado.bloquesPedidos).toHaveLength(3);
    expect([...estado.bloquesPedidos].sort()).toEqual([500, 501, 502]);
    // And every movement still carries the time of its own block.
    const porHash = new Map(movements.map(m => [m.txHash, m.date?.getTime()]));
    expect(porHash.get('0x0')).toBe((1_700_000_000 + 5000) * 1000);
    expect(porHash.get('0x1')).toBe((1_700_000_000 + 5010) * 1000);
  });

  it('leaves an unreadable movement without a date instead of dating it today', async () => {
    estado.bloqueFalla = true;
    estado.sponsored = [log(9, 'cost', 1_000_000_000_000_000n, '0xaa')];

    const [movement] = await fetchGasHistory('0xorg');

    // The block read really was attempted, so this is the failure path and not
    // an empty list passing by accident.
    expect(estado.bloquesPedidos).toEqual([9]);
    // It used to fall back to `new Date()`, which on a list sorted by date put
    // a movement nobody could read at the top, looking like it had just been
    // made. In a financial history that is the worst available answer.
    expect(movement.date).toBeUndefined();
  });

  it('orders by the chain, not by a timestamp that can be missing or tied', async () => {
    estado.sponsored = [
      log(10, 'cost', 1n, '0xold'),
      log(30, 'cost', 1n, '0xnew'),
      log(20, 'cost', 1n, '0xmid'),
    ];

    const movements = await fetchGasHistory('0xorg');

    expect(movements.map(m => m.txHash)).toEqual(['0xnew', '0xmid', '0xold']);
  });

  it('signs the amounts by which way the money went', async () => {
    estado.deposits = [log(1, 'amount', 1_000_000_000_000_000_000n, '0xin')];
    estado.withdrawals = [log(2, 'amount', 500_000_000_000_000_000n, '0xout')];
    estado.sponsored = [log(3, 'cost', 10_000_000_000_000_000n, '0xvote')];

    const movements = await fetchGasHistory('0xorg');
    const byHash = Object.fromEntries(movements.map(m => [m.txHash, m.amount]));

    expect(byHash['0xin']).toBeCloseTo(1);
    expect(byHash['0xout']).toBeCloseTo(-0.5);
    expect(byHash['0xvote']).toBeCloseTo(-0.01);
  });
});

describe('gas committed to one election', () => {
  /** A funding log, which names the election rather than the organizer. */
  const funding = (blockNumber: number, election: string, wei: bigint, hash: string) => ({
    args: { amount: wei, election },
    transactionHash: hash,
    blockNumber,
  });

  it('shows money that went straight into an election', async () => {
    // Creating an election now sends the attached POL to that election's
    // reserve, so it no longer emits `Deposited`. Without this the history
    // would say nothing at all about the funds that left the wallet.
    estado.mine = ['0xMyElection'];
    estado.funded = [funding(5, '0xMyElection', 2_000_000_000_000_000_000n, '0xfund')];

    const [movement] = await fetchGasHistory('0xorg');

    expect(movement.type).toBe('reserved');
    expect(movement.amount).toBeCloseTo(2);
  });

  it('keeps out other organizers money', async () => {
    // The event is indexed by election, not by organizer, so every election's
    // funding comes back from the node and the wrong ones have to be dropped
    // here. Someone else topping up their own election is not a line in this
    // organizer's history.
    estado.mine = ['0xMyElection'];
    estado.funded = [
      funding(5, '0xMyElection', 1_000_000_000_000_000_000n, '0xmine'),
      funding(6, '0xSomeoneElses', 9_000_000_000_000_000_000n, '0xtheirs'),
    ];

    const movements = await fetchGasHistory('0xorg');

    expect(movements.map(m => m.txHash)).toEqual(['0xmine']);
  });

  it('matches an election however the address is cased', async () => {
    estado.mine = ['0xmyelection'];
    estado.funded = [funding(5, '0xMyElection', 1n, '0xmine')];

    expect(await fetchGasHistory('0xorg')).toHaveLength(1);
  });
});
