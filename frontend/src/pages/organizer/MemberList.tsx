import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, Users, Filter, Search, X } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { SelectMenu } from '../../components/ui/SelectMenu';
import { Spinner } from '../../components/ui/Spinner';
import { Badge } from '../../components/ui/Badge';
import { CommitmentFingerprint } from '../../components/ui/CommitmentFingerprint';
import { LoadMore } from '../../components/ui/LoadMore';
import { ELECTIONS } from '../../data/seed';
import { usePageLimit } from '../../hooks/usePageLimit';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { isChainConfigured } from '../../lib/deployments';
import {
  fetchElectionDigests,
  fetchElectionMembers,
  fetchOrganizerElectionAddresses,
} from '../../lib/chainElections';
import { roleAccent } from '../../lib/activeRole';

interface Member {
  id: string;
  commitment: string;
  enrolledAt?: Date;
  electionId: string;
  electionTitle: string;
  /** Undefined on-chain (anonymity): cannot be linked to a commitment. */
  hasVoted?: boolean;
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

/** Rows per page. Denser than a card list, so more of them fit on a screen. */
const MEMBER_PAGE_SIZE = 25;

export default function MemberList() {
  const { t } = useTranslation();
  const live = isChainConfigured();
  const wallet = useOrganizerWallet();
  const [query, setQuery] = useState('');
  // "View members" from an election arrives as ?election=<id>. Seeding the
  // filter from the URL is what makes that link mean anything; defaulting to
  // 'all' silently dropped the caller's intent and showed every election.
  const [searchParams, setSearchParams] = useSearchParams();
  const electionFilter = searchParams.get('election') ?? 'all';

  // Kept in the URL rather than in local state so the filtered view is
  // shareable and survives a reload or a back navigation.
  const setElectionFilter = (value: string): void => {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (value === 'all') next.delete('election');
        else next.set('election', value);
        return next;
      },
      { replace: true },
    );
  };
  const [members, setMembers] = useState<Member[]>(live ? [] : SEED_MEMBERS);
  const [loading, setLoading] = useState(live);

  /**
   * The organizer's own elections, by NAME AND ADDRESS ONLY.
   *
   * All this screen wants from an election is a label for the dropdown and an
   * address to read enrolments from. It used to get that from the full election
   * list, which meant reading every election on the platform, in full, to fill
   * in a select box. The factory's `ElectionCreated` index answers whose they
   * are, and a digest is two calls instead of about eighteen.
   */
  const [elections, setElections] = useState<{ id: string; title: string }[]>(
    live ? [] : ELECTIONS.slice(0, 4).map(e => ({ id: e.id, title: e.title })),
  );

  useEffect(() => {
    if (!live) return; // seed elections are already the initial state
    const organizer = wallet.address;
    if (!organizer) return;
    let cancelled = false;
    void (async () => {
      try {
        const addresses = await fetchOrganizerElectionAddresses(organizer);
        const digests = await fetchElectionDigests(addresses);
        if (!cancelled) {
          setElections(digests.map(d => ({ id: d.contractAddress, title: d.title })));
        }
      } catch (e) {
        console.error('Could not read the elections for this organizer:', e);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [live, wallet.address]);

  // `loading` starts true in live mode, so no synchronous setState is needed here.
  useEffect(() => {
    if (!live) return; // seed members are already the initial state
    let cancelled = false;
    void (async () => {
      try {
        const lists = await Promise.all(
          elections.map(e => fetchElectionMembers(e.id, e.title)),
        );
        if (cancelled) return;
        setMembers(lists.flat().map((m, i) => ({ id: `${m.electionId}-${i}`, ...m })));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [live, elections]);

  const filtered = useMemo(() => {
    let list = members;
    if (electionFilter !== 'all') list = list.filter(m => m.electionId === electionFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(m => m.commitment.toLowerCase().includes(q));
    }
    return list;
  }, [members, query, electionFilter]);

  /**
   * Every member is read, and a page of them is drawn.
   *
   * The count in the header and the CSV are over the whole list on purpose: an
   * export that silently contained only the rows that happened to be on screen
   * would be the worst kind of wrong, since nothing about the file says so.
   */
  const { visible, hasMore, loadMore } = usePageLimit(
    filtered,
    MEMBER_PAGE_SIZE,
    `${electionFilter}|${query}`,
  );

  const exportCSV = () => {
    const rows = [
      ['Commitment', 'Election', 'Enrolled At'],
      ...filtered.map(m => [m.commitment, m.electionTitle, m.enrolledAt?.toISOString() ?? '']),
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
      <div className="max-w-3xl mx-auto pt-6 pb-24">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-start gap-2">
              <Users className={`w-5 h-5 shrink-0 mt-1.5 ${roleAccent('organizer')}`} />
              {t('members.title')}
            </h1>
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
              leftIcon={<Search className="w-4 h-4" />}
              /* A search with no way out: a commitment is 77 digits, so the
                 usual way to leave a filtered list was to select a field full
                 of them and delete it by hand. Same control the election
                 filters carry, on the one search that lacked it. */
              rightIcon={query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('common.clear')}
                  className="cursor-pointer p-2 -m-2 hover:text-on-surface transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : undefined}
            />
          </div>
          <div className="flex items-center gap-2 sm:w-64 min-w-0">
            <Filter className="w-4 h-4 text-on-surface-meta shrink-0" />
            <SelectMenu
              value={electionFilter}
              onChange={setElectionFilter}
              options={[
                { value: 'all', label: t('members.all_elections') },
                ...elections.map(e => ({ value: e.id, label: e.title })),
              ]}
            />
          </div>
        </Card>

        {/* Member list */}
        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="w-10 h-10 text-on-surface-meta mb-3" />
              <p className="text-sm text-on-surface-meta">{t('members.empty')}</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {visible.map(m => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors">
                  <CommitmentFingerprint value={m.commitment} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-on-surface truncate">{m.commitment}</p>
                    <p className="text-xs text-on-surface-meta truncate">{m.electionTitle}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {m.hasVoted !== undefined ? (
                      <Badge variant={m.hasVoted ? 'closed' : 'enrolling'}>
                        {m.hasVoted ? t('members.voted') : t('members.enrolled')}
                      </Badge>
                    ) : (
                      <Badge variant="enrolling">{t('members.enrolled')}</Badge>
                    )}
                    {m.enrolledAt && (
                      <p className="text-xs text-on-surface-meta mt-0.5">{m.enrolledAt.toLocaleDateString()}</p>
                    )}
                  </div>
                </div>
              ))}
              <LoadMore hasMore={hasMore} loading={false} onClick={loadMore} className="pb-4" />
            </div>
          )}
        </Card>
      </div>
    </PageLayout>
  );
}
