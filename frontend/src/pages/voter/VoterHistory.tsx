import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Download, Copy, Check, ShieldCheck, Lock } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { VOTER_HISTORY, hasPublishedResults } from '../../data/seed';
import { useElections } from '../../hooks/useElections';
import { fetchVoteHistory, fetchLocalVoteHistory } from '../../lib/voting';
import { useVoterIdentity } from '../../hooks/useVoterIdentity';
import { shortenReference } from '../../lib/utils';

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
  const { ready: identityReady, unlocking, unlock } = useVoterIdentity(live);
  const [loading, setLoading] = useState(live);

  // `loading` starts true in live mode, so no synchronous setState is needed here.
  useEffect(() => {
    if (!live) return; // seed history is already the initial state
    // Both paths answer; they differ in reach. Without the identity this lists
    // the ballots this browser recorded when it cast them, which needs no
    // passkey because a nullifier is public. With it, every ballot anywhere.
    let cancelled = false;
    void (async () => {
      try {
        const targets = elections.map(e => ({
          contractAddress: e.contractAddress,
          title: e.title,
          phase: e.phase,
        }));
        const entries = identityReady
          ? await fetchVoteHistory(targets)
          : await fetchLocalVoteHistory(targets);
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
  }, [live, elections, identityReady]);

  const [copied, setCopied] = useState<string | null>(null);

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(null), 1500);
  };

  /**
   * Results only exist once they are published; before that, the election.
   *
   * Through `hasPublishedResults` rather than a list of phases written here,
   * which is the whole reason that helper exists: `closed` is necessary but not
   * sufficient, since an election can be closed with its tally still unpublished,
   * and a fourth copy of the rule would be a fourth thing to drift.
   */
  const destinationFor = (row: HistoryRow) => {
    const election = elections.find(e => e.id === row.electionId);
    return election && hasPublishedResults(election)
      ? `/election/${row.electionId}/results`
      : `/voter/election/${row.electionId}`;
  };

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
            {/* No count while the identity is locked: zero is not what is known,
                it is what cannot be looked up, and the sentence below already
                says so. */}
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
            {/* "You have not voted yet" is a claim, and without the identity it
                is one this page cannot make: it has only looked at what this
                browser wrote down. The note below the list says what it did
                look at, and that is the whole truth available here. */}
            {identityReady && (
              <p className="text-on-surface-variant text-sm">{t('history.empty')}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map(v => (
              <div
                key={v.referenceNumber}
                className="group flex items-center gap-4 p-4 rounded-2xl border border-white/5 bg-surface-low/30 backdrop-blur-xl hover:border-white/10 hover:bg-surface-low/40 transition-all"
              >
                {/* The row still opens something, but WHAT it opens depends on
                    whether there is anything to open. It used to send every
                    election to its results page, so a vote in an election still
                    running led to a screen whose only content was "no results
                    yet". Those go to the election instead, where the voter can
                    see where it stands and change their vote while they still
                    can. */}
                <button
                  type="button"
                  onClick={() => navigate(destinationFor(v))}
                  className="flex-1 min-w-0 text-left cursor-pointer"
                >
                  <p className="text-sm font-semibold text-on-surface line-clamp-1">{v.electionTitle}</p>
                  {v.candidateName && (
                    <p className="text-xs text-on-surface-meta mt-0.5">{v.candidateName}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant={v.phase as Parameters<typeof Badge>[0]['variant']} className="text-[10px]">
                      {t(`phase.${v.phase}`)}
                    </Badge>
                    <span className="text-xs text-on-surface-meta font-mono truncate">{shortenReference(v.referenceNumber)}</span>
                  </div>
                </button>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <p className="text-xs text-on-surface-meta">{v.date.toLocaleDateString()}</p>
                  <div className="flex items-center gap-1">
                    {/* A receipt nobody can copy is a receipt nobody can use.
                        Nothing on this page offered the reference in a form the
                        voter could hand to anyone. */}
                    <button
                      type="button"
                      onClick={() => copy(v.referenceNumber)}
                      aria-label={t('common.copy')}
                      title={t('common.copy')}
                      className="p-1.5 rounded-lg text-on-surface-meta hover:text-on-surface hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      {copied === v.referenceNumber
                        ? <Check className="w-3.5 h-3.5" />
                        : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/verify-receipt?ref=${encodeURIComponent(v.referenceNumber)}`)}
                      aria-label={t('history.verify')}
                      title={t('history.verify')}
                      className="p-1.5 rounded-lg text-on-surface-meta hover:text-on-surface hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-on-surface-meta group-hover:text-on-surface transition-colors" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Said whether or not anything was found, because both readings are
            incomplete in the same way and neither is safe to leave unqualified:
            an empty list here means "nothing from this device", and a full one
            may still be missing ballots cast elsewhere. */}
        {live && !identityReady && (
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <p className="text-xs text-on-surface-meta max-w-md">{t('history.partial_view')}</p>
            <Button variant="ghost" className="rounded-full px-6 gap-2" onClick={() => { setLoading(true); void unlock(); }} disabled={unlocking}>
              <Lock className="w-4 h-4" />
              {unlocking ? t('common.loading') : t('history.see_all')}
            </Button>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
