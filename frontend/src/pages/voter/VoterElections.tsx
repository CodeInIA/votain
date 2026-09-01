import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { ElectionCard } from '../../components/ui/ElectionCard';
import { endsSoon } from '../../lib/phase';
import { Spinner } from '../../components/ui/Spinner';
import { useElections } from '../../hooks/useElections';
import type { ElectionPhase } from '../../data/seed';

const TABS: { key: 'all' | ElectionPhase; labelKey: string }[] = [
  { key: 'all',       labelKey: 'common.all'       },
  { key: 'enrolling', labelKey: 'phase.enrolling'  },
  { key: 'active',    labelKey: 'phase.active'      },
  { key: 'voted',     labelKey: 'phase.voted'       },
  { key: 'closed',    labelKey: 'phase.closed'      },
];

export default function VoterElections() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'all' | ElectionPhase>('all');
  const { elections, loading } = useElections();

  // Snapshot the clock once at mount so render stays pure (the count doesn't
  // need second-by-second accuracy; Countdown handles the ticking).
  const [now] = useState(() => Date.now());

  const myElections = elections.filter(e => e.isEnrolled || e.hasVoted);
  const filtered = tab === 'all' ? myElections : myElections.filter(e => {
    if (tab === 'voted') return e.hasVoted;
    return e.phase === tab;
  });

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

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-none">
          {TABS.map(tab_ => (
            <button
              key={tab_.key}
              type="button"
              onClick={() => setTab(tab_.key)}
              className={[
                'shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all',
                tab === tab_.key
                  ? 'bg-primary/10 border-primary/30 text-primary-dim'
                  : 'bg-surface-low/30 border-outline-variant/20 text-on-surface-meta hover:text-on-surface',
              ].join(' ')}
            >
              {t(tab_.labelKey)}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-4xl mb-3">📋</span>
            <p className="text-on-surface-variant text-sm">{t('voter_elections.empty')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map(e => (
              <ElectionCard key={e.id} election={e} voterView />
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
