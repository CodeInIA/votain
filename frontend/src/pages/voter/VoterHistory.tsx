import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Download } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { VOTER_HISTORY } from '../../data/seed';
import { useElections } from '../../hooks/useElections';
import { fetchVoteHistory } from '../../lib/voting';

interface HistoryRow {
  electionId: string;
  electionTitle: string;
  candidateName?: string; // hidden on-chain (anonymity)
  phase: string;
  date: Date;
  referenceNumber: string;
  nullifier: string;
}

export default function VoterHistory() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { elections, live } = useElections();

  const [rows, setRows] = useState<HistoryRow[]>(
    live ? [] : VOTER_HISTORY.map(v => ({ ...v })),
  );
  const [loading, setLoading] = useState(live);

  // `loading` starts true in live mode, so no synchronous setState is needed here.
  useEffect(() => {
    if (!live) return; // seed history is already the initial state
    let cancelled = false;
    void (async () => {
      try {
        const entries = await fetchVoteHistory(
          elections.map(e => ({
            contractAddress: e.contractAddress,
            title: e.title,
            phase: e.phase,
          })),
        );
        if (cancelled) return;
        setRows(entries.map(e => ({
          electionId: e.electionId,
          electionTitle: e.electionTitle,
          phase: e.phase,
          date: e.lastVoteAt,
          referenceNumber: e.referenceNumber,
          nullifier: e.nullifier,
        })));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [live, elections]);

  const handleExport = () => {
    const csv = [
      ['Election', 'Date', 'Reference', 'Nullifier'].join(','),
      ...rows.map(v => [
        `"${v.electionTitle}"`,
        v.date.toLocaleDateString(),
        v.referenceNumber,
        v.nullifier,
      ].join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'votain-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageLayout role="voter" showNav>
      <div className="max-w-3xl mx-auto pt-6 pb-24">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">{t('history.title')}</h1>
            <p className="text-xs text-on-surface-meta mt-0.5">{rows.length} {t('history.subtitle')}</p>
          </div>
          {rows.length > 0 && (
            <Button variant="ghost" size="sm" className="gap-2 rounded-full" onClick={handleExport}>
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">{t('history.export')}</span>
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-4xl mb-3">📜</span>
            <p className="text-on-surface-variant text-sm">{t('history.empty')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map(v => (
              <button
                key={v.referenceNumber}
                type="button"
                onClick={() => navigate(`/election/${v.electionId}/results`)}
                className="group flex items-center gap-4 p-4 rounded-2xl border border-white/5 bg-surface-low/30 backdrop-blur-xl hover:border-white/10 hover:bg-surface-low/40 transition-all text-left cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-on-surface line-clamp-1">{v.electionTitle}</p>
                  {v.candidateName && (
                    <p className="text-xs text-on-surface-meta mt-0.5">{v.candidateName}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant={v.phase as Parameters<typeof Badge>[0]['variant']} className="text-[10px]">
                      {t(`phase.${v.phase}`)}
                    </Badge>
                    <span className="text-xs text-on-surface-meta font-mono">{v.referenceNumber}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-on-surface-meta">{v.date.toLocaleDateString()}</p>
                  <ChevronRight className="w-4 h-4 text-on-surface-meta group-hover:text-on-surface transition-colors mt-1 ml-auto" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
