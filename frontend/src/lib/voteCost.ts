/**
 * What a sponsored ballot actually costs, asked of the chain.
 *
 * WHY THIS REPLACED A CONSTANT. Every "about 66 ballots are reserved" on the
 * site came from `0.03` written into a source file, and the same number was
 * written a second time into the deposit hint of all thirteen locales. It was a
 * guess about a figure the chain publishes, it never moved when the gas price
 * did, and a voter reading "enough for 66 ballots" was being told something
 * nobody had measured.
 *
 * HOW IT IS MEASURED. `VoteSponsored` carries the exact cost the relayer was
 * reimbursed, so the past is on chain in full. What it does not carry is the
 * gas price of the moment, which is what makes a cost from last week useless
 * today, so each sample is divided by its own transaction's price to recover the
 * GAS UNITS a ballot takes. Those barely move: the proof verification is the
 * same work every time. The estimate is then those units at today's price.
 *
 * ENROLMENTS ARE NOT BALLOTS, and the same event covers both, because
 * `_reimburse` emits it for every relay. An enrolment is a fraction of a vote,
 * so mixing them in would halve the answer. Each sample's transaction is read
 * and only the ones calling `relayVote` are kept.
 *
 * The fallback is the old constant, flagged so callers can say "assumed" rather
 * than "measured". A chain where nobody has voted yet cannot be asked.
 */
import { getPaymaster, getReadProvider } from "./contracts";
import { eventArgs, queryLogsFrom } from "./logs";

/**
 * Used only when the chain has no ballot to learn from. About a million gas,
 * what the E2E suite measures for a relayed ballot at the default circuit size,
 * at Polygon's 30 gwei floor.
 */
export const VOTE_COST_FALLBACK = 0.03;

/** Selector of `relayVote`, the only relay this is about. */
const RELAY_VOTE = "0x";

export interface VoteCost {
  /** Native token per ballot, at today's gas price, across every circuit size. */
  matic: number;
  /** False when nothing on chain could be measured and the fallback is in use. */
  measured: boolean;
  /** How many past ballots the figure rests on. */
  samples: number;
  /**
   * The same figure per circuit size (slots), where that size was measured.
   *
   * A ballot's cost grows with its circuit: a nine-slot ballot verifies half as
   * many public signals again as a five-slot one and adds twice the points to
   * the aggregate. One median across sizes quoted a six-option election about
   * fifty per cent more ballots than its reserve could pay for.
   */
  bySlots?: Record<number, number>;
}

export const ASSUMED: VoteCost = {
  matic: VOTE_COST_FALLBACK,
  measured: false,
  samples: 0,
};

/**
 * What one ballot costs in an election with `options` choices, blank included.
 *
 * The factory gives an election the smallest circuit it fits in, so the
 * smallest measured size that fits is the one its ballots use. A size nobody
 * has voted in yet is scaled from the nearest measured one, and only ever
 * upwards: a figure shown as "ballots paid for" errs towards enough.
 */
export function voteCostFor(cost: VoteCost, options: number | undefined): number {
  const sizes = Object.keys(cost.bySlots ?? {}).map(Number).sort((a, b) => a - b);
  if (!options || sizes.length === 0) return cost.matic;
  const fits = sizes.find(size => size >= options);
  if (fits !== undefined) return cost.bySlots![fits];
  const largest = sizes[sizes.length - 1];
  return cost.bySlots![largest] * (options / largest);
}

/** Most recent relays to look at. Enough to be steady, few enough to be cheap. */
const SAMPLE_SIZE = 12;

/**
 * The middle sample, not the mean.
 *
 * One relay submitted at a freak gas price would drag an average a long way,
 * and the figure this produces is shown to voters as a promise about how many
 * ballots are covered.
 */
function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2n
    : sorted[middle];
}

export async function fetchVoteCost(): Promise<VoteCost> {
  const paymaster = getPaymaster();
  const provider = getReadProvider();

  const events = await queryLogsFrom(paymaster, paymaster.filters.VoteSponsored());
  if (events.length === 0) return ASSUMED;

  const recent = events.slice(-SAMPLE_SIZE);
  const voteSelector = paymaster.interface.getFunction("relayVote")?.selector ?? RELAY_VOTE;

  const units: bigint[] = [];
  const unitsBySlots = new Map<number, bigint[]>();
  await Promise.all(
    recent.map(async log => {
      try {
        const tx = await provider.getTransaction(log.transactionHash);
        if (!tx || !tx.data.startsWith(voteSelector)) return;
        const price = tx.gasPrice ?? 0n;
        if (price === 0n) return;
        const cost = eventArgs<{ cost?: bigint }>(log).cost ?? 0n;
        if (cost <= 0n) return;
        units.push(cost / price);
        // The ballot carries two coordinates per slot, so its own calldata
        // says which circuit it was proved with.
        const slots = ballotSlots(paymaster.interface.parseTransaction({ data: tx.data })?.args[1]);
        if (slots) unitsBySlots.set(slots, [...(unitsBySlots.get(slots) ?? []), cost / price]);
      } catch {
        // One unreadable transaction is a smaller sample, not a failure.
      }
    }),
  );

  if (units.length === 0) return ASSUMED;

  const [feeData, maxGasPrice, maxRelayGas] = await Promise.all([
    provider.getFeeData(),
    paymaster.maxGasPrice() as Promise<bigint>,
    paymaster.maxRelayGas() as Promise<bigint>,
  ]);

  // The same two ceilings the contract applies when it pays, so the estimate
  // cannot promise more than a relay would ever be reimbursed.
  const now = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
  const price = now > maxGasPrice ? maxGasPrice : now;
  if (price === 0n) return ASSUMED;
  const toMatic = (samples: bigint[]): number => {
    const gasUnits = median(samples);
    const capped = gasUnits > maxRelayGas ? maxRelayGas : gasUnits;
    return Number(capped * price) / 1e18;
  };

  return {
    matic: toMatic(units),
    measured: true,
    samples: units.length,
    bySlots: Object.fromEntries([...unitsBySlots].map(([slots, samples]) => [slots, toMatic(samples)])),
  };
}

/** Circuit slots of a decoded `relayVote` ballot, or 0 when it cannot tell. */
function ballotSlots(ballot: unknown): number {
  const voteB = (ballot as { voteB?: ArrayLike<unknown> } | undefined)?.voteB;
  return voteB && voteB.length > 0 ? voteB.length / 2 : 0;
}
