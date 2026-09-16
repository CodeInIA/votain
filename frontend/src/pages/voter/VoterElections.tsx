import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, KeyRound } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { ElectionCard } from '../../components/ui/ElectionCard';
import { endsSoon } from '../../lib/phase';
import { Spinner } from '../../components/ui/Spinner';
import { LoadMore } from '../../components/ui/LoadMore';
import { ListError } from '../../components/ui/ListError';
import { useElectionPages } from '../../hooks/useElectionPages';
import { usePageLimit } from '../../hooks/usePageLimit';
import { useVoterIdentity } from '../../hooks/useVoterIdentity';
import { useElectionFilterParams } from '../../hooks/useElectionFilterParams';
import { ElectionFilters } from '../../components/ui/ElectionFilters';
import { matchesQuery, PHASE_FILTERS } from '../../lib/electionFilter';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../lib/utils';
import { sortElections } from '../../lib/electionSort';
import { Button } from '../../components/ui/Button';
import { isChainConfigured } from '../../lib/deployments';
import type { ElectionPhase } from '../../data/seed';

/**
 * WHICH SLICE, as the same chips every other list uses.
 *
 * It was five generic pills in the app's one accent colour, covering four of
 * the eight phases: an election of theirs that was announced, waiting between
 * windows, being counted, voided or called off fell into none of them and could
 * only be found under "all". And the row said nothing about state, where the
 * cards under it say it in colour, so the same election was yellow in the list
 * and blue in the filter that selected it.
 *
 * `PHASE_FILTERS` is the whole set, in the order the contract moves through
 * them, and each chip wears its own phase's colour. Two extras sit with them:
 * everything, and the one slice that is about the reader rather than the
 * election.
 */
type Slice = { key: 'all' | 'voted' | ElectionPhase; labelKey: string };

const SLICES: Slice[] = [
  { key: 'all', labelKey: 'common.all' },
  ...PHASE_FILTERS.map(phase => ({ key: phase, labelKey: `phase.${phase}` })),
  { key: 'voted', labelKey: 'phase.voted' },
];

