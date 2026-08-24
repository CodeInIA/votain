import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, SlidersHorizontal, X, Globe } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { ElectionCard } from '../../components/ui/ElectionCard';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { useElections } from '../../hooks/useElections';
import { useAuth } from '../../contexts/AuthContext';
import { type ElectionPhase } from '../../data/seed';
import { checkElectionDomain } from '../../lib/organizerDomains';

const PHASE_FILTERS: ElectionPhase[] = ['enrolling', 'active', 'tallying', 'closed'];

export default function Discover() {
  const { t } = useTranslation();
  const { voterLoggedIn } = useAuth();
  const [query, setQuery]           = useState('');
  const [phase, setPhase]           = useState<ElectionPhase | null>(null);
  const [domainOnly, setDomainOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const { elections, loading }      = useElections();

  const pairKey = (address: string, domain: string) => `${address.toLowerCase()}|${domain}`;

  // Verification is a live DNS answer, so it cannot be read off the election.
  // Resolved once per DISTINCT organizer/domain pair rather than per card: a
  // list is usually a handful of organizers, and the backend caches on top.
  const domainPairs = useMemo(() => {
    const seen = new Map<string, { address: string; domain: string }>();
    for (const e of elections) {
      if (!e.organizerDomain) continue;
      const key = pairKey(e.organizerAddress, e.organizerDomain);
      if (!seen.has(key)) seen.set(key, { address: e.organizerAddress, domain: e.organizerDomain });
    }
    return [...seen.entries()];
  }, [elections]);

  const [verifiedPairs, setVerifiedPairs] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const checked = await Promise.all(
        domainPairs.map(async ([key, p]) => {
          const result = await checkElectionDomain(p.address, p.domain);
          return [key, result.status === 'verified'] as const;
        }),
      );
      if (!cancelled) {
        setVerifiedPairs(new Set(checked.filter(([, ok]) => ok).map(([key]) => key)));
      }
    })();
    return () => { cancelled = true; };
  }, [domainPairs]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return elections.filter(e => {
      const matchPhase = phase ? e.phase === phase : true;
      const matchQuery = needle
        ? e.title.toLowerCase().includes(needle) ||
          e.organizer.toLowerCase().includes(needle) ||
          // Searching "gob.es" should find the elections published under it.
          (e.organizerDomain?.toLowerCase().includes(needle) ?? false)
        : true;
      const matchDomain = domainOnly
        ? !!e.organizerDomain && verifiedPairs.has(pairKey(e.organizerAddress, e.organizerDomain))
        : true;
      return matchPhase && matchQuery && matchDomain;
    });
  }, [elections, query, phase, domainOnly, verifiedPairs]);

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
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('common.clear')}
                  className="cursor-pointer hover:text-on-surface transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : undefined}
            />
          </div>
          <Button
            onClick={() => setShowFilters(v => !v)}
            className="gap-2 h-11 px-4 rounded-2xl text-sm text-on-surface-variant hover:text-on-surface"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">{t('common.filter')}</span>
            {/* Any active filter, not just the phase: with only the domain chip
                on, the collapsed bar gave no sign the list was being filtered. */}
            {(phase || domainOnly) && <span className="w-2 h-2 rounded-full bg-primary" />}
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

            {/* Only verified is offered, not its negative: "no verified domain"
                is the normal state for most organizers, so a chip for it would
                read as a category of suspicion rather than a filter. */}
            <button
              type="button"
              onClick={() => setDomainOnly(v => !v)}
              className="transition-all cursor-pointer"
            >
              <Badge
                variant="blockchain"
                className={domainOnly ? 'ring-2 ring-primary/40' : 'opacity-60 hover:opacity-100'}
              >
                <Globe className="w-3 h-3 shrink-0" />
                {t('discover.verified_domain')}
              </Badge>
            </button>
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
                onClick={() => { setQuery(''); setPhase(null); setDomainOnly(false); }}
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
