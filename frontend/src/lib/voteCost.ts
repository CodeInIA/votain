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
import { queryLogsFrom } from "./logs";

/** Used only when the chain has no ballot to learn from. */
export const VOTE_COST_FALLBACK = 0.03;

/** Selector of `relayVote`, the only relay this is about. */
const RELAY_VOTE = "0x";

export interface VoteCost {
  /** Native token per ballot, at today's gas price. */
  matic: number;
  /** False when nothing on chain could be measured and the fallback is in use. */
  measured: boolean;
  /** How many past ballots the figure rests on. */
  samples: number;
}

export const ASSUMED: VoteCost = {
  matic: VOTE_COST_FALLBACK,
  measured: false,
  samples: 0,
};

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
  await Promise.all(
    recent.map(async log => {
      try {
        const tx = await provider.getTransaction(log.transactionHash);
        if (!tx || !tx.data.startsWith(voteSelector)) return;
        const price = tx.gasPrice ?? 0n;
        if (price === 0n) return;
        const cost = (log as unknown as { args?: { cost?: bigint } }).args?.cost ?? 0n;
        if (cost > 0n) units.push(cost / price);
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
  const gasUnits = median(units);
  const capped = gasUnits > maxRelayGas ? maxRelayGas : gasUnits;
  const now = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
  const price = now > maxGasPrice ? maxGasPrice : now;
  if (price === 0n) return ASSUMED;

  return {
    matic: Number(capped * price) / 1e18,
    measured: true,
    samples: units.length,
  };
}
