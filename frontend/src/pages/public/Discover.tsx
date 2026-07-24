import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { ElectionCard } from '../../components/ui/ElectionCard';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { useElections } from '../../hooks/useElections';
import { useAuth } from '../../contexts/AuthContext';
import { type ElectionPhase } from '../../data/seed';

const PHASE_FILTERS: ElectionPhase[] = ['enrolling', 'active', 'tallying', 'closed'];

export default function Discover() {
  const { t } = useTranslation();
  const { voterLoggedIn } = useAuth();
  const [query, setQuery]           = useState('');
  const [phase, setPhase]           = useState<ElectionPhase | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const { elections, loading }      = useElections();

  const filtered = useMemo(() => {
    return elections.filter(e => {
      const matchPhase = phase ? e.phase === phase : true;
      const matchQuery = query.trim()
        ? e.title.toLowerCase().includes(query.toLowerCase()) ||
          e.organizer.toLowerCase().includes(query.toLowerCase())
        : true;
      return matchPhase && matchQuery;
    });
  }, [elections, query, phase]);

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

        {/* Search + filter bar */}
        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <Input
              placeholder={t('discover.search_placeholder')}
              value={query}
              onChange={e => setQuery(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
              rightIcon={query ? (
                <button onClick={() => setQuery('')} className="cursor-pointer"><X className="w-4 h-4" /></button>
              ) : undefined}
            />
          </div>
          <Button
            onClick={() => setShowFilters(v => !v)}
            className="gap-2 h-11 px-4 rounded-2xl text-sm text-on-surface-variant hover:text-on-surface"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">{t('common.filter')}</span>
            {phase && <span className="w-2 h-2 rounded-full bg-primary" />}
          </Button>
        </div>

        {/* Phase filter chips */}
        {showFilters && (
          <div className="flex flex-wrap gap-2 mb-6">
            {PHASE_FILTERS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPhase(phase === p ? null : p)}
                className="transition-all cursor-pointer"
              >
                <Badge
                  variant={p}
                  dot={p === 'active' || p === 'enrolling'}
                  className={phase === p ? 'ring-2 ring-primary/40' : 'opacity-60 hover:opacity-100'}
                >
                  {t(`phase.${p}`)}
                </Badge>
              </button>
            ))}
          </div>
        )}

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
            {(query || phase) && (
              <button
                type="button"
                className="mt-4 text-sm text-primary hover:underline cursor-pointer"
                onClick={() => { setQuery(''); setPhase(null); }}
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
