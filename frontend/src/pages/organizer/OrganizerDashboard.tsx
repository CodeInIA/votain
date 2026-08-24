import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Vote, Users, TrendingUp, Settings } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { GasWidget } from '../../components/ui/GasWidget';
import { Spinner } from '../../components/ui/Spinner';
import { DomainBadge } from '../../components/ui/DomainBadge';
import { Modal } from '../../components/ui/Modal';
import { useElections } from '../../hooks/useElections';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import {
  getGasBalance,
  hasStoredOrganizerName,
  recoverOrganizerName,
  setOrganizerName,
} from '../../lib/organizer';
import { PULSE_PHASES } from '../../lib/phase';

/** Approximate native-token cost of one sponsored vote. */
const VOTE_COST = 0.03;

export default function OrganizerDashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { elections, loading, live } = useElections();
  const wallet = useOrganizerWallet();
  const [gasBalance, setGasBalance] = useState(live ? 0 : 2.5);
  // Set once the organizer has answered or dismissed the name prompt, so it
  // does not reopen on the next render.
  const [nameHandled, setNameHandled] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

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
  }, [live, wallet.address]);

  // Live: only elections created by the connected organizer. Seed: first few.
  const myElections = live
    ? elections.filter(e => e.organizerAddress.toLowerCase() === wallet.address?.toLowerCase())
    : elections.slice(0, 4);

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
  const [query, setQuery] = useState('');

  // The stat tiles above count EVERY election, not the filtered view: a search
  // box should narrow what you are looking at, not silently restate the totals.
  const visibleElections = query.trim()
    ? myElections.filter(e => {
        const needle = query.trim().toLowerCase();
        return (
          e.title.toLowerCase().includes(needle) ||
          (e.organizerDomain?.toLowerCase().includes(needle) ?? false)
        );
      })
    : myElections;

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
                <CardTitle>{t('dashboard.my_elections')}</CardTitle>
                {myElections.length > 0 && (
                  <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={t('dashboard.search_placeholder')}
                  />
                )}
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex justify-center py-10"><Spinner /></div>
                ) : myElections.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-on-surface-meta">{t('dashboard.no_elections')}</p>
                ) : visibleElections.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-on-surface-meta">{t('dashboard.no_matches')}</p>
                ) : (
                  <div className="divide-y divide-white/5">
                    {visibleElections.map(e => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => navigate(`/organizer/election/${e.id}`)}
                        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-white/3 transition-colors text-left cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-on-surface truncate">{e.title}</p>
                          {/* Was hardcoded English ("0 enrolled - 0 votes"), which
                              showed untranslated in every other locale. */}
                          <p className="text-xs text-on-surface-meta">
                            {e.totalEnrolled.toLocaleString()} {t('election.enrolled').toLowerCase()}
                            {' · '}
                            {e.castVotes.toLocaleString()} {t('election.votes_cast').toLowerCase()}
                          </p>
                          {e.organizerDomain && (
                            <div className="mt-1">
                              <DomainBadge
                                domain={e.organizerDomain}
                                organizerAddress={e.organizerAddress}
                              />
                            </div>
                          )}
                        </div>
                        <Badge variant={e.phase as Parameters<typeof Badge>[0]['variant']} dot={PULSE_PHASES.has(e.phase)}>
                          {t(`phase.${e.phase}`)}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-4 order-1 lg:order-2">
            <GasWidget
              balance={gasBalance}
              estimatedVotesLeft={Math.floor(gasBalance / VOTE_COST)}
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
