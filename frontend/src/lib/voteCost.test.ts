import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What a ballot costs, measured rather than assumed.
 *
 * Every "about 66 ballots are reserved" on the site used to rest on `0.03`
 * written into a source file, and on the same number written a second time into
 * the deposit hint of thirteen locales. This reads the chain instead.
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    eventos: [] as Array<{ args: { cost: bigint }; transactionHash: string }>,
    txs: {} as Record<string, { data: string; gasPrice: bigint } | null>,
    gasPrice: 1_000_000_000n,
    maxGasPrice: 200_000_000_000n,
    maxRelayGas: 2_000_000n,
  },
}));

/** Selectors the stub hands back, so a vote can be told from an enrolment. */
const VOTE = '0xaaaaaaaa';
const ENROL = '0xbbbbbbbb';

vi.mock('./contracts', () => ({
  getPaymaster: () => ({
    filters: { VoteSponsored: () => 'sponsored' },
    interface: { getFunction: () => ({ selector: VOTE }) },
    maxGasPrice: async () => estado.maxGasPrice,
    maxRelayGas: async () => estado.maxRelayGas,
  }),
  getReadProvider: () => ({
    getTransaction: async (hash: string) => estado.txs[hash] ?? null,
    getFeeData: async () => ({ gasPrice: estado.gasPrice, maxFeePerGas: estado.gasPrice }),
  }),
  getElection: () => ({}),
  getFactory: () => ({}),
}));

vi.mock('./logs', () => ({
  queryLogsFrom: async () => estado.eventos,
  queryTopicLogs: async () => [],
}));

/** One relay: `units` of gas at `price`, of the given kind. */
function relay(hash: string, units: bigint, price: bigint, selector = VOTE) {
  estado.eventos.push({ args: { cost: units * price }, transactionHash: hash });
  estado.txs[hash] = { data: selector + '0'.repeat(64), gasPrice: price };
}

describe('fetchVoteCost', () => {
  beforeEach(() => {
    estado.eventos = [];
    estado.txs = {};
    estado.gasPrice = 1_000_000_000n;
    estado.maxGasPrice = 200_000_000_000n;
    estado.maxRelayGas = 2_000_000n;
    vi.resetModules();
  });

  it('falls back, and says so, when nothing has been relayed', async () => {
    const { fetchVoteCost, VOTE_COST_FALLBACK } = await import('./voteCost');
    const cost = await fetchVoteCost();
    expect(cost.measured).toBe(false);
    expect(cost.matic).toBe(VOTE_COST_FALLBACK);
  });

  it('recovers the gas units and reprices them at today rate', async () => {
    // Three ballots of 300k gas, paid at 1 gwei back then.
    relay('0x1', 300_000n, 1_000_000_000n);
    relay('0x2', 300_000n, 1_000_000_000n);
    relay('0x3', 300_000n, 1_000_000_000n);
    // And gas is ten times dearer now.
    estado.gasPrice = 10_000_000_000n;

    const { fetchVoteCost } = await import('./voteCost');
    const cost = await fetchVoteCost();

    // A cost from last week is useless today: what is stable is the WORK, and
    // the proof verification is the same work every time.
    expect(cost.measured).toBe(true);
    expect(cost.samples).toBe(3);
    expect(cost.matic).toBeCloseTo((300_000 * 10_000_000_000) / 1e18);
  });

  it('leaves enrolments out, because they are not ballots', async () => {
    // The same event covers both relays, and an enrolment is a fraction of a
    // vote: counting them in would halve the answer.
    relay('0x1', 300_000n, 1_000_000_000n);
    relay('0x2', 60_000n, 1_000_000_000n, ENROL);
    relay('0x3', 60_000n, 1_000_000_000n, ENROL);

    const { fetchVoteCost } = await import('./voteCost');
    const cost = await fetchVoteCost();

    expect(cost.samples).toBe(1);
    expect(cost.matic).toBeCloseTo((300_000 * 1_000_000_000) / 1e18);
  });

  it('takes the middle sample, not the average', async () => {
    // One relay submitted at a freak price would drag a mean a long way, and
    // this figure is shown to voters as a promise about covered ballots.
    relay('0x1', 300_000n, 1_000_000_000n);
    relay('0x2', 310_000n, 1_000_000_000n);
    relay('0x3', 9_000_000n, 1_000_000_000n);

    const { fetchVoteCost } = await import('./voteCost');
    const cost = await fetchVoteCost();
    expect(cost.matic).toBeCloseTo((310_000 * 1_000_000_000) / 1e18);
  });

  it('never promises more than the contract would pay', async () => {
    // The two ceilings `_reimburse` applies: an estimate above either of them
    // would quote ballots a relayer could never be reimbursed for.
    relay('0x1', 9_000_000n, 500_000_000_000n);
    estado.gasPrice = 500_000_000_000n;
    estado.maxRelayGas = 2_000_000n;
    estado.maxGasPrice = 200_000_000_000n;

    const { fetchVoteCost } = await import('./voteCost');
    const cost = await fetchVoteCost();
    expect(cost.matic).toBeCloseTo((2_000_000 * 200_000_000_000) / 1e18);
  });

  it('survives a transaction it cannot read', async () => {
    relay('0x1', 300_000n, 1_000_000_000n);
    estado.eventos.push({ args: { cost: 1n }, transactionHash: '0xgone' });
    estado.txs['0xgone'] = null;

    const { fetchVoteCost } = await import('./voteCost');
    const cost = await fetchVoteCost();
    // A smaller sample, not a failure.
    expect(cost.samples).toBe(1);
    expect(cost.measured).toBe(true);
  });
});
