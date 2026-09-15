import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Fuel, ArrowDownLeft, Search, Copy, Check, ExternalLink } from 'lucide-react';
import { formatEther } from 'ethers';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { GasWidget } from '../../components/ui/GasWidget';
import { LoadMore } from '../../components/ui/LoadMore';
import { DatePicker } from '../../components/ui/DatePicker';
import { usePageLimit } from '../../hooks/usePageLimit';
import { shortenReference } from '../../lib/utils';
import {
  matchesGasFilter,
  countUndated,
  isGasFilterActive,
  EMPTY_GAS_FILTER,
  type GasFilterState,
} from '../../lib/gasFilter';
import { useToast } from '../../components/ui/useToast';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { useRefreshOnReturn } from '../../hooks/useRefreshOnReturn';
import { isChainConfigured, chainInfo, explorerTxUrl } from '../../lib/deployments';
import { depositGas, getGasBalance, fetchGasHistory, type GasMovement } from '../../lib/organizer';
import { WalletAnswerLostError } from '../../lib/walletRequest';
import { isUserRejection } from '../../lib/walletErrors';

/** Sample movements shown only in demo mode (no contracts configured). */
const SEED_HISTORY: GasMovement[] = [
  { type: 'spent',   amount: -0.08, date: new Date(Date.now() - 1 * 86_400_000), txHash: '0xghi3', blockNumber: 3 },
  { type: 'spent',   amount: -0.12, date: new Date(Date.now() - 3 * 86_400_000), txHash: '0xdef2', blockNumber: 2 },
  { type: 'deposit', amount: 1.0,   date: new Date(Date.now() - 5 * 86_400_000), txHash: '0xabc1', blockNumber: 1 },
];

const VOTE_COST = 0.03; // approx native token per sponsored vote

/** Rows per page. Compact lines, so more of them fit than cards would. */
const GAS_PAGE_SIZE = 25;

/**
 * The three things that move a gas tank, plus everything.
 *
 * Labelled with the keys the rows already use, so a chip and the row it filters
 * to never call the same event two different names.
 */
const TYPE_FILTERS: { key: GasMovement['type'] | null; labelKey: string }[] = [
  { key: null,       labelKey: 'common.all'   },
  { key: 'deposit',  labelKey: 'gas.deposit'  },
  { key: 'spent',    labelKey: 'gas.used'     },
  { key: 'withdraw', labelKey: 'gas.withdraw' },
];

