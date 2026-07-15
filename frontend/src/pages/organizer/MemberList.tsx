import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Users, Filter } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Avatar } from '../../components/ui/Avatar';
import { ELECTIONS } from '../../data/seed';

interface Member {
  id: string;
  commitment: string;
  enrolledAt: Date;
  electionId: string;
  electionTitle: string;
  hasVoted: boolean;
}

const SEED_MEMBERS: Member[] = ELECTIONS.slice(0, 4).flatMap((e, ei) =>
  Array.from({ length: Math.min(e.totalEnrolled, 6) }, (_, i) => ({
    id: `${e.id}-m${i}`,
    commitment: `0x${(BigInt('0xdeadbeef') + BigInt(ei * 100 + i)).toString(16).padStart(40, '0')}`,
    enrolledAt: new Date(Date.now() - (i + 1) * 86_400_000),
    electionId: e.id,
    electionTitle: e.title,
    hasVoted: i < 3 && e.castVotes > 0,
  }))
);

export default function MemberList() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [electionFilter, setElectionFilter] = useState('all');

  const elections = useMemo(() => ELECTIONS.slice(0, 4), []);

  const filtered = useMemo(() => {
    let list = SEED_MEMBERS;
    if (electionFilter !== 'all') list = list.filter(m => m.electionId === electionFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(m => m.commitment.toLowerCase().includes(q));
    }
    return list;
  }, [query, electionFilter]);

  const exportCSV = () => {
    const rows = [
      ['Commitment', 'Election', 'Enrolled At', 'Has Voted'],
      ...filtered.map(m => [m.commitment, m.electionTitle, m.enrolledAt.toISOString(), String(m.hasVoted)]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'members.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-3xl mx-auto pt-4 pb-24">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">{t('members.title')}</h1>
            <p className="text-xs text-on-surface-meta mt-0.5">{filtered.length} {t('members.count')}</p>
          </div>
          <Button variant="ghost" className="gap-2 rounded-2xl" onClick={exportCSV}>
            <Download className="w-4 h-4" />
            {t('members.export_csv')}
          </Button>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              placeholder={t('members.search_placeholder')}
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 sm:w-64">
            <Filter className="w-4 h-4 text-on-surface-meta shrink-0" />
            <Select
              value={electionFilter}
              onChange={e => setElectionFilter(e.target.value)}
              options={[
                { value: 'all', label: t('members.all_elections') },
                ...elections.map(e => ({ value: e.id, label: e.title })),
              ]}
            />
          </div>
        </Card>

        {/* Member list */}
        <Card className="overflow-hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="w-10 h-10 text-on-surface-meta mb-3" />
              <p className="text-sm text-on-surface-meta">{t('members.empty')}</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filtered.map(m => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors">
                  <Avatar fallback={m.commitment.slice(2, 6).toUpperCase()} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-on-surface truncate">{m.commitment}</p>
                    <p className="text-xs text-on-surface-meta truncate">{m.electionTitle}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant={m.hasVoted ? 'closed' : 'enrolling'}>
                      {m.hasVoted ? t('members.voted') : t('members.enrolled')}
                    </Badge>
                    <p className="text-xs text-on-surface-meta mt-0.5">{m.enrolledAt.toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PageLayout>
  );
}
