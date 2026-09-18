import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bookmark, Compass } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { ElectionCard } from '../../components/ui/ElectionCard';
import { ElectionFilters } from '../../components/ui/ElectionFilters';
import { Spinner } from '../../components/ui/Spinner';
import { LoadMore } from '../../components/ui/LoadMore';
import { ListError } from '../../components/ui/ListError';
import { Button } from '../../components/ui/Button';
import { useElectionPages } from '../../hooks/useElectionPages';
import { usePageLimit } from '../../hooks/usePageLimit';
import { useElectionFilterParams } from '../../hooks/useElectionFilterParams';
import { useSavedElections } from '../../hooks/useSavedElections';
import { matchesQuery } from '../../lib/electionFilter';
import { sortElections } from '../../lib/electionSort';
import { syncSavedElections, type SavedRole } from '../../lib/savedElections';

/**
 * The elections this reader kept, whichever role they are wearing.
 *
 * WHY IT IS A PAGE AND NOT A FILTER, which it was twice: a chip in the
 * participation band, then a button in the toolbar. A saved list is not a
 * narrowing of the list you are looking at, it is a different list. The code
 * said so before the interface did, because "saved" resolves a different set
 * of ADDRESSES rather than filtering the ones in hand.
 *
 * ONE PAGE, TWO ROUTES. `/voter/saved` and `/organizer/saved` differ in which
 * list they read and which navigation they wear, and in nothing else. The two
 * lists are separate on purpose: the same human saves different things as
 * somebody taking part and as somebody running elections.
 *
 * WHY THE STATE FILTERS AND NOTHING ELSE. The panel's other bands are for
 * CHOOSING an election, and Discover is where choosing happens. What a reader
 * asks of a list they curated themselves is where each one stands now.
 *
 * AN ELECTION CAN BE HERE AND IN "MY ELECTIONS" AT ONCE, and that is not a
 * duplicate: the two answer different questions, "what am I taking part in"
 * and "what did I keep", and being enrolled in something you also saved is the
 * ordinary case.
 */
export default function SavedElections({ role }: { role: SavedRole }) {
  const { t } = useTranslation();
  const { isSaved, ids } = useSavedElections(role);
  const [filters, setFilters] = useElectionFilterParams();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { all: saved, loading, error, refresh } = useElectionPages({
    scope: 'saved',
    savedRole: role,
    hydrateAll: true,
    keep: e => isSaved(e.id),
  });

  /**
   * Bring the list here from wherever else it was changed, as the voter's own
   * screen does. It needs an unlocked identity and says nothing without one,
   * so opening a list never summons an authenticator.
   */
  useEffect(() => {
    void syncSavedElections().then(() => refresh());
    // Once per visit: `refresh` is stable, and re-running on every render
    // would turn a list into a poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byPhase = saved.filter(e => !filters.phase || e.phase === filters.phase);
  const needle = filters.query.trim().toLowerCase();
  const filtered = sortElections(byPhase.filter(e => matchesQuery(e, needle)), filters.sort);
  const { visible, hasMore, loadMore } = usePageLimit(
    filtered,
    undefined,
    `${filters.phase ?? ''}${filters.query}${filters.sort}`,
  );

  return (
    <PageLayout role={role} showNav>
      <div className="max-w-3xl mx-auto pt-6 pb-24">
        <div className="mb-6">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-start gap-2">
            <Bookmark className="w-5 h-5 text-primary shrink-0 mt-1.5" />
            {t('saved.title')}
          </h1>
          <p className="text-xs text-on-surface-meta mt-0.5">
            {ids.length} {t('saved.count')}
          </p>
        </div>

        {/* Nothing saved is the one case that stays bare: the screen is already
            saying there is nothing here, and a search box over it is furniture. */}
        {ids.length > 0 && (
          <div className="mb-4">
            <ElectionFilters
              value={filters}
              onChange={setFilters}
              open={filtersOpen}
              onToggleOpen={() => setFiltersOpen(open => !open)}
              searchPlaceholder={t('saved.search_placeholder')}
              groups={['status']}
            />
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : error ? (
          <ListError onRetry={() => void refresh()} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-4xl mb-3">🔖</span>
            {/* Two ways to be empty, and they need different sentences: hidden
                by a filter is not the same as never saved. */}
            {ids.length > 0 ? (
              <>
                <p className="text-on-surface-variant text-sm">{t('discover.empty_title')}</p>
                <p className="text-on-surface-meta text-xs mt-1">{t('discover.empty_desc')}</p>
              </>
            ) : (
              <>
                <p className="text-on-surface-variant text-sm">{t('saved.empty')}</p>
                <Link to="/discover">
                  <Button variant="ghost" className="mt-4 gap-2 rounded-2xl h-11">
                    <Compass className="w-4 h-4" />
                    {t('nav.discover')}
                  </Button>
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {/* A VOTER SEES THEIR OWN STANDING, an organizer does not.
                  Saved elections belong to other people, so for an organizer
                  the voter's buttons would offer something they cannot do,
                  while a voter may well be enrolled in what they saved and
                  should see the same badges as anywhere else. */}
              {visible.map(e => (
                <ElectionCard key={e.id} election={e} view={role === 'voter' ? 'voter' : 'public'} />
              ))}
            </div>
            <LoadMore hasMore={hasMore} loading={false} onClick={loadMore} />
          </>
        )}
      </div>
    </PageLayout>
  );
}
