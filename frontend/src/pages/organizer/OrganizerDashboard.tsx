import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Vote, Users, TrendingUp, Settings } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { GasWidget } from '../../components/ui/GasWidget';
import { ELECTIONS } from '../../data/seed';

export default function OrganizerDashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const myElections = ELECTIONS.slice(0, 4);
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
          {/* Election table */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{t('dashboard.my_elections')}</CardTitle>
                <button type="button" className="text-xs text-primary hover:underline"
                  onClick={() => navigate('/organizer/elections/new')}>
                  {t('common.view_all')}
                </button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-white/5">
                  {myElections.map(e => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => navigate(`/organizer/election/${e.id}`)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-white/3 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{e.title}</p>
                        <p className="text-xs text-on-surface-meta">{e.totalEnrolled.toLocaleString()} enrolled · {e.castVotes.toLocaleString()} votes</p>
                      </div>
                      <Badge variant={e.phase as Parameters<typeof Badge>[0]['variant']} dot={e.phase === 'active' || e.phase === 'enrolling'}>
                        {t(`phase.${e.phase}`)}
                      </Badge>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-4">
            <GasWidget balanceMatic={2.5} estimatedVotesLeft={84} onDeposit={() => navigate('/organizer/gas')} />

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
                      className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors text-left text-sm text-on-surface-variant hover:text-on-surface"
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
    </PageLayout>
  );
}
