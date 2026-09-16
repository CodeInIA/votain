import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Vote, Users, TrendingUp, Settings } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { GasWidget } from '../../components/ui/GasWidget';
import { Spinner } from '../../components/ui/Spinner';
import { Modal } from '../../components/ui/Modal';
import { LoadMore } from '../../components/ui/LoadMore';
import { ListError } from '../../components/ui/ListError';
import { ElectionCard } from '../../components/ui/ElectionCard';
import { useElectionPages } from '../../hooks/useElectionPages';
import { usePageLimit } from '../../hooks/usePageLimit';
import { useElectionFilterParams } from '../../hooks/useElectionFilterParams';
import { ELECTIONS } from '../../data/seed';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { useVoteCost } from '../../hooks/useVoteCost';
import { useRefreshOnReturn } from '../../hooks/useRefreshOnReturn';
import {
  getGasBalance,
  hasStoredOrganizerName,
  recoverOrganizerName,
  setOrganizerName,
} from '../../lib/organizer';
import { ElectionFilters, ClearFilters } from '../../components/ui/ElectionFilters';
import { matchesElectionFilter } from '../../lib/electionFilter';
import { sortElections } from '../../lib/electionSort';
import { useVerifiedDomains } from '../../hooks/useVerifiedDomains';



/** What the dashboard shows with no chain configured. */
const SEED_ELECTIONS = ELECTIONS.slice(0, 4);

