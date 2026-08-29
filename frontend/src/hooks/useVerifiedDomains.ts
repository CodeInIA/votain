/**
 * Live verification status for the domains an election list mentions.
 *
 * Domain control is not a property of an election: it is whatever DNS answers
 * right now, so it cannot be read off the chain and has to be asked for. This
 * resolves once per DISTINCT organizer and domain pair rather than once per
 * card, because a list is usually a handful of organizers and the backend
 * caches on top of that.
 *
 * KEYED ON CONTENT, NEVER ON ARRAY IDENTITY. Callers pass a list they derived
 * during render, `elections.filter(...)` for instance, which is a brand new
 * array every single time. Depending on that identity made the effect re-run on
 * every render, and since the effect sets state, each run caused the next: an
 * infinite loop that froze the page and fired a DNS request per turn. The
 * dependency is therefore a sorted, deduplicated string built from the pairs
 * themselves, which only changes when the domains actually do.
 *
 * The returned predicate is stable for the same reason: callers put it in
 * `useMemo` dependency lists, and a fresh function each render would make those
 * recompute forever too.
 */
import { useCallback, useEffect, useState } from 'react';
import { checkElectionDomain } from '../lib/organizerDomains';

interface DomainBearing {
  organizerAddress: string;
  organizerDomain?: string;
}

const SEPARATOR = '|';

const pairKey = (address: string, domain: string): string =>
  `${address.toLowerCase()}${SEPARATOR}${domain.toLowerCase()}`;

export function useVerifiedDomains(elections: DomainBearing[]): (e: DomainBearing) => boolean {
  // Built during render rather than memoised: it is a short string over a small
  // list, and memoising it would need the very array identity this exists to
  // avoid depending on. React compares the effect dependency by value, which is
  // the whole point.
  const keys = new Set<string>();
  for (const e of elections) {
    if (e.organizerDomain) keys.add(pairKey(e.organizerAddress, e.organizerDomain));
  }
  const pairsKey = [...keys].sort().join(String.fromCharCode(10));

  const [verified, setVerified] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Empty is handled here rather than by an early return, so the state is
      // only ever written from the async callback. Writing it synchronously in
      // the effect body is what cascading-render lint warns about, and the
      // guard is needed anyway: splitting an empty string yields one empty
      // entry, which would ask the backend about a domain that does not exist.
      const pairs = pairsKey ? pairsKey.split(String.fromCharCode(10)) : [];
      const checked = await Promise.all(
        pairs.map(async key => {
          const [address, domain] = key.split(SEPARATOR);
          const result = await checkElectionDomain(address, domain);
          return [key, result.status === 'verified'] as const;
        }),
      );
      if (!cancelled) setVerified(new Set(checked.filter(([, ok]) => ok).map(([key]) => key)));
    })();

    return () => { cancelled = true; };
  }, [pairsKey]);

  return useCallback(
    (election: DomainBearing): boolean =>
      !!election.organizerDomain &&
      verified.has(pairKey(election.organizerAddress, election.organizerDomain)),
    [verified],
  );
}
