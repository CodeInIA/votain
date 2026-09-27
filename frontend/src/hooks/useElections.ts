/**
 * One election, from the chain or from the seed.
 *
 * When contracts are deployed (deployment manifest or VITE_* addresses present)
 * this reads live on-chain data; otherwise it serves the Phase A seed so the
 * whole UI keeps working before the Amoy deployment.
 *
 * Seed data is derived synchronously (never stored in state) and the live fetch
 * lives entirely inside the effect, so no setState ever runs synchronously
 * during render or in an effect body.
 *
 * THE LIST LIVES IN `useElectionPages`, not here. This hook used to have a
 * sibling that fetched every election on mount, which is what each list screen
 * called; that is the cost the paging hook exists to remove, and leaving an
 * easier way to do the expensive thing is how it would grow back.
 */
import { useCallback, useEffect, useState } from "react";
import { getElection as getSeedElection, type Election } from "../data/seed";
import { isChainConfigured } from "../lib/deployments";
import { fetchElection } from "../lib/chainElections";

interface ElectionState {
  election: Election | undefined;
  loading: boolean;
  error: string | null;
  /**
   * The chain did not answer, as opposed to answering that there is no such
   * election. The two used to render the same "page not found", so a dropped
   * connection told a voter their election did not exist.
   */
  unreachable: boolean;
  live: boolean;
  refresh: () => Promise<void>;
}

/**
 * How long one read may take before it counts as unanswered.
 *
 * A request the RPC never answers leaves its promise pending for good, and the
 * page on a spinner with it: seen on the local chain when the proxy dropped a
 * connection mid-read, and a public endpoint does the same under load.
 */
export const ELECTION_READ_TIMEOUT_MS = 15_000;

/** Pause before the one automatic retry: long enough for a blip to pass. */
const RETRY_DELAY_MS = 1_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No answer from the chain in ${ms / 1000}s`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Whether a failed read means the address holds no election.
 *
 * An address with no contract answers every view with empty data, which ethers
 * reports as BAD_DATA (or CALL_EXCEPTION for a contract that is not an
 * election). Anything else is the connection failing, and is worth a retry.
 */
export function isNoSuchElection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "BAD_DATA" || code === "CALL_EXCEPTION";
}

export function useElection(id: string | undefined): ElectionState {
  const live = isChainConfigured() && Boolean(id?.startsWith("0x"));
  const [chainElection, setChainElection] = useState<Election | undefined>();
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Seed lookup is a pure derivation of `id` — no state, no effect.
  const election = live ? chainElection : id ? getSeedElection(id) : undefined;

  useEffect(() => {
    if (!live || !id) return; // seed mode resolves synchronously above
    let cancelled = false;

    const read = () => withTimeout(fetchElection(id), ELECTION_READ_TIMEOUT_MS);

    void (async () => {
      try {
        let data: Election;
        try {
          data = await read();
        } catch (first) {
          // One retry for a connection that failed, never for an address that
          // answered: a blip should not cost the reader a manual reload.
          if (isNoSuchElection(first) || cancelled) throw first;
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          if (cancelled) return;
          data = await read();
        }
        if (cancelled) return;
        setChainElection(data);
        setError(null);
        setUnreachable(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setUnreachable(!isNoSuchElection(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [live, id, reloadToken]);

  const refresh = useCallback(async () => {
    if (!live || !id) return;
    setLoading(true);
    setReloadToken(t => t + 1);
  }, [live, id]);

  return { election, loading, error, unreachable, live, refresh };
}