export default function VoterElections() {
  const { t } = useTranslation();

  const live = isChainConfigured();
  const { ready: identityReady, unlocking, unlock } = useVoterIdentity(live);
  /**
   * Read in full, drawn a page at a time.
   *
   * `enrolled` resolves through the `MemberEnrolled` index, so this reads the
   * elections this voter joined and no others: the screen used to hydrate every
   * election on the platform to find the three that were theirs. Since the set is
   * bounded by the voter's own participation it is read completely, which is what
   * keeps the count in the header and the "ending soon" warning exact. A voter
   * who is warned about none of their deadlines because the election was on the
   * second page has been failed by the feature.
   */
  const { all: myElections, loading, error, refresh } = useElectionPages({
    scope: 'enrolled',
    hydrateAll: true,
    keep: e => Boolean(e.isEnrolled || e.hasVoted),
  });

  // Snapshot the clock once at mount so render stays pure (the count doesn't
  // need second-by-second accuracy; Countdown handles the ticking).
  const [now] = useState(() => Date.now());

  /**
   * SEARCH AND ORDER, and not the panel behind the filter button.
   *
   * Those filters are for choosing an election to join: age, nationality,
   * voting rule, the two promises. Here the voter has already joined, and the
   * one axis they narrow by is which phase, which the tabs above do faster
   * than a panel could. What a growing list does need is a name to search for
   * and a way to put the soonest deadline first.
   *
   * In the query string like every other list, so stepping into an election
   * and back brings the search with it.
   */
  const [filters, setFilters] = useElectionFilterParams();
  const [filtersOpen, setFiltersOpen] = useState(false);

  /**
   * The chosen slice, IN THE URL with the rest of them.
   *
   * It used to be component state, so stepping into an election and back
   * landed on "all" however the list had been narrowed: the search survived
   * the trip and the phase beside it did not.
   */
  const slice: Slice['key'] = filters.votedOnly ? 'voted' : filters.phase ?? 'all';
  const selectSlice = (key: Slice['key']) =>
    setFilters({
      ...filters,
      phase: key === 'all' || key === 'voted' ? null : key,
      votedOnly: key === 'voted',
    });

  /**
   * SHOWN WHENEVER THERE IS A LIST, and not above some number of rows.
   *
   * It was above five, on the argument that a toolbar over two rows is
   * furniture. That argument loses to a worse cost: Discover and the
   * organizer's dashboard show this bar whatever the count, so a threshold
   * makes two of the four lists behave differently, by a rule nobody can see
   * and everybody has to learn. Empty is the one case that stays bare, where
   * the screen is already saying there is nothing here.
   */
  const worthSearching = myElections.length > 0;

  const byTab = myElections.filter(e => {
    if (slice === 'all') return true;
    if (slice === 'voted') return Boolean(e.hasVoted);
    return e.phase === slice;
  });
  // The query alone, because the panel that sets everything else is not
  // offered here: running the whole matcher would let a hand-written URL
  // narrow this list by rules the screen gives no way to see or clear.
  const needle = filters.query.trim().toLowerCase();
  const filtered = sortElections(byTab.filter(e => matchesQuery(e, needle)), filters.sort);
  // Switching tab or searching starts a different list, so it starts at the
  // first page.
  const { visible, hasMore, loadMore } = usePageLimit(filtered, undefined, slice + filters.query + filters.sort);

  const urgentCount = myElections.filter(e => endsSoon(e, now)).length;

  return (
    <PageLayout role="voter" showNav>
      <div className="max-w-3xl mx-auto pt-6 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">{t('voter_elections.title')}</h1>
            <p className="text-xs text-on-surface-meta mt-0.5">{myElections.length} {t('voter_elections.subtitle')}</p>
          </div>
          {urgentCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-error/10 border border-error/20 text-error text-xs font-semibold">
              <Bell className="w-3.5 h-3.5" />
              {t('voter_elections.urgent', { count: urgentCount })}
            </div>
          )}
        </div>

        {/* The same chips, the same colours and the same selected ring the
            filter panels use, so a phase looks the same wherever it is read.
            `all` is the one without a phase to wear, so it borrows the neutral
            surface the unselected chips sit on. */}
        {/* ONE SCROLLING ROW ON A PHONE, wrapped on a wide screen. Ten chips
            wrap into five lines at 390px, which is more header than list
            before anything is read; the same ten take two lines at desktop
            width, where wrapping shows the whole set at once. */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-none sm:flex-wrap sm:overflow-visible sm:pb-0">
          {SLICES.map(option => (
            <button
              key={option.key}
              type="button"
              onClick={() => selectSlice(option.key)}
              className="shrink-0 transition-all cursor-pointer"
            >
              {option.key === 'all' ? (
                <span
                  className={cn(
                    'inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold',
                    'bg-surface-high/50 text-on-surface-variant ring-1 ring-outline-variant/20',
                    slice === 'all' ? 'ring-2 ring-primary/40' : 'opacity-60 hover:opacity-100',
                  )}
                >
                  {t(option.labelKey)}
                </span>
              ) : (
                <Badge
                  variant={option.key as Parameters<typeof Badge>[0]['variant']}
                  dot={option.key === 'active' || option.key === 'enrolling'}
                  className={slice === option.key ? 'ring-2 ring-primary/40' : 'opacity-60 hover:opacity-100'}
                >
                  {t(option.labelKey)}
                </Badge>
              )}
            </button>
          ))}
        </div>

        {/* Search and order, above the list and below the tabs: the tabs pick
            which slice, this searches inside it. */}
        {worthSearching && (
          <div className="mb-4">
            <ElectionFilters
              value={filters}
              onChange={setFilters}
              open={filtersOpen}
              onToggleOpen={() => setFiltersOpen(open => !open)}
              searchPlaceholder={t('voter_elections.search_placeholder')}
              showFilterButton={false}
            />
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : error ? (
          <ListError onRetry={() => void refresh()} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-4xl mb-3">📋</span>
            <p className="text-on-surface-variant text-sm">{t('voter_elections.empty')}</p>
            {/* EMPTY CAN MEAN LOCKED. Each election holds a commitment derived
                from the voter's secret, so finding their own elections needs
                that secret: a browser that has not unlocked it reads an empty
                list and cannot tell that from having joined nothing. Offered
                rather than done on load, because opening the secret summons an
                authenticator, and that is not something to do to somebody who
                was only looking. */}
            {live && !identityReady && (
              <Button
                variant="ghost"
                className="mt-4 gap-2 rounded-2xl h-11"
                disabled={unlocking}
                onClick={() => { void unlock().then(() => refresh()); }}
              >
                <KeyRound className="w-4 h-4" />
                {unlocking ? t('common.loading') : t('election.check_enrolment')}
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {visible.map(e => (
                <ElectionCard key={e.id} election={e} view="voter" />
              ))}
            </div>
            {/* Nothing is being fetched: the whole set is already here and this
                only widens what is drawn, so it never shows a spinner. */}
            <LoadMore hasMore={hasMore} loading={false} onClick={loadMore} />
          </>
        )}
      </div>
    </PageLayout>
  );
}
