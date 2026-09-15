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
  live: boolean;
  refresh: () => Promise<void>;
}

export function useElection(id: string | undefined): ElectionState {
  const live = isChainConfigured() && Boolean(id?.startsWith("0x"));
  const [chainElection, setChainElection] = useState<Election | undefined>();
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Seed lookup is a pure derivation of `id` — no state, no effect.
  const election = live ? chainElection : id ? getSeedElection(id) : undefined;

  useEffect(() => {
    if (!live || !id) return; // seed mode resolves synchronously above
    let cancelled = false;

    void (async () => {
      try {
        const data = await fetchElection(id);
        if (cancelled) return;
        setChainElection(data);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
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

  return { election, loading, error, live, refresh };
}
