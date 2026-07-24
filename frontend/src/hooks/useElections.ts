/**
 * Chain-aware elections data source.
 *
 * When contracts are deployed (deployment manifest or VITE_* addresses
 * present) the hooks read live on-chain data; otherwise they serve the
 * Phase A seed so the whole UI keeps working before the Amoy deployment.
 *
 * Seed data is derived synchronously (never stored in state) and the live fetch
 * lives entirely inside the effect, so no setState ever runs synchronously
 * during render or in an effect body.
 */
import { useCallback, useEffect, useState } from "react";
import { ELECTIONS, getElection as getSeedElection, type Election } from "../data/seed";
import { isChainConfigured } from "../lib/deployments";
import { fetchElection, fetchElections } from "../lib/chainElections";

interface ElectionsState {
  elections: Election[];
  loading: boolean;
  error: string | null;
  /** True when data comes from the chain instead of the local seed. */
  live: boolean;
  refresh: () => Promise<void>;
}

export function useElections(): ElectionsState {
  const live = isChainConfigured();
  const [chainElections, setChainElections] = useState<Election[]>([]);
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | null>(null);
  // Bumped by refresh() to re-run the fetch effect.
  const [reloadToken, setReloadToken] = useState(0);

  const elections = live ? chainElections : ELECTIONS;

  useEffect(() => {
    if (!live) return; // nothing to fetch in seed mode
    let cancelled = false;

    void (async () => {
      try {
        const data = await fetchElections();
        if (cancelled) return;
        setChainElections(data);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [live, reloadToken]);

  // Called from event handlers (never during render): show the spinner and
  // re-trigger the effect above.
  const refresh = useCallback(async () => {
    if (!live) return;
    setLoading(true);
    setReloadToken(t => t + 1);
  }, [live]);

  return { elections, loading, error, live, refresh };
}

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
