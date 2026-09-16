/**
 * Elections, a page at a time, with the next page already in hand.
 *
 * WHY THIS EXISTS. Every list in the app (Discover, the voter's elections, the
 * organizer's dashboard, the member list) called `fetchElections()`, which
 * hydrates EVERY election on mount: one cheap call for the addresses and then
 * about eighteen per address. That is the expensive half, and it grew with the
 * number of elections ever created, not with what anyone was looking at.
 *
 * It was also capped in silence. `fetchElections(offset = 0, limit = 50)` was
 * called with no arguments, so election fifty-one simply did not exist for the
 * interface and nothing said so.
 *
 * TWO SEPARATE PROBLEMS, which is why this has a `scope`. Discover really does
 * show everyone's elections, so the only answer there is to read a page at a
 * time. The other lists show YOURS, and for those the chain already keeps an
 * index: `ElectionCreated` indexes the organizer, `MemberEnrolled` indexes the
 * voter's commitment. Asking those first turns "hydrate a thousand to find your
 * four" into "hydrate your four", which is both cheaper and exact, and exactness
 * is what lets the dashboard keep adding up totals that are true.
 *
 * WHY PAGINATION ALONE IS NOT ENOUGH, and this is the part a `.slice()` in a
 * component cannot solve. The lists also FILTER: a search box, a phase, a tab.
 * Fetching ten and then filtering yields an empty screen while the matches sit
 * unread further down. So the filter belongs here, and this keeps pulling until
 * it has enough MATCHES to fill the page.
 *
 * THE PREFETCH. It always works one page ahead of what it hands out, so
 * `loadMore` usually resolves from memory and reads as instant. The window is
 * deliberately two pages and not more: the point was to stop hydrating
 * everything, and a generous buffer walks straight back into that.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ELECTIONS, type Election } from '../data/seed';
import { isChainConfigured } from '../lib/deployments';
import {
  fetchElectionAddresses,
  fetchEnrolledElectionAddresses,
  fetchOrganizerElectionAddresses,
  hydrateElections,
} from '../lib/chainElections';
import { getStoredCommitment } from '../lib/semaphore';
// One page means the same thing whichever half of the pagination draws it.
import { DEFAULT_PAGE_SIZE } from './usePageLimit';

/**
 * Which elections the screen is about, which decides what gets read.
 *
 * `all` walks the factory. `mine` and `enrolled` ask the chain's own indexes
 * first, so they never read an election that was never going to be shown.
 */
export type ElectionScope = 'all' | 'mine' | 'enrolled';

export interface ElectionPagesOptions {
  scope?: ElectionScope;
  /**
   * Whose dashboard this is. Required by `mine`.
   *
   * The two empty values mean different things and the screen has to say which:
   * `undefined` is "the wallet has not answered yet", which waits, and `null` is
   * "there is no wallet", which is an empty list and not a spinner. Collapsing
   * them leaves a disconnected organizer watching a spinner that never stops.
   */
  organizer?: string | null;
  /**
   * Which of those elections this list shows: search, tab, phase. Called during
   * render, so it always reflects the filter as it is now.
   */
  keep?: (election: Election) => boolean;
  /**
   * What the filter depends on, as a string.
   *
   * Filtering happens on every render and needs no help. FETCHING does: when a
   * filter narrows, the page that was full may no longer be, and something has
   * to say "go find more". `keep` cannot be that something, because an inline
   * arrow is a new function on every render and would refetch forever.
   */
  filterKey?: string;
  pageSize?: number;
  /**
   * Read the whole scope, and page only what is DRAWN.
   *
   * For screens that add their elections up. A dashboard showing "1,204 voters
   * enrolled" over the first page only, with no hint that there are more, is
   * worse than a slow dashboard: it is a wrong number that looks right. Only
   * ever used with a scope that is already narrowed to one person's elections,
   * so "everything" means theirs.
   */
  hydrateAll?: boolean;
  /**
   * Which end of the creation order to read from.
   *
   * HERE AND NOT IN THE COMPONENT, which is the whole point. Every address is
   * known after one cheap call while the elections themselves are hydrated a
   * page at a time, so reversing the ADDRESS list makes "oldest first" exact
   * from the first page. Sorting the hydrated elections instead would put the
   * oldest of the twelve that happened to be read at the top and call it the
   * oldest there is.
   */
  order?: 'newest' | 'oldest';
}

export interface ElectionPagesState {
  /** Matching elections, newest first, up to what has been asked for. */
  elections: Election[];
  /**
   * Every match read so far, page limit ignored. What to add up, count and
   * search over; `elections` is only what to draw.
   */
  all: Election[];
  /** The first page is still coming. */
  loading: boolean;
  /** A further page is coming, with something already on screen. */
  loadingMore: boolean;
  /** Whether asking for more could yield anything. */
  hasMore: boolean;
  loadMore: () => void;
  /** Elections in scope before filtering, or null until known. */
  total: number | null;
  /** Nothing is left unread: counts over `all` are the real counts. */
  complete: boolean;
  error: string | null;
  live: boolean;
  refresh: () => Promise<void>;
}

