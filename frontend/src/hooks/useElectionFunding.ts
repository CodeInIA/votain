/**
 * Whether one election can pay for the ballots it is asking for.
 *
 * Voters here hold no wallet by design, so a relay that cannot be reimbursed is
 * not an inconvenience: the vote does not happen. Until now the only way to find
 * that out was to try, which on a phone means generating a proof first and being
 * told afterwards. This asks before.
 *
 * Two numbers, kept apart on purpose. The reserve is committed to this election
 * and the organizer cannot withdraw it. The free balance is real money that will
 * be spent if the reserve runs out, and is also money they can take back at any
 * moment. Only the first is a promise, so only the first is ever called one.
 */
import { useCallback, useEffect, useState } from 'react';
import { isChainConfigured } from '../lib/deployments';
import { getElectionFunding } from '../lib/organizer';

export interface ElectionFundingState {
  /** Native-token amounts, already converted from wei. */
  reserved: number;
  free: number;
  loading: boolean;
  /** The chain could not answer. Treated as "do not claim anything". */
  error: boolean;
  refresh: () => void;
}

export function useElectionFunding(election: string | undefined): ElectionFundingState {
  const live = isChainConfigured() && Boolean(election?.startsWith('0x'));
  const [reserved, setReserved] = useState(0);
  const [free, setFree] = useState(0);
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!live || !election) return;
    let cancelled = false;

    void (async () => {
      try {
        const { formatEther } = await import('ethers');
        const funding = await getElectionFunding(election);
        if (cancelled) return;
        setReserved(Number(formatEther(funding.reserved)));
        setFree(Number(formatEther(funding.free)));
        setError(false);
      } catch (e) {
        console.error('Could not read what is behind this election:', e);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [live, election, reloadToken]);

  const refresh = useCallback(() => setReloadToken(t => t + 1), []);

  return { reserved, free, loading, error, refresh };
}