export default function GasManagement() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const wallet = useOrganizerWallet();
  const live = isChainConfigured();
  const [amount, setAmount] = useState('1.0');
  const [balance, setBalance] = useState(live ? 0 : 0.8);
  const [history, setHistory] = useState<GasMovement[]>(live ? [] : SEED_HISTORY);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Re-read whatever this screen draws, on returning from the wallet app.
  //
  // Not a recovery mechanism. The pending request settles on its own terms,
  // against the chain if its reply was lost on the way back: see
  // `withReturnDeadline`, which is where that is decided. This is only for what
  // changed while nobody here was looking.
  //
  // `busy` is left alone, here and everywhere. Coming back to the browser is
  // not evidence that the signing is over, and releasing the button early
  // invites a second transaction for one intended action.
  useRefreshOnReturn(() => setReloadToken(n => n + 1));

  // Real balance + movements straight from the paymaster.
  useEffect(() => {
    if (!live || !wallet.address) return;
    const organizer = wallet.address;
    let cancelled = false;

    void (async () => {
      try {
        const [bal, movements] = await Promise.all([
          getGasBalance(organizer),
          fetchGasHistory(organizer),
        ]);
        if (cancelled) return;
        setBalance(Number(formatEther(bal)));
        setHistory(movements);
      } catch (e) {
        console.error('Could not read gas tank:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [live, wallet.address, reloadToken]);

  const handleDeposit = async () => {
    if (!live) {
      toast({ title: t('gas.deposit_pending'), description: t('common.integration_pending'), variant: 'info' });
      return;
    }
    setBusy(true);
    try {
      // Inside the try: connecting can fail, and out here the rejection had
      // nowhere to be shown.
      if (!wallet.address) {
        await wallet.connect();
        return;
      }
      if (await wallet.isWrongNetwork()) await wallet.switchToAmoy();
      // Over a relay the prompt appears in the wallet app and nothing brings it
      // forward, so the only honest thing the page can do is say so.
      const signer = await wallet.getSigner();
      // Read before sending, so the chain can be asked afterwards whether this
      // deposit actually landed. It is the only way to know once the wallet's
      // reply is lost, which is what leaving the page to sign does to it.
      const before = await getGasBalance(wallet.address!);
      await wallet.withWalletApp(
        () => depositGas(signer, wallet.address!, amount),
        () => toast({ title: t('errors.confirm_in_wallet_app'), variant: 'info' }),
        async () => ((await getGasBalance(wallet.address!)) > before ? 'confirmed' : undefined),
      );
      setReloadToken(n => n + 1); // re-read balance + history from chain
      toast({ title: t('gas.deposit'), variant: 'success' });
    } catch (e) {
      // Nothing went wrong that we know of: the answer simply never came back.
      // The balance above has already been re-read, so the screen is truthful.
      // Declining is an answer, not a fault. Reporting it as one hands back a
      // red box about a decision they made on purpose.
      if (isUserRejection(e)) {
        toast({ title: t('errors.wallet_request_rejected'), variant: 'info' });
        return;
      }
      if (e instanceof WalletAnswerLostError) {
        setReloadToken(n => n + 1);
        toast({ title: t('errors.wallet_answer_lost'), variant: 'info' });
        return;
      }
      toast({ title: t('errors.generic_title'), description: e instanceof Error ? e.message : String(e), variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const [filters, setFilters] = useState<GasFilterState>(EMPTY_GAS_FILTER);
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = history.filter(h => matchesGasFilter(h, filters));
  // Only ever above zero when a provider refused a block, and worth saying:
  // this is a financial record, and a row that disappears without explanation
  // is worse than one whose date is unknown.
  const undated = countUndated(history, filters);

  /**
   * A page of movements at a time.
   *
   * The longest list the app can produce: `VoteSponsored` fires once per
   * sponsored vote, so a single election with two thousand voters leaves two
   * thousand rows here, and every one of them was being drawn.
   *
   * Narrowing the filters starts again from the first page: it is a different
   * list, and keeping the old limit would drop a hundred rows of it at once.
   */
  const { visible, hasMore, loadMore } = usePageLimit(
    filtered,
    GAS_PAGE_SIZE,
    JSON.stringify(filters),
  );

  const copyHash = (txHash: string): void => {
    void navigator.clipboard.writeText(txHash);
    setCopied(txHash);
    setTimeout(() => setCopied(current => (current === txHash ? null : current)), 1500);
  };

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-xl mx-auto pt-6 pb-24">
        <h1 className="text-2xl font-black tracking-tight text-white mb-6">{t('gas.title')}</h1>

        {/* Current balance */}
        <GasWidget balance={balance} estimatedVotesLeft={Math.floor(balance / VOTE_COST)} onDeposit={handleDeposit} className="mb-6" />

        {/* Deposit form */}
        <Card className="p-5 mb-6">
          <h2 className="text-sm font-semibold text-on-surface mb-4 flex items-center gap-2">
            <Fuel className="w-4 h-4 text-primary" />
            {t('gas.deposit_title')}
          </h2>
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                label={t('gas.amount_token', { currency: chainInfo.currency })}
                type="number"
                step="0.1"
                min="0.1"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                hint={t('gas.amount_hint', { currency: chainInfo.currency })}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            {['0.5', '1.0', '2.0', '5.0'].map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                className={[
                  'flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-all',
                  amount === v
                    ? 'bg-primary/10 border-primary/30 text-primary-dim'
                    : 'bg-surface-low/30 border-outline-variant/20 text-on-surface-meta hover:text-on-surface',
                  'cursor-pointer',
                ].join(' ')}
              >
                {v}
              </button>
            ))}
          </div>
          <Button variant="gradient" size="lg" className="w-full rounded-full h-12 mt-4" disabled={busy} onClick={handleDeposit}>
            {t('gas.deposit_btn', { amount, currency: chainInfo.currency })}
          </Button>
        </Card>

        {/* History */}
        <Card className="p-5">
          <div className="flex items-baseline justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-on-surface">{t('gas.history')}</h2>
            {/* Counted over everything that matches, not over what is drawn: the
                page limit is a drawing decision and must not restate the total
                as though it were the answer. */}
            {history.length > 0 && (
              <p className="text-xs text-on-surface-meta shrink-0">
                {t('gas.showing', { shown: visible.length, total: filtered.length })}
              </p>
            )}
          </div>

          {history.length > 0 && (
            <div className="flex flex-col gap-3 mb-4">
              <div className="relative">
                <Search className="w-4 h-4 text-on-surface-meta absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  className="pl-9"
                  placeholder={t('gas.search_placeholder')}
                  value={filters.query}
                  onChange={e => setFilters(f => ({ ...f, query: e.target.value }))}
                />
              </div>
              {/* One kind at a time. Same chip treatment as the voter's tabs,
                  which is the app's existing way of saying "pick one of these". */}
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {TYPE_FILTERS.map(option => (
                  <button
                    key={option.key ?? 'all'}
                    type="button"
                    onClick={() => setFilters(f => ({ ...f, type: option.key }))}
                    className={[
                      'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer',
                      filters.type === option.key
                        ? 'bg-primary/10 border-primary/30 text-primary-dim'
                        : 'bg-surface-low/30 border-outline-variant/20 text-on-surface-meta hover:text-on-surface',
                    ].join(' ')}
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
              {/* Two ends of one window, and the same control answers both
                  questions: a range, or one exact minute by putting the same
                  value in both. The upper bound runs to the end of its minute
                  so that second reading works (see `lib/gasFilter.ts`). */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 min-w-0">
                  <DatePicker
                    withTime
                    label={t('gas.from')}
                    value={filters.from}
                    onChange={value => setFilters(f => ({ ...f, from: value }))}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <DatePicker
                    withTime
                    label={t('gas.to')}
                    value={filters.to}
                    onChange={value => setFilters(f => ({ ...f, to: value }))}
                  />
                </div>
              </div>
              {isGasFilterActive(filters) && (
                <button
                  type="button"
                  className="self-start text-xs text-primary hover:underline cursor-pointer"
                  onClick={() => setFilters(EMPTY_GAS_FILTER)}
                >
                  {t('common.clear_filters')}
                </button>
              )}
              {undated > 0 && (
                <p className="text-xs text-warning">{t('gas.undated_hidden', { n: undated })}</p>
              )}
            </div>
          )}

          {history.length === 0 ? (
            <p className="text-sm text-on-surface-meta text-center py-6">{t('gas.history_empty')}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-on-surface-meta text-center py-6">{t('gas.no_matches')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map(h => (
                <div key={`${h.txHash}-${h.type}-${h.amount}`} className="flex items-center gap-3">
                  <div className={[
                    'w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
                    h.type === 'deposit' ? 'bg-success/10 text-success' : 'bg-surface-high text-on-surface-meta',
                  ].join(' ')}>
                    {h.type === 'deposit' ? <ArrowDownLeft className="w-4 h-4" /> : <Fuel className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface">
                      {h.type === 'deposit'
                        ? t('gas.deposit')
                        : h.type === 'withdraw'
                          ? t('gas.withdraw')
                          : t('gas.used')}
                    </p>
                    {/* The hash, and the two things anyone ever does with one.
                        It used to be ten characters of unselectable text, so
                        checking a movement against an explorer meant retyping
                        a hash by eye. */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => copyHash(h.txHash)}
                        title={h.txHash}
                        aria-label={t('gas.copy_hash')}
                        className="group/copy flex items-center gap-1.5 min-w-0 text-xs font-mono text-on-surface-meta hover:text-on-surface transition-colors cursor-pointer"
                      >
                        <span className="truncate">{shortenReference(h.txHash)}</span>
                        {copied === h.txHash ? (
                          <Check className="w-3 h-3 shrink-0 text-success" />
                        ) : (
                          <Copy className="w-3 h-3 shrink-0 opacity-0 group-hover/copy:opacity-100 focus-visible:opacity-100 transition-opacity" />
                        )}
                      </button>
                      {/* Only where there is one to link to. A local chain has
                          no explorer, and a confident button leading nowhere is
                          worse than no button (see `explorerTxUrl`). */}
                      {explorerTxUrl(h.txHash) && (
                        <a
                          href={explorerTxUrl(h.txHash) as string}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t('gas.view_on_explorer')}
                          aria-label={t('gas.view_on_explorer')}
                          className="shrink-0 text-on-surface-meta hover:text-primary transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={['text-sm font-semibold', h.amount > 0 ? 'text-success' : 'text-on-surface-meta'].join(' ')}>
                      {h.amount > 0 ? '+' : ''}{h.amount.toFixed(4)} {chainInfo.currency}
                    </p>
                    {/* An unreadable block leaves no date. It used to fall
                        back to today, which put a movement nobody could read at
                        the top of a list sorted by date, looking like it had
                        just happened. */}
                    {/* To the minute. A gas tank can take several movements in
                        one day and a date alone cannot tell them apart, which
                        is exactly when someone comes looking: to match a
                        deposit against a receipt. */}
                    <p className="text-xs text-on-surface-meta whitespace-nowrap">
                      {h.date
                        ? `${h.date.toLocaleDateString()} ${h.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : '—'}
                    </p>
                  </div>
                </div>
              ))}
              <LoadMore hasMore={hasMore} loading={false} onClick={loadMore} className="pt-4" />
            </div>
          )}
        </Card>
      </div>
    </PageLayout>
  );
}
