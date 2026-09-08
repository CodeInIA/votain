import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, CheckCircle, XCircle, Copy, Check, Lock } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { useAuth } from '../../contexts/AuthContext';
import { useElections } from '../../hooks/useElections';
import { findVoteReceipt, fetchVoteHistory, fetchLocalVoteHistory, type PublicReceipt } from '../../lib/voting';
import { useVoterIdentity } from '../../hooks/useVoterIdentity';
import { shortenReference } from '../../lib/utils';
import { usePageMeta } from '../../seo/usePageMeta';

/**
 * Checks one receipt against the chain. For ANYONE, not only its holder.
 *
 * This page used to search `VOTER_HISTORY`, the hardcoded demo data, so against
 * a real deployment it found nothing and always would. That made the app's one
 * public verification tool the only screen that never touched the chain, which
 * is a strange thing for a project whose claim is end-to-end verifiability.
 *
 * It stays deliberately unauthenticated and reachable without a session. The
 * whole value of publishing a nullifier is that a third party can check a
 * receipt somebody shows them; behind a login it would only ever tell voters
 * what their own history already tells them. Signed-in voters do get their own
 * receipts listed below as a shortcut, because nobody memorises a nullifier,
 * but that is a convenience layered on top and never a requirement.
 */

type ResultState = 'idle' | 'searching' | 'found' | 'not-found';

interface Shortcut {
  electionTitle: string;
  reference: string;
}

