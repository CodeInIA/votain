import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLayout } from '../../components/layout/PageLayout';
import { ElectionCard } from '../../components/ui/ElectionCard';
import { Skeleton } from '../../components/ui/Skeleton';
import { Spinner } from '../../components/ui/Spinner';
import { LoadMore } from '../../components/ui/LoadMore';
import { ListError } from '../../components/ui/ListError';
import { useElectionPages } from '../../hooks/useElectionPages';
import { useVerifiedDomains } from '../../hooks/useVerifiedDomains';
import { useAuth } from '../../contexts/AuthContext';
import { ElectionFilters, ClearFilters } from '../../components/ui/ElectionFilters';
import { usePageMeta } from '../../seo/usePageMeta';
import { useElectionFilterParams } from '../../hooks/useElectionFilterParams';
import {
  matchesElectionFilter,
  isAnyFilterActive,
  EMPTY_FILTERS,
} from '../../lib/electionFilter';
import { sortElections, sortNeedsEverything } from '../../lib/electionSort';

/** Always true: the domain filter is applied after paging, not inside it. */
const IGNORE_DOMAINS = () => true;

export default function Discover() {
  const { t } = useTranslation();
  usePageMeta({ title: t('discover.title'), description: t('discover.subtitle') });
  const { voterLoggedIn } = useAuth();
  // In the address bar, so opening an election and pressing back comes home
  // to the list the reader had narrowed rather than to all of them.
  const [filters, setFilters] = useElectionFilterParams();
  const [showFilters, setShowFilters] = useState(false);

  /**
   * THE FILTERS GO INTO THE PAGING, all but one.
   *
   * Searching only what happens to be loaded would make the search box lie: type
   * an organizer's name and get "no elections found" because theirs are further
   * down and nothing asked for them. Handing the predicate to the hook is what
   * makes it keep reading until the page is full of MATCHES.
   *
   * The exception is the verified-domain filter, which is a live DNS answer
   * about rows that have already been read: putting it here would mean the fill
   * loop walks the entire chain the first time it runs, before a single answer
   * has come back, and finds nothing either way. So it stays below, and the
   * "load more" control is offered even on an empty result so a reader who
   * narrows the list down to nothing can still keep looking.
   */
  const { elections, all, loading, loadingMore, hasMore, loadMore, complete, error, refresh } =
    useElectionPages({
      keep: e => matchesElectionFilter(e, filters, IGNORE_DOMAINS),
      filterKey: JSON.stringify(filters),
      // Creation order is settled by which end of the address list the pager
      // walks, not by sorting what came back: see `order` on the hook.
      order: filters.sort === 'oldest' ? 'oldest' : 'newest',
    });

  const isDomainVerified = useVerifiedDomains(elections);

  const filtered = useMemo(() => {
    const kept = filters.domainOnly ? elections.filter(isDomainVerified) : elections;
    // A no-op for the two creation orders, which the pager has already
    // delivered. See `sortElections`.
    return sortElections(kept, filters.sort);
  }, [elections, filters.domainOnly, filters.sort, isDomainVerified]);

  /**
   * The order covers what has been read, not what exists.
   *
   * Said out loud because it cannot be fixed here. "Closing soonest" reads a
   * date that only exists once an election is hydrated, and this page hydrates
   * a page at a time on purpose, so an election closing in an hour can be
   * sitting unread below one closing in three days. The two creation orders
   * are exact at any point, because the pager walks the addresses from the
   * right end instead.
   */
  const partialOrder = !complete && sortNeedsEverything(filters.sort);

  /**
   * The grid that is already on screen, kept for the moment a reorder needs.
   *
   * WHY IT IS WORTH A REF. Asking for oldest-first with only the newest pages
   * read means the pager has nothing true to put at the head of the list yet,
   * so it reports itself as loading and this page drew skeletons. Skeletons
   * are `bg-surface-high/60` and a card is `bg-surface-low/30`: the brighter
   * thing replaced the darker one for about a fifth of a second, and a grid
   * that flashes pale and back reads as a flare, not as progress.
   *
   * So the cards stay put and dim slightly instead. They are the previous
   * order for that moment, which is a smaller lie than a blank grid and a
   * much smaller one than a flash: nothing here claims to be sorted yet, and
   * the list it is about to become is already being read.
   *
   * Written during render on purpose. An effect would set it one render late,
   * which is exactly the render the flash happens in.
   */
  const lastDrawn = useRef<typeof filtered>([]);
  if (filtered.length > 0) lastDrawn.current = filtered;
  /** A reorder settling over a grid that already has something in it. */
  const settling = loading && lastDrawn.current.length > 0;
  const shown = filtered.length > 0 ? filtered : lastDrawn.current;

  /**
   * Whether the number below is a total or a running tally.
   *
   * Two separate ways of not knowing. The chain may still have unread elections,
   * and the domain filter only knows about the rows already on screen, since the
   * answer is a DNS lookup made per row. Either one makes "24 elections" a claim
   * the page cannot support, and the honest form of an unfinished count is to say
   * that it is unfinished.
   */
  const exactCount = complete && !filters.domainOnly;

  return (
    <PageLayout role="public" showNav>
      <div className="max-w-5xl mx-auto pt-6 pb-24">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-2">
            {t('discover.title')}
          </h1>
          <p className="text-on-surface-variant text-sm">{t('discover.subtitle')}</p>
        </div>

        <ElectionFilters
          value={filters}
          onChange={setFilters}
          open={showFilters}
          onToggleOpen={() => setShowFilters(v => !v)}
          searchPlaceholder={t('discover.search_placeholder')}
        />

        {/* Results.
            Spaced off the filter panel rather than butting against it: the
            count is a statement ABOUT the filters, and with no gap it read as
            one more line of the panel, right under the clear button. */}
        <div className="mt-6">
        {loading && !settling ? (
          /* Only when there is genuinely nothing yet. A reorder over a full
             grid takes the branch below instead; see `settling`. */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-52" />)}
          </div>
        ) : error ? (
          /* A read that failed is not an empty result, and used to be reported
             as one: "no elections found", with a load-more button underneath
             that would fail the same way. */
          <ListError onRetry={() => void refresh()} />
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <span className="text-5xl mb-4">🗳️</span>
            <h2 className="text-xl font-bold text-on-surface mb-2">{t('discover.empty_title')}</h2>
            <p className="text-on-surface-variant text-sm max-w-xs">{t('discover.empty_desc')}</p>
            {/* Resets EVERY filter. The old version cleared three of them by
                name and silently left the age and nationality inputs on, so
                "clear filters" could leave the list still empty. */}
            {(filters.query || isAnyFilterActive(filters)) && (
              <button
                type="button"
                className="mt-4 text-sm text-primary hover:underline cursor-pointer"
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                {t('common.clear_filters')}
              </button>
            )}
            <LoadMore hasMore={hasMore} loading={loadingMore} onClick={loadMore} />
          </div>
        ) : (
          <>
            {/* The count says WHICH count it is. Discover pages a list that
                nobody's own activity bounds, so until the chain is exhausted
                the honest statement is "this many so far", not a total: a
                figure that looks final and is not is the kind of number people
                quote back at you. */}
            <p className="text-xs text-on-surface-meta mb-4 flex items-center gap-2">
              <span>
                {exactCount
                  ? t('discover.results_count', { count: all.length })
                  : t('discover.results_partial', { shown: shown.length })}
                {partialOrder && (
                  <>
                    {' · '}
                    {t('sort.partial_notice')}
                  </>
                )}
              </span>
              {/* Off the grid on purpose: the grid is what is being replaced,
                  and anything animating inside it competes with the
                  replacement.

                  The slot is always here, empty or not. Letting a 16px
                  spinner appear and vanish inside a 12px line made the line
                  grow and shrink, which pushed the whole grid down 28px and
                  back: the jolt moved out of the grid and straight into the
                  thing above it. A reserved box the size of the text means
                  nothing reflows. */}
              <span className="inline-flex w-3 h-3 shrink-0 items-center justify-center">
                {settling && <Spinner size="sm" className="w-3 h-3" />}
              </span>
              {/* On the count line, which is always here: it is a statement
                  about what the filters did, and undoing them belongs beside
                  it. Under the panel it added a row and shoved the results
                  down the moment an order was chosen. */}
              <ClearFilters value={filters} onChange={setFilters} className="ml-auto" />
            </p>
            {/* NOT DIMMED WHILE IT SETTLES, which the first attempt did.
                Fading to 60% and back takes 200ms each way and the new
                elections arrive in about the same time, so the fade out, the
                content swap and the fade in all landed on top of each other:
                one pulse of the whole grid at the same moment every card in
                it changed. Two things moving at once read as a jolt even
                when neither is wrong.

                So the grid holds completely still and the fact that
                something is happening is said beside the count instead. It
                is the one part of the page that is not the thing being
                replaced. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shown.map(e => (
                <ElectionCard key={e.id} election={e} view={voterLoggedIn ? 'voter' : 'public'} />
              ))}
            </div>
            <LoadMore hasMore={hasMore} loading={loadingMore} onClick={loadMore} />
          </>
        )}
        </div>
      </div>
    </PageLayout>
  );
}