/** Addresses hydrated per round of the fill loop. Independent of the page size. */
const CHUNK = 12;

async function resolveScope(scope: ElectionScope, organizer?: string | null): Promise<string[]> {
  if (scope === 'mine') {
    // The caller holds this back until the wallet answers; see `organizer`.
    return organizer ? fetchOrganizerElectionAddresses(organizer) : [];
  }
  if (scope === 'enrolled') {
    const commitment = getStoredCommitment();
    // No identity on this device means nothing to look up. Reading every
    // election to discover the same thing is a thousand calls to reach `[]`.
    return commitment === null ? [] : fetchEnrolledElectionAddresses(commitment);
  }
  return fetchElectionAddresses();
}

export function useElectionPages(options: ElectionPagesOptions = {}): ElectionPagesState {
  const {
    scope = 'all',
    organizer,
    keep,
    filterKey,
    hydrateAll = false,
    order = 'newest',
  } = options;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const live = isChainConfigured();
  /** `mine` cannot be resolved before the wallet says who "mine" is. */
  const waitingForScope = live && scope === 'mine' && organizer === undefined;

  /**
   * The filter as the fill loop sees it.
   *
   * Only for reading across an `await`, never for rendering: a ref lags a render
   * behind, and a search box filtered through one would show the results for the
   * previous keystroke.
   */
  const keepRef = useRef(keep);
  useEffect(() => {
    keepRef.current = keep;
  });

  const [addresses, setAddresses] = useState<string[] | null>(null);
  const [hydrated, setHydrated] = useState<Election[]>([]);
  const [consumed, setConsumed] = useState(0);
  const [want, setWant] = useState(pageSize);
  const [loading, setLoading] = useState(live);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const source = live ? hydrated : ELECTIONS;
  const matching = keep ? source.filter(keep) : source;
  const elections = matching.slice(0, want);

  const total = live ? (addresses?.length ?? null) : matching.length;
  const complete = live ? addresses !== null && consumed >= addresses.length : true;
  const hasMore = matching.length > want || !complete;

  // Resolving the scope: one cheap query, before anything is hydrated.
  useEffect(() => {
    if (!live || waitingForScope) return;
    let cancelled = false;

    void (async () => {
      try {
        const list = await resolveScope(scope, organizer);
        if (cancelled) return;
        // Every `fetchElection*Addresses` hands these back newest first, so
        // the other order is one reversal and the pager needs to know nothing
        // about it.
        setAddresses(order === 'oldest' ? [...list].reverse() : list);
        setHydrated([]);
        setConsumed(0);
        setError(null);
        // Nothing in scope resolves the screen here; the fill loop below would
        // never run and the spinner would never come down.
        if (list.length === 0) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [live, scope, organizer, waitingForScope, order, reloadToken]);

  // Filling the page: hydrate in chunks until there are enough MATCHES.
  useEffect(() => {
    if (!live || addresses === null || addresses.length === 0) return;
    let cancelled = false;

    void (async () => {
      try {
        const target = hydrateAll ? Number.POSITIVE_INFINITY : want + pageSize;
        let seen = consumed;
        let found = matching.length;
        const fresh: Election[] = [];

        while (found < target && seen < addresses.length) {
          const chunk = addresses.slice(seen, seen + CHUNK);
          const page = await hydrateElections(chunk);
          if (cancelled) return;
          seen += chunk.length;
          fresh.push(...page);
          const k = keepRef.current;
          found += k ? page.filter(k).length : page.length;
        }

        if (fresh.length > 0) setHydrated(prev => [...prev, ...fresh]);
        if (seen !== consumed) setConsumed(seen);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `matching` and `consumed` are read inside but must not re-trigger: the
    // effect writes them, and depending on them would loop. `want` asks for
    // more, `filterKey` says the target moved, `reloadToken` restarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, addresses, want, pageSize, hydrateAll, filterKey, reloadToken]);

  const loadMore = useCallback(() => {
    setWant(w => w + pageSize);
    setLoadingMore(true);
  }, [pageSize]);

  const refresh = useCallback(async () => {
    if (!live) return;
    setAddresses(null);
    setHydrated([]);
    setConsumed(0);
    setWant(pageSize);
    setLoading(true);
    setReloadToken(t => t + 1);
  }, [live, pageSize]);

  return {
    elections,
    all: matching,
    loading: loading || waitingForScope,
    loadingMore,
    hasMore,
    loadMore,
    total,
    complete,
    error,
    live,
    refresh,
  };
}
