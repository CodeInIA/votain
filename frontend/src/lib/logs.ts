/**
 * Event-log reads that survive free-tier RPC limits.
 *
 * `Contract.queryFilter` defaults to the full chain (block 0 to latest). On
 * Amoy that is a ~45M block range, which most free endpoints reject outright:
 * drpc and publicnode both cap `eth_getLogs` at 10000 blocks, and they answer
 * with an error rather than a truncated result, so a naive call either throws
 * or (on endpoints that silently clamp) drops older events.
 *
 * Every query here starts at the deployment block from the manifest, then falls
 * back to fixed-size windows if the endpoint still refuses the range. That
 * keeps member lists, vote history and the tally correct on any provider.
 */
import type { Contract, EventLog, Log, Provider } from "ethers";
import { deploymentBlock } from "./deployments";

/// Range accepted by the strictest free tiers we target.
const MAX_RANGE = 10_000;

type EventFilter = Parameters<Contract["queryFilter"]>[0];

/**
 * Reads all matching events from the deployment block to the chain head.
 *
 * Tries a single wide query first (one round trip on endpoints that allow it),
 * and only pays for windowing when the provider rejects the range.
 */
export async function queryLogsFrom(
  contract: Contract,
  filter: EventFilter,
  fromBlock: number = deploymentBlock,
): Promise<(EventLog | Log)[]> {
  try {
    return await contract.queryFilter(filter, fromBlock);
  } catch (error: unknown) {
    if (!isRangeError(error)) throw error;
    return queryInWindows(contract, filter, fromBlock);
  }
}

/// Providers phrase the range rejection differently; match on the shared words
/// rather than on a single provider's wording.
function isRangeError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("block range") ||
    message.includes("range over") ||
    message.includes("ranges over") ||
    message.includes("more than 10000") ||
    message.includes("query returned more than") ||
    message.includes("log response size")
  );
}

async function queryInWindows(
  contract: Contract,
  filter: EventFilter,
  fromBlock: number,
): Promise<(EventLog | Log)[]> {
  const provider = contract.runner?.provider;
  if (!provider) throw new Error("Contract has no provider to read logs from");

  const head = await provider.getBlockNumber();
  const out: (EventLog | Log)[] = [];

  for (let start = fromBlock; start <= head; start += MAX_RANGE) {
    const end = Math.min(start + MAX_RANGE - 1, head);
    out.push(...(await contract.queryFilter(filter, start, end)));
  }

  // Windows are walked in ascending order, so the result already matches the
  // (blockNumber, logIndex) ordering callers rely on for insertion order.
  return out;
}

/**
 * The same read, but across every contract at once.
 *
 * `Contract.queryFilter` always pins the query to one address, which is right
 * when the question is about one election and wrong when it is about one VOTER:
 * "which elections did this commitment enrol in" is a single `eth_getLogs` on an
 * indexed topic, where asking each election in turn is one round trip per
 * election, which is the cost this whole layer exists to avoid.
 *
 * Callers must treat the result as untrusted: anything on the chain can emit an
 * event with this shape, so the addresses that come back are only candidates
 * until they are checked against the factory's own list.
 */
export async function queryTopicLogs(
  provider: Provider,
  topics: Array<string | null>,
  fromBlock: number = deploymentBlock,
): Promise<Log[]> {
  try {
    return await provider.getLogs({ topics, fromBlock, toBlock: "latest" });
  } catch (error: unknown) {
    if (!isRangeError(error)) throw error;
    const head = await provider.getBlockNumber();
    const out: Log[] = [];
    for (let start = fromBlock; start <= head; start += MAX_RANGE) {
      const end = Math.min(start + MAX_RANGE - 1, head);
      out.push(...(await provider.getLogs({ topics, fromBlock: start, toBlock: end })));
    }
    return out;
  }
}

/**
 * The decoded arguments of an event that was asked for by its own filter.
 *
 * WHY A CAST IS NEEDED AT ALL. `queryFilter` is typed `(Log | EventLog)[]`,
 * because a filter CAN match a log this contract's ABI cannot decode, and only
 * the decoded half carries `args`. Everything read through this module is
 * queried through a `contract.filters.X()` built from that same ABI, so the
 * decode has already happened and the union is wider than reality.
 *
 * WHY IT LIVES HERE. Six modules were each writing their own
 * `(e as unknown as { args: ... }).args`, in five different shapes and with the
 * reasoning written down in none of them. The cast is a fact about ethers, not
 * about elections or tallies, so it belongs next to the queries that produce
 * the logs and nowhere else.
 *
 * It THROWS on an undecoded log rather than returning empty arguments, because
 * every caller here is reading a value it is about to treat as a vote, a
 * member or an amount, and silently reading zero out of a log that could not be
 * parsed is how a tally goes quietly wrong. Callers that can tolerate one bad
 * entry already say so with a `try`.
 */
export function eventArgs<T>(log: Log | EventLog): T {
  const args = (log as EventLog).args;
  if (!args) {
    throw new Error(
      `Event log at ${log.blockNumber}#${log.index} carries no decoded arguments.`,
    );
  }
  return args as unknown as T;
}