export default function VerifyReceipt() {
  const { t } = useTranslation();
  usePageMeta({ title: t('verify_receipt.title'), description: t('verify_receipt.subtitle') });
  const { voterLoggedIn } = useAuth();
  const { elections, live, loading } = useElections();
  const [params, setParams] = useSearchParams();

  const [ref, setRef] = useState(() => params.get('ref') ?? '');
  // Already searching when the page is opened from a link, so the effect below
  // has no synchronous state to set and the spinner is up on the first paint.
  const [state, setState] = useState<ResultState>(() => (params.get('ref') ? 'searching' : 'idle'));
  const [match, setMatch] = useState<PublicReceipt | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const { ready: identityReady, unlocking, unlock } = useVoterIdentity(live);

  const search = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      // Nothing to search until the election list is in: the lookup reads a
      // transaction against the elections it knows and scans their events for a
      // nullifier, so running it against an empty list answers "not found" to
      // every receipt, including the valid ones.
      if (!trimmed || elections.length === 0) return;
      setState('searching');
      const found = await findVoteReceipt(trimmed, elections).catch(() => null);
      setMatch(found);
      setState(found ? 'found' : 'not-found');
    },
    [elections],
  );

  // A link from the history arrives with the receipt already in it, so the
  // voter does not have to carry a nullifier from one screen to the other by
  // hand. It waits for the election list, which is what the lookup searches,
  // and runs once: the search rewrites the query string, which would otherwise
  // bring it straight back round.
  const autoSearched = useRef(false);
  useEffect(() => {
    const fromUrl = params.get('ref');
    if (!fromUrl || elections.length === 0 || autoSearched.current) return;
    autoSearched.current = true;
    void findVoteReceipt(fromUrl, elections)
      .catch(() => null)
      .then(found => {
        setMatch(found);
        setState(found ? 'found' : 'not-found');
      });
  }, [params, elections]);

  // The signed-in voter's own receipts, offered as buttons. Their identity
  // never leaves the browser: this is the same local computation the history
  // page does, and the page works identically without it.
  useEffect(() => {
    if (!voterLoggedIn || !live || elections.length === 0) return;
    let cancelled = false;
    void (async () => {
      // The device's own record needs no passkey, because a nullifier is a
      // public value this browser wrote down when it voted. Unlocking widens
      // the answer to ballots cast anywhere; it does not enable it.
      const targets = elections.map(e => ({
        contractAddress: e.contractAddress,
        title: e.title,
        phase: e.phase,
      }));
      const entries = await (identityReady
        ? fetchVoteHistory(targets)
        : fetchLocalVoteHistory(targets)
      ).catch(() => []);
      if (!cancelled) {
        setShortcuts(entries.map(e => ({ electionTitle: e.electionTitle, reference: e.referenceNumber })));
      }
    })();
    return () => { cancelled = true; };
  }, [voterLoggedIn, live, identityReady, elections]);

  const runSearch = () => {
    setParams(ref.trim() ? { ref: ref.trim() } : {}, { replace: true });
    void search(ref);
  };

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(null), 1500);
  };

  const row = (label: string, value: string, copyable = false) => (
    <div className="flex justify-between gap-3">
      <span className="text-on-surface-meta shrink-0">{label}</span>
      <span className="text-on-surface font-mono text-xs break-all text-right">
        {value}
        {copyable && (
          <button
            type="button"
            onClick={() => copy(value)}
            aria-label={t('common.copy')}
            className="ml-2 align-middle text-on-surface-meta hover:text-on-surface transition-colors cursor-pointer"
          >
            {copied === value
              ? <Check className="w-3.5 h-3.5 inline" />
              : <Copy className="w-3.5 h-3.5 inline" />}
          </button>
        )}
      </span>
    </div>
  );

  return (
    <PageLayout role="public" showNav>
      <div className="max-w-xl mx-auto pt-10 pb-24">
        <div className="text-center mb-10">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-2">
            {t('verify_receipt.title')}
          </h1>
          <p className="text-sm text-on-surface-variant">{t('verify_receipt.subtitle')}</p>
        </div>

        <div className="flex gap-3 mb-6">
          <div className="flex-1">
            <Input
              placeholder={t('verify_receipt.placeholder')}
              value={ref}
              onChange={e => setRef(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
              onKeyDown={e => e.key === 'Enter' && runSearch()}
            />
          </div>
          <Button
            variant="gradient"
            className="rounded-2xl px-5"
            onClick={runSearch}
            disabled={!ref.trim() || state === 'searching' || loading}
          >
            {t('common.search')}
          </Button>
        </div>

        {state === 'searching' && (
          <div className="flex justify-center py-10"><Spinner /></div>
        )}

        {state === 'found' && match && (
          <Card className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="w-6 h-6 text-success shrink-0" />
              <div>
                <p className="text-sm font-bold text-success">{t('verify_receipt.found')}</p>
                <p className="text-xs text-on-surface-meta">{t('verify_receipt.vote_recorded')}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-on-surface-meta shrink-0">{t('verify_receipt.election')}</span>
                {/* `min-w-0` as well as `break-words`: inside a flex row an item
                    will not shrink below its content, so a title of a hundred
                    characters with no space in it pushed itself straight out of
                    the card. Wrapping alone does not help until the item is
                    allowed to be narrower than the word. */}
                <span className="text-on-surface font-medium text-right min-w-0 break-words">
                  {match.electionTitle}
                </span>
              </div>
              {row(t('verify_receipt.reference'), match.txHash, true)}
              {row(t('verify_receipt.nullifier'), match.nullifier, true)}
              <div className="flex justify-between">
                <span className="text-on-surface-meta">{t('verify_receipt.date')}</span>
                <span className="text-on-surface">{match.timestamp.toLocaleString()}</span>
              </div>
              {/* Only worth a line when there was more than one. A re-vote
                  replaces the earlier ballot, so seeing two here and one tally
                  entry is the system working, not a discrepancy. */}
              {match.voteCount > 1 && (
                <div className="flex justify-between">
                  <span className="text-on-surface-meta">{t('verify_receipt.ballots')}</span>
                  <span className="text-on-surface">{match.voteCount}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-on-surface-meta">{t('verify_receipt.status')}</span>
                <Badge variant={match.phase as Parameters<typeof Badge>[0]['variant']}>
                  {t(`phase.${match.phase}`)}
                </Badge>
              </div>
            </div>
            {/* Said out loud, because it is the question a reader of this card
                will ask next and the answer is a design guarantee, not a gap. */}
            <p className="text-xs text-on-surface-meta mt-4 pt-4 border-t border-white/5">
              {t('verify_receipt.choice_never_shown')}
            </p>
          </Card>
        )}

        {state === 'not-found' && (
          <Card className="p-5 flex items-center gap-3">
            <XCircle className="w-6 h-6 text-error shrink-0" />
            <div>
              <p className="text-sm font-bold text-error">{t('verify_receipt.not_found')}</p>
              <p className="text-xs text-on-surface-meta">{t('verify_receipt.not_found_desc')}</p>
            </div>
          </Card>
        )}

        {state === 'idle' && (
          <p className="text-xs text-center text-on-surface-meta mt-4">
            {t('verify_receipt.hint')}
          </p>
        )}

        {/* Offered rather than left blank. The search above works for anybody,
            including a signed-in voter who never unlocks; this only saves them
            digging out their own reference. */}
        {shortcuts.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-semibold text-on-surface mb-3">{t('verify_receipt.your_receipts')}</h2>
            <div className="flex flex-col gap-2">
              {shortcuts.map(s => (
                <button
                  key={s.reference}
                  type="button"
                  onClick={() => { setRef(s.reference); setParams({ ref: s.reference }, { replace: true }); void search(s.reference); }}
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-white/5 bg-surface-low/30 hover:border-white/10 hover:bg-surface-low/40 transition-all text-left cursor-pointer"
                >
                  <span className="text-sm text-on-surface truncate">{s.electionTitle}</span>
                  <span className="text-xs text-on-surface-meta font-mono shrink-0">
                    {shortenReference(s.reference)}
                  </span>
                </button>
              ))}
            </div>

            {!identityReady && (
              <div className="mt-4 flex flex-col items-start gap-2">
                <p className="text-xs text-on-surface-meta">{t('history.partial_view')}</p>
                <Button variant="ghost" className="rounded-full px-5 gap-2" onClick={() => void unlock()} disabled={unlocking}>
                  <Lock className="w-4 h-4" />
                  {unlocking ? t('common.loading') : t('history.see_all')}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Nothing recorded here, but that is not the same as nothing to find.
            Offered on its own so a voter arriving on a fresh browser is not left
            thinking the tool has no idea who they are. */}
        {voterLoggedIn && live && !identityReady && shortcuts.length === 0 && (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <p className="text-xs text-on-surface-meta max-w-md">{t('verify_receipt.unlock_hint')}</p>
            <Button variant="ghost" className="rounded-full px-6 gap-2" onClick={() => void unlock()} disabled={unlocking}>
              <Lock className="w-4 h-4" />
              {unlocking ? t('common.loading') : t('history.see_all')}
            </Button>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