export default function OrganizerDashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const wallet = useOrganizerWallet();
  // In the address bar, so opening an election and pressing back comes home
  // to the list the organizer had narrowed rather than to all of them.
  const [filters, setFilters] = useElectionFilterParams();
  // Which end of the creation order the pager reads from. Declared up here
  // because the hook below takes it, and the rest of the filter state is only
  // needed further down.
  const sortOrder = filters.sort === 'oldest' ? 'oldest' : 'newest';
  // Measured from past relays; the widget below quotes it as votes remaining.
  const voteCost = useVoteCost();
  /**
   * This organizer's own elections, through the factory's own index.
   *
   * `ElectionCreated` indexes the organizer, so their elections can be asked for
   * by name instead of read out of the whole platform and filtered: this screen
   * used to hydrate every election anyone had ever created to show the four that
   * were yours. The address filter below stays anyway, because the index read
   * falls back to the full list when an endpoint refuses the log query, and a
   * dashboard must never show one organizer another's election.
   *
   * Read completely rather than a page at a time: the stat tiles add these up,
   * and a total over the first page is a wrong number that looks right. What is
   * paged is the list underneath, which is a drawing limit and nothing more.
   */
  const pages = useElectionPages({
    scope: 'mine',
    organizer: wallet.address ?? null,
    hydrateAll: true,
    keep: e => e.organizerAddress.toLowerCase() === wallet.address?.toLowerCase(),
    order: sortOrder,
  });
  const { loading, live, refresh, error } = pages;
  /**
   * Whether this organizer has any elections at all, as opposed to whether
   * any are in hand this instant.
   *
   * `total` is the size of the scope, settled by one cheap read before a
   * single election is hydrated, so it survives the moments when the list
   * itself is empty: a refresh, or a reorder that has to read from the other
   * end. The controls below used to key off the hydrated list, so those
   * moments took the filter bar away with the rows and left the organizer
   * looking at "no elections yet" on an account with thirty.
   */
  const hasAnyElections = live ? (pages.total ?? 0) > 0 : SEED_ELECTIONS.length > 0;
  const [gasBalance, setGasBalance] = useState(live ? 0 : 2.5);
  // Set once the organizer has answered or dismissed the name prompt, so it
  // does not reopen on the next render.
  const [nameHandled, setNameHandled] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  // This screen is where an organizer lands after signing somewhere else, so
  // it is the one most likely to be showing a state that no longer exists.
  useRefreshOnReturn(() => {
    void refresh();
    setReloadToken(n => n + 1);
  });

  // Real sponsored-gas balance for the connected organizer.
  useEffect(() => {
    if (!live || !wallet.address) return;
    const organizer = wallet.address;
    let cancelled = false;
    void (async () => {
      try {
        const { formatEther } = await import('ethers');
        const balance = await getGasBalance(organizer);
        if (!cancelled) setGasBalance(Number(formatEther(balance)));
      } catch (e) {
        console.error('Could not read gas balance:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [live, wallet.address, reloadToken]);

  // Live: only elections created by the connected organizer. Seed: first few.
  const myElections = live ? pages.all : SEED_ELECTIONS;

  // The display name lives in localStorage, so a new browser or a sign out
  // leaves it unset and the next election created would be labelled with the
  // placeholder. The chain already has the answer: it is snapshotted into every
  // election at creation, so read it back from the most recent one and only ask
  // when there is genuinely nothing to recover.
  //
  // The effect only writes to localStorage. Whether to ask is derived during
  // render instead, so nothing sets state from inside an effect.
  const recoverable = live && !loading && wallet.address ? recoverOrganizerName(myElections) : null;

  useEffect(() => {
    if (!live || loading || !wallet.address || hasStoredOrganizerName()) return;
    if (recoverable) setOrganizerName(recoverable);
  }, [live, loading, wallet.address, recoverable]);

  const askName =
    live && !loading && !!wallet.address && !nameHandled && !recoverable && !hasStoredOrganizerName();

  const saveName = (): void => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setOrganizerName(trimmed);
    setNameHandled(true);
  };
  const [showFilters, setShowFilters] = useState(false);
  const isDomainVerified = useVerifiedDomains(myElections);

  // The stat tiles above count EVERY election, not the filtered view: a search
  // box should narrow what you are looking at, not silently restate the totals.
  // Every ordering is exact here, unlike on Discover: `hydrateAll` means the
  // whole scope is read before anything is drawn, so "closing soonest" is the
  // soonest there is and not the soonest of the first page.
  const visibleElections = sortElections(
    myElections.filter(e => matchesElectionFilter(e, filters, isDomainVerified)),
    filters.sort,
  );
  // Narrowing the filters is a different list, so it starts at the first page.
  const { visible, hasMore, loadMore } = usePageLimit(
    visibleElections,
    undefined,
    JSON.stringify(filters),
  );

  const totalEnrolled = myElections.reduce((s, e) => s + e.totalEnrolled, 0);
  const totalVotes    = myElections.reduce((s, e) => s + e.castVotes, 0);
  const activeCount   = myElections.filter(e => e.phase === 'active').length;

  const STATS = [
    { icon: Vote,     value: myElections.length, labelKey: 'dashboard.total_elections', color: 'text-primary', bg: 'bg-primary/10' },
    { icon: TrendingUp, value: activeCount,       labelKey: 'dashboard.active',          color: 'text-success',  bg: 'bg-success/10' },
    { icon: Users,    value: totalEnrolled,        labelKey: 'dashboard.enrolled',        color: 'text-tertiary', bg: 'bg-tertiary/10' },
    { icon: Vote,     value: totalVotes,           labelKey: 'dashboard.votes_cast',      color: 'text-secondary', bg: 'bg-secondary/10' },
  ] as const;

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-5xl mx-auto pt-6 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">{t('dashboard.title')}</h1>
            <p className="text-xs text-on-surface-meta mt-0.5">{t('dashboard.subtitle')}</p>
          </div>
          <Button
            variant="gradient"
            className="rounded-full gap-2 px-5"
            onClick={() => navigate('/organizer/elections/new')}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">{t('dashboard.new_election')}</span>
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {STATS.map((s, i) => {
            const Icon = s.icon;
            return (
              <Card key={i} className="p-4">
                <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center mb-3`}>
                  <Icon className={`w-4.5 h-4.5 ${s.color}`} />
                </div>
                <p className="text-xl font-bold text-on-surface">{s.value.toLocaleString()}</p>
                <p className="text-xs text-on-surface-meta">{t(s.labelKey)}</p>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Election table. order-2 on mobile so the gas balance and quick
              actions sit above it; the list is long and would bury them. */}
          <div className="lg:col-span-2 order-2 lg:order-1">
            <Card>
              {/* No "view all" link: this list is already every election this
                  organizer has, and there is no fuller page to send them to. */}
              <CardHeader className="flex flex-col gap-3">
                {/* Clear shares the title's row, which is always drawn, so
                    choosing an order cannot add a row and push the list. */}
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>{t('dashboard.my_elections')}</CardTitle>
                  <ClearFilters value={filters} onChange={setFilters} />
                </div>
                {/* The same component Discover uses, not a copy of it. The two
                    had drifted: this list had the eligibility inputs but no
                    phase chips, so an organizer could not narrow by state at
                    all and had to learn a second set of rules. */}
                {hasAnyElections && (
                  <ElectionFilters
                    value={filters}
                    onChange={setFilters}
                    open={showFilters}
                    onToggleOpen={() => setShowFilters(v => !v)}
                    searchPlaceholder={t('dashboard.search_placeholder')}
                  />
                )}
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex justify-center py-10"><Spinner /></div>
                ) : error ? (
                  <ListError onRetry={() => void refresh()} />
                ) : !hasAnyElections ? (
                  <p className="px-5 py-8 text-center text-sm text-on-surface-meta">{t('dashboard.no_elections')}</p>
                ) : visibleElections.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-on-surface-meta">{t('dashboard.no_matches')}</p>
                ) : (
                  <div className="flex flex-col gap-3 px-5 pb-5">
                    {/* THE SAME CARD DISCOVER DRAWS, not a second rendering of
                        the same election.

                        This was a one-line row: title, "3 enrolled, 1 vote", a
                        phase pill and the requirement chips. Everything else
                        the organizer had decided about the election was
                        invisible until they opened it: the two promises they
                        cannot take back, the rule it is decided by, its next
                        deadline. Their own list told them less about their own
                        elections than the public listing told a stranger.

                        Reused rather than enriched in place, because enriching
                        in place is how the filter bar drifted: two copies of
                        the same idea, each learning half of what the other
                        knew. The card takes a `view` instead, so it can lead
                        to the organizer's panel and drop the organizer's own
                        name from every row. */}
                    {visible.map(e => (
                      <ElectionCard key={e.id} election={e} view="organizer" />
                    ))}
                    {/* Everything is already read; this only widens what is
                        drawn, so it never waits on the chain. */}
                    <LoadMore hasMore={hasMore} loading={false} onClick={loadMore} />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-4 order-1 lg:order-2">
            <GasWidget
              balance={gasBalance}
              estimatedVotesLeft={Math.floor(gasBalance / voteCost.matic)}
              onDeposit={() => navigate('/organizer/gas')}
            />

            <Card className="p-4">
              <h3 className="text-sm font-semibold text-on-surface mb-3">{t('dashboard.quick_actions')}</h3>
              <div className="flex flex-col gap-2">
                {[
                  { icon: Plus,     label: t('dashboard.new_election'), href: '/organizer/elections/new' },
                  { icon: Users,    label: t('dashboard.members'),       href: '/organizer/members' },
                  { icon: Settings, label: t('dashboard.gas'),           href: '/organizer/gas' },
                ].map(a => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.href}
                      type="button"
                      onClick={() => navigate(a.href)}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors text-left text-sm text-on-surface-variant hover:text-on-surface cursor-pointer"
                    >
                      <Icon className="w-4 h-4 text-on-surface-meta" />
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* First run on this browser with nothing to recover from the chain. */}
      <Modal
        open={askName}
        onClose={() => setNameHandled(true)}
        title={t('onboarding.name_title')}
        description={t('onboarding.name_desc')}
      >
        <Input
          value={nameDraft}
          onChange={e => setNameDraft(e.target.value)}
          placeholder={t('onboarding.name_placeholder')}
          maxLength={60}
          onKeyDown={e => { if (e.key === 'Enter') saveName(); }}
          className="mb-3"
        />
        <Button className="w-full" disabled={!nameDraft.trim()} onClick={saveName}>
          {t('common.save')}
        </Button>
      </Modal>
    </PageLayout>
  );
}
