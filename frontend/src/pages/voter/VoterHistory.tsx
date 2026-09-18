import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Clock, Download, Copy, Check, ShieldCheck, Lock, Search, X, ArrowDown, ArrowUp } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { VOTER_HISTORY, hasPublishedResults } from '../../data/seed';
import { useElectionDigests } from '../../hooks/useElectionDigests';
import { fetchVoteHistory, fetchLocalVoteHistory } from '../../lib/voting';
import { useVoterIdentity } from '../../hooks/useVoterIdentity';
import { shortenReference } from '../../lib/utils';
import { formatDateTime } from '../../lib/datetime';
import { Input } from '../../components/ui/Input';
import { SelectMenu } from '../../components/ui/SelectMenu';
import { roleAccent } from '../../lib/activeRole';

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
  /**
   * The elections this voter enrolled in, as digests.
   *
   * Complete on purpose, like the receipt verifier: a ballot in an election that
   * was never loaded is a vote missing from your own history, which reads as a
   * vote that was lost. Narrowed by the chain's own enrolment index instead, so
   * completeness costs a fraction of what reading every election cost.
   */
  const { digests: elections, live } = useElectionDigests('enrolled');

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

  /**
   * SEARCH AND ORDER, in the query string.
   *
   * A row opens the election or its results, so the trip out and back has to
   * bring the search with it, the same way the other lists do. Two parameters
   * and no panel: a receipt has a name and a date, and there is nothing else
   * here to narrow by.
   */
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const oldestFirst = params.get('order') === 'oldest';

  const setSearch = (next: { q?: string; order?: string }) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    // Replace, so searching does not fill the back button with keystrokes.
    setParams(merged, { replace: true });
  };

  /**
   * SHOWN WHENEVER THERE IS A LIST. See `VoterElections`: a threshold makes
   * this screen behave unlike the other three, by a rule nobody can see.
   */
  const worthSearching = rows.length > 0;

  const needle = query.trim().toLowerCase();
  const shown = rows
    .filter(v =>
      v.electionTitle.toLowerCase().includes(needle) ||
      v.referenceNumber.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) =>
    oldestFirst ? a.date.getTime() - b.date.getTime() : b.date.getTime() - a.date.getTime(),
  );

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
    const election = elections.find(e => e.contractAddress === row.electionId);
    return election && hasPublishedResults(election)
      ? `/election/${row.electionId}/results`
      : `/election/${row.electionId}`;
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-start gap-2">
              <Clock className={`w-5 h-5 shrink-0 mt-1.5 ${roleAccent('voter')}`} />
              {t('history.title')}
            </h1>
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

        {worthSearching && !loading && (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="basis-full sm:basis-0 sm:flex-1 min-w-0">
              <Input
                placeholder={t('history.search_placeholder')}
                value={query}
                onChange={e => setSearch({ q: e.target.value })}
                leftIcon={<Search className="w-4 h-4" />}
                rightIcon={query ? (
                  <button
                    type="button"
                    onClick={() => setSearch({ q: '' })}
                    aria-label={t('common.clear')}
                    className="cursor-pointer p-2 -m-2 hover:text-on-surface transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : undefined}
              />
            </div>
            <SelectMenu
              value={oldestFirst ? 'oldest' : 'newest'}
              onChange={order => setSearch({ order: order === 'oldest' ? 'oldest' : '' })}
              options={[
                { value: 'newest', label: t('sort.newest'), icon: ArrowDown },
                { value: 'oldest', label: t('sort.oldest'), icon: ArrowUp },
              ]}
              label={t('discover.group_order')}
              labelHidden
              wrapperClassName="w-auto shrink-0"
              className="rounded-2xl px-4 h-11"
              contentClassName="w-max"
            />
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-4xl mb-3">📜</span>
            {/* A SEARCH THAT FINDS NOTHING IS NOT AN EMPTY HISTORY. This
                branch used to ask `rows`, the unfiltered list, so typing a
                word that matched no receipt fell through to the list below and
                drew nothing at all: a blank page with the search box still
                full. Asking `shown` catches both, and the two are told apart
                by whether there was anything to hide. */}
            {rows.length > 0 ? (
              <p className="text-on-surface-variant text-sm">{t('history.no_results')}</p>
            ) : (
              /* "You have not voted yet" is a claim, and without the identity
                 it is one this page cannot make: it has only looked at what
                 this browser wrote down. The note below the list says what it
                 did look at, and that is the whole truth available here. */
              identityReady && (
                <p className="text-on-surface-variant text-sm">{t('history.empty')}</p>
              )
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {shown.map(v => (
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
                  {/* WHEN THE BALLOT WAS RECORDED, to the minute, from the
                      block that carries it. The day alone answered almost
                      nothing a receipt is read for: two ballots in the same
                      election on the same day are a vote and the vote that
                      replaced it, and only the time tells them apart. Same
                      format as the schedule and the gas history. */}
                  <p className="text-xs text-on-surface-meta whitespace-nowrap" title={t('history.cast_at')}>
                    {formatDateTime(v.date)}
                  </p>
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
                    {/* A BUTTON NOW, which is what it always looked like.
                        It sat between two working ones, changed colour with
                        the row, and did nothing when pressed: the row opens
                        from its title, and on a touch screen there is no hover
                        to suggest that. It leads where the title leads. */}
                    <button
                      type="button"
                      onClick={() => navigate(destinationFor(v))}
                      aria-label={t('history.open')}
                      title={t('history.open')}
                      className="p-1.5 rounded-lg text-on-surface-meta hover:text-on-surface hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
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
