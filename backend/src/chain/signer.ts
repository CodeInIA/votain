/**
 * One provider and one queue per hot wallet, for every transaction this server sends.
 *
 * WHY A QUEUE. The relayer and the registrar each sign with one key, and every
 * request used to build its own provider and wallet and ask the chain for the
 * next nonce. Two voters arriving in the same second were handed the same
 * nonce: one transaction went through and the other failed with "nonce too
 * low" or "replacement underpriced", for no fault of the voter. Submissions are
 * now made one at a time per key, in arrival order, with the nonce tracked
 * here, and only the wait for a receipt runs concurrently.
 *
 * WHY ONE PROVIDER. A `JsonRpcProvider` detects the network on first use, which
 * is a round trip, and each one holds its own polling state. Building one per
 * request paid that on every call and multiplied the load on the RPC endpoint.
 *
 * A failed submission resets the nonce from the chain, so a transaction that
 * never left cannot leave a gap that stalls every later one.
 */
import { FeeData, JsonRpcProvider, NonceManager, Wallet, parseUnits } from 'ethers';

/**
 * The most this server tips a validator per unit of gas, in gwei.
 *
 * WHY A CAP AT ALL. Amoy's blocks are nearly empty and take a 30 gwei tip, but
 * the few transactions in them come from bots paying 279 gwei, and that is what
 * `eth_maxPriorityFeePerGas` hands back as a suggestion. Taken as given, every
 * registration and every relayed vote paid five times what inclusion costs,
 * and the relayer, whose float has to cover gas limit times fee up front,
 * could not afford a single ballot on 0.1 POL.
 *
 * WHY 50. It is what `ElectionPaymaster` reimburses at most (`maxGasPrice`), so
 * a relayer paying more than this loses the difference on every vote it sends.
 * Raise both together if the network ever needs more.
 */
function maxTip(): bigint {
  return parseUnits(process.env.CHAIN_MAX_TIP_GWEI?.trim() || '50', 'gwei');
}

/** A provider whose fee suggestion never tips above `maxTip`. */
class CappedFeeProvider extends JsonRpcProvider {
  override async getFeeData(): Promise<FeeData> {
    const suggested = await super.getFeeData();
    const cap = maxTip();
    const tip = suggested.maxPriorityFeePerGas;
    if (tip === null || tip <= cap) return suggested;
    const block = await this.getBlock('latest');
    const base = block?.baseFeePerGas ?? 0n;
    return new FeeData(
      suggested.gasPrice !== null && suggested.gasPrice > base + cap ? base + cap : suggested.gasPrice,
      base * 2n + cap,
      cap,
    );
  }
}

let provider: { url: string; instance: JsonRpcProvider } | null = null;

/** The shared provider for `CHAIN_RPC_URL`, with its fee suggestion capped. */
export function chainProvider(): JsonRpcProvider {
  const url = process.env.CHAIN_RPC_URL;
  if (!url) throw new Error('CHAIN_RPC_URL not configured');
  if (provider?.url !== url) provider = { url, instance: new CappedFeeProvider(url) };
  return provider.instance;
}

interface Lane {
  signer: NonceManager;
  tail: Promise<unknown>;
}

const lanes = new Map<string, Lane>();

function laneFor(privateKey: string): Lane {
  const address = new Wallet(privateKey).address;
  let lane = lanes.get(address);
  if (!lane) {
    lane = { signer: new NonceManager(new Wallet(privateKey, chainProvider())), tail: Promise.resolve() };
    lanes.set(address, lane);
  }
  return lane;
}

/** The nonce-tracking signer for the key in `envVar`. */
export function signerFrom(envVar: string): NonceManager {
  const key = process.env[envVar];
  if (!key) throw new Error(`${envVar} not configured`);
  return laneFor(key).signer;
}

/**
 * Runs `submit` alone among the submissions signed with the key in `envVar`.
 *
 * `submit` should send and return the transaction, not wait for it: the next
 * one in line can go as soon as this one is in the mempool.
 */
export async function submitInTurn<T>(
  envVar: string,
  submit: (signer: NonceManager) => Promise<T>,
): Promise<T> {
  const key = process.env[envVar];
  if (!key) throw new Error(`${envVar} not configured`);
  const lane = laneFor(key);

  const run = lane.tail.then(async () => {
    try {
      return await submit(lane.signer);
    } catch (error) {
      lane.signer.reset();
      throw error;
    }
  });
  // The next submission waits for this one to settle, whatever its outcome.
  lane.tail = run.catch(() => undefined);
  return run;
}

/** For tests: forget every cached provider and signer. */
export function resetChainClients(): void {
  provider = null;
  lanes.clear();
}
