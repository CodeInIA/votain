import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLayout } from '../../components/layout/PageLayout';
import { ElectionCard } from '../../components/ui/ElectionCard';
import { Skeleton } from '../../components/ui/Skeleton';
import { LoadMore } from '../../components/ui/LoadMore';
import { useElectionPages } from '../../hooks/useElectionPages';
import { useVerifiedDomains } from '../../hooks/useVerifiedDomains';
import { useAuth } from '../../contexts/AuthContext';
import { ElectionFilters } from '../../components/ui/ElectionFilters';
import { usePageMeta } from '../../seo/usePageMeta';
import {
  matchesElectionFilter,
  isAnyFilterActive,
  EMPTY_FILTERS,
  type ElectionFilterState,
} from '../../lib/electionFilter';

/** Always true: the domain filter is applied after paging, not inside it. */
const IGNORE_DOMAINS = () => true;

export default function Discover() {
  const { t } = useTranslation();
  usePageMeta({ title: t('discover.title'), description: t('discover.subtitle') });
  const { voterLoggedIn } = useAuth();
  const [filters, setFilters] = useState<ElectionFilterState>(EMPTY_FILTERS);
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
  const { elections, all, loading, loadingMore, hasMore, loadMore, complete } = useElectionPages({
    keep: e => matchesElectionFilter(e, filters, IGNORE_DOMAINS),
    filterKey: JSON.stringify(filters),
  });

  const isDomainVerified = useVerifiedDomains(elections);

  const filtered = useMemo(
    () => (filters.domainOnly ? elections.filter(isDomainVerified) : elections),
    [elections, filters.domainOnly, isDomainVerified],
  );

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
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-52" />)}
          </div>
        ) : filtered.length === 0 ? (
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
            <p className="text-xs text-on-surface-meta mb-4">
              {exactCount
                ? t('discover.results_count', { count: all.length })
                : t('discover.results_partial', { shown: filtered.length })}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(e => (
                <ElectionCard key={e.id} election={e} voterView={voterLoggedIn} />
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
