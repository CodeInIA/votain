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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ELECTIONS, type Election } from '../data/seed';
import { isChainConfigured } from '../lib/deployments';
import {
  fetchElectionAddresses,
  fetchEnrolledElectionAddresses,
  fetchOrganizerElectionAddresses,
  hydrateElections,
} from '../lib/chainElections';
import { getStoredCommitment, getStoredIdentity } from '../lib/semaphore';
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

// Shared empty values, so an untouched hook keeps the same identities across
// renders and the memos below do not recompute for nothing.
const EMPTY_MAP: ReadonlyMap<string, Election> = new Map();
const EMPTY_SET: ReadonlySet<string> = new Set();

async function resolveScope(scope: ElectionScope, organizer?: string | null): Promise<string[]> {
  if (scope === 'mine') {
    // The caller holds this back until the wallet answers; see `organizer`.
    return organizer ? fetchOrganizerElectionAddresses(organizer) : [];
  }
  if (scope === 'enrolled') {
    // BOTH, because the two eras of enrolment leave different leaves. The
    // secret derives this voter's commitment for anything that enrols
    // privately; the platform commitment answers for everything older. Neither
    // prompts: an identity that is not already unlocked stays locked, and the
    // list then falls back to whatever this device has derived before.
    return fetchEnrolledElectionAddresses(getStoredIdentity(), getStoredCommitment());
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

  /**
   * The scope's addresses in the order the chain layer gave them, which is
   * always newest first. Never reversed in place: `order` is applied below,
   * so flipping it is not a reason to ask the chain anything again.
   */
  const [addresses, setAddresses] = useState<string[] | null>(null);
  /**
   * What has been read, BY ADDRESS rather than as a list in arrival order.
   *
   * This is what makes reordering free. Progress used to be an index into the
   * address list plus an array in fetch order, and both are meaningless the
   * moment the list is walked from the other end: the only way to reorder was
   * to throw away every election already read and fetch them again, which is
   * exactly what the screens were doing, and why the list blinked out and
   * came back on every change of order.
   */
  const [byAddress, setByAddress] = useState<ReadonlyMap<string, Election>>(EMPTY_MAP);
  /**
   * Addresses already asked for, successful or not.
   *
   * Separate from the map on purpose: a read that fails leaves no election,
   * and counting only successes would make `complete` unreachable and offer
   * "load more" for ever.
   */
  const [attempted, setAttempted] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [want, setWant] = useState(pageSize);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  /** The scope in the order it is to be shown and read in. */
  const ordered = useMemo(() => {
    if (addresses === null) return null;
    return order === 'oldest' ? [...addresses].reverse() : addresses;
  }, [addresses, order]);

  /**
   * The longest fully read PREFIX of the ordered scope.
   *
   * A prefix and not "everything read so far", which is the subtle half. Flip
   * to oldest-first with only the newest pages read and those elections are
   * still in hand, but they belong at the BOTTOM now: listing them would put
   * the newest elections under a heading that says oldest. Stopping at the
   * first address nobody has read yet means what is shown is always the true
   * head of the list, just sometimes shorter than it will be.
   *
   * An address that was attempted and yielded nothing is stepped over rather
   * than stopped at: that read failed, and waiting for it would stall the
   * whole list behind one bad election.
   */
  const source = useMemo(() => {
    if (!live) return ELECTIONS;
    if (ordered === null) return [];
    const out: Election[] = [];
    for (const address of ordered) {
      const election = byAddress.get(address);
      if (election) out.push(election);
      else if (!attempted.has(address)) break;
    }
    return out;
  }, [live, ordered, byAddress, attempted]);

  const matching = keep ? source.filter(keep) : source;
  const elections = matching.slice(0, want);

  const total = live ? (addresses?.length ?? null) : matching.length;
  const complete = live ? addresses !== null && attempted.size >= addresses.length : true;
  const hasMore = matching.length > want || !complete;

  /**
   * Nothing to show yet and more still coming.
   *
   * Derived rather than a flag that something has to remember to lower. The
   * flag version was the other half of the blink: re-resolving the scope
   * emptied the list without raising it, so for a moment the screens had an
   * empty list and no reason given, and every one of them draws "no elections
   * found" for that.
   */
  const loading = live && !error && elections.length === 0 && !complete;

  // Resolving the scope: one cheap query, before anything is hydrated.
  useEffect(() => {
    if (!live || waitingForScope) return;
    let cancelled = false;

    void (async () => {
      try {
        const list = await resolveScope(scope, organizer);
        if (cancelled) return;
        // Stored as the chain gave them, newest first. `ordered` applies the
        // reader's choice, so this effect has no reason to run again when
        // that choice changes and no reason to discard what it has read.
        setAddresses(list);
        setByAddress(EMPTY_MAP);
        setAttempted(EMPTY_SET);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [live, scope, organizer, waitingForScope, reloadToken]);

  // Filling the page: hydrate in chunks until there are enough MATCHES.
  useEffect(() => {
    if (!live || ordered === null || ordered.length === 0) return;
    let cancelled = false;

    void (async () => {
      try {
        const target = hydrateAll ? Number.POSITIVE_INFINITY : want + pageSize;
        // Walked in the order being shown, skipping whatever a previous run
        // already asked for. After a change of order that is usually most of
        // the list, and on a screen that reads everything it is all of it, so
        // the loop does not run at all.
        const pending = ordered.filter(address => !attempted.has(address));
        let found = matching.length;
        let i = 0;
        // Keyed by the address that was ASKED FOR, not by a field of the
        // answer. `hydrateElections` returns one election per address in the
        // order it was given them, so the pairing is positional and the
        // pager never has to trust the reply to say which question it
        // answers.
        const fresh: [string, Election][] = [];
        const tried: string[] = [];

        while (found < target && i < pending.length) {
          const chunk = pending.slice(i, i + CHUNK);
          const page = await hydrateElections(chunk);
          if (cancelled) return;
          i += chunk.length;
          tried.push(...chunk);
          page.forEach((election, j) => fresh.push([chunk[j], election]));
          const k = keepRef.current;
          found += k ? page.filter(k).length : page.length;
        }

        if (fresh.length > 0) {
          setByAddress(prev => {
            const next = new Map(prev);
            for (const [address, election] of fresh) next.set(address, election);
            return next;
          });
        }
        if (tried.length > 0) {
          setAttempted(prev => {
            const next = new Set(prev);
            for (const address of tried) next.add(address);
            return next;
          });
        }
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingMore(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `matching` and `attempted` are read inside but must not re-trigger: the
    // effect writes them, and depending on them would loop. `ordered` covers
    // both the scope and the reader's order, `want` asks for more,
    // `filterKey` says the target moved, `reloadToken` restarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, ordered, want, pageSize, hydrateAll, filterKey, reloadToken]);

  const loadMore = useCallback(() => {
    setWant(w => w + pageSize);
    setLoadingMore(true);
  }, [pageSize]);

  const refresh = useCallback(async () => {
    if (!live) return;
    // Everything goes, which is the point: this is asked for when the screen
    // has reason to think what it holds is stale. `loading` follows on its
    // own now, because with nothing read and nothing complete it is true by
    // definition.
    setAddresses(null);
    setByAddress(EMPTY_MAP);
    setAttempted(EMPTY_SET);
    setWant(pageSize);
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
