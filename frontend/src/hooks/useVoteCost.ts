/**
 * What a ballot costs, read once and shared by every screen that quotes it.
 *
 * CACHED AT MODULE LEVEL on purpose. The figure is the same for the whole
 * platform and reading it costs a log query plus a handful of transaction
 * lookups: doing that separately in the gas screen, the dashboard, each
 * election card and the voter's page would be the same answer fetched five
 * times. It is also the kind of number that does not change between two
 * screens of one session.
 *
 * The cache is dropped on a full reload, which is the only moment the gas price
 * could have moved enough to matter for a figure quoted as "about".
 */
import { useEffect, useState } from 'react';
import { isChainConfigured } from '../lib/deployments';
import { fetchVoteCost, ASSUMED, type VoteCost } from '../lib/voteCost';

let shared: VoteCost | null = null;
let inFlight: Promise<VoteCost> | null = null;

/** Exposed for tests, which must not inherit another test's answer. */
export function resetVoteCostCache(): void {
  shared = null;
  inFlight = null;
}

export function useVoteCost(): VoteCost {
  const live = isChainConfigured();
  const [cost, setCost] = useState<VoteCost>(shared ?? ASSUMED);

  useEffect(() => {
    if (!live || shared) return;
    let cancelled = false;

    // One request even when five components mount at once.
    inFlight ??= fetchVoteCost().catch(() => ASSUMED);
    void inFlight.then(answer => {
      shared = answer;
      inFlight = null;
      if (!cancelled) setCost(answer);
    });

    return () => { cancelled = true; };
  }, [live]);

  return cost;
}
