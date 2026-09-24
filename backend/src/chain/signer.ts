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
import { JsonRpcProvider, NonceManager, Wallet } from 'ethers';

let provider: { url: string; instance: JsonRpcProvider } | null = null;

/** The shared read provider for `CHAIN_RPC_URL`. */
export function chainProvider(): JsonRpcProvider {
  const url = process.env.CHAIN_RPC_URL;
  if (!url) throw new Error('CHAIN_RPC_URL not configured');
  if (provider?.url !== url) provider = { url, instance: new JsonRpcProvider(url) };
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
