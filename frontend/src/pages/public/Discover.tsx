import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLayout } from '../../components/layout/PageLayout';
import { ElectionCard } from '../../components/ui/ElectionCard';
import { Skeleton } from '../../components/ui/Skeleton';
import { useElections } from '../../hooks/useElections';
import { useVerifiedDomains } from '../../hooks/useVerifiedDomains';
import { useAuth } from '../../contexts/AuthContext';
import { ElectionFilters } from '../../components/ui/ElectionFilters';
import {
  matchesElectionFilter,
  isAnyFilterActive,
  EMPTY_FILTERS,
  type ElectionFilterState,
} from '../../lib/electionFilter';

export default function Discover() {
  const { t } = useTranslation();
  const { voterLoggedIn } = useAuth();
  const [filters, setFilters] = useState<ElectionFilterState>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const { elections, loading } = useElections();

  const isDomainVerified = useVerifiedDomains(elections);

  const filtered = useMemo(
    () => elections.filter(e => matchesElectionFilter(e, filters, isDomainVerified)),
    [elections, filters, isDomainVerified],
  );

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

        {/* Results */}
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
          </div>
        ) : (
          <>
            <p className="text-xs text-on-surface-meta mb-4">
              {t('discover.results_count', { count: filtered.length })}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(e => (
                <ElectionCard key={e.id} election={e} voterView={voterLoggedIn} />
              ))}
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}
