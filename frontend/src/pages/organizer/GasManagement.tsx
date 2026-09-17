import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Fuel,
  ArrowDownLeft,
  ArrowUpRight,
  Lock,
  Search,
  X,
  Copy,
  Check,
  ExternalLink,
  Undo2,
  AlertTriangle,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { formatEther } from 'ethers';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { GasWidget } from '../../components/ui/GasWidget';
import { LoadMore } from '../../components/ui/LoadMore';
import { Modal } from '../../components/ui/Modal';
import { ClearFiltersButton } from '../../components/ui/ClearFiltersButton';
import { useElectionPages } from '../../hooks/useElectionPages';
import { getPaymaster } from '../../lib/contracts';
import { openNeeds, totalShortfall } from '../../lib/gasNeeds';
import { useVoteCost } from '../../hooks/useVoteCost';
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
import {
  depositGas,
  withdrawGas,
  getGasBalance,
  fetchGasHistory,
  type GasMovement,
} from '../../lib/organizer';
import { WalletAnswerLostError } from '../../lib/walletRequest';
import { isUserRejection } from '../../lib/walletErrors';
import { formatDateTime } from '../../lib/datetime';

/** Sample movements shown only in demo mode (no contracts configured). */
const SEED_HISTORY: GasMovement[] = [
  { type: 'spent',   amount: -0.08, date: new Date(Date.now() - 1 * 86_400_000), txHash: '0xghi3', blockNumber: 3 },
  { type: 'spent',   amount: -0.12, date: new Date(Date.now() - 3 * 86_400_000), txHash: '0xdef2', blockNumber: 2 },
  { type: 'deposit', amount: 1.0,   date: new Date(Date.now() - 5 * 86_400_000), txHash: '0xabc1', blockNumber: 1 },
];



/** Rows per page. Compact lines, so more of them fit than cards would. */
const GAS_PAGE_SIZE = 25;

/**
 * The three things that move a gas tank, plus everything.
 *
 * Labelled with the keys the rows already use, so a chip and the row it filters
 * to never call the same event two different names.
 */
const TYPE_FILTERS: { key: GasMovement['type'] | null; labelKey: string }[] = [
  { key: null,       labelKey: 'common.all'            },
  { key: 'deposit',  labelKey: 'gas.deposit'           },
  { key: 'reserved', labelKey: 'gas.movement_reserved' },
  { key: 'spent',    labelKey: 'gas.used'              },
  { key: 'released', labelKey: 'gas.movement_released' },
  { key: 'withdraw', labelKey: 'gas.withdraw'          },
];

/** Amounts that are money arriving or leaving, as opposed to moving between pots. */
const SIGNED: GasMovement['type'][] = ['deposit', 'withdraw', 'spent', 'reserved'];

/**
 * A glyph per kind, because there are five kinds and they are not variations of
 * each other.
 *
 * Three of them used to share two icons, so a deposit and a reservation looked
 * identical while being the two things it matters most to tell apart: one is
 * money you can still take back and the other is money you have promised to an
 * election. The lock is the same one the reserve carries everywhere else.
 */
const MOVEMENT_ICON: Record<GasMovement['type'], LucideIcon> = {
  deposit: ArrowDownLeft,   // into the free balance
  reserved: Lock,           // committed to one election
  spent: Fuel,              // a ballot was paid for
  released: Undo2,          // back from an election that ended
  withdraw: ArrowUpRight,   // out to the wallet
};

/**
 * A colour per kind, arranged by WHERE THE MONEY WENT rather than picked one by
 * one. Three colours for five kinds left gas used, returned and withdrawn all
 * in the same grey, which is three different events wearing one face.
 *
 * The two that cross the wallet are the opposite ends of the palette: green
 * arriving, amber leaving. The two that move between the tank's own columns are
 * a related pair, blue out to an election and cyan back from it, so they read as
 * one round trip. Gas used is the only kind that is CONSUMED rather than moved,
 * so it gets a hue of its own and never passes for a transfer.
 */
interface MovementTone {
  /** The round icon tile on a row. */
  tile: string;
  /** The figure on the right of a row. */
  amount: string;
  /** The filter chip while it is the one selected. */
  chip: string;
  /** The chip's icon, which keeps its colour even while the chip is not. */
  chipIcon: string;
}

/**
 * Written out in full rather than composed from the type name, because Tailwind
 * reads these files as text: a class built at run time is a class that never
 * reaches the stylesheet.
 */
const MOVEMENT_TONE: Record<GasMovement['type'], MovementTone> = {
  deposit: {
    tile: 'bg-success/10 text-success',
    amount: 'text-success',
    chip: 'bg-success/10 border-success/30 text-success',
    chipIcon: 'text-success',
  },
  reserved: {
    tile: 'bg-primary/10 text-primary',
    amount: 'text-primary-dim',
    chip: 'bg-primary/10 border-primary/30 text-primary-dim',
    chipIcon: 'text-primary',
  },
  released: {
    tile: 'bg-tertiary/10 text-tertiary',
    amount: 'text-tertiary-dim',
    chip: 'bg-tertiary/10 border-tertiary/30 text-tertiary-dim',
    chipIcon: 'text-tertiary',
  },
  spent: {
    tile: 'bg-secondary/10 text-secondary-dim',
    amount: 'text-on-surface-meta',
    chip: 'bg-secondary/10 border-secondary/30 text-secondary-dim',
    chipIcon: 'text-secondary-dim',
  },
  withdraw: {
    tile: 'bg-warning/10 text-warning',
    amount: 'text-warning',
    chip: 'bg-warning/10 border-warning/30 text-warning',
    chipIcon: 'text-warning',
  },
};

/**
 * Whether two readings of "reserved per election" say the same thing.
 *
 * Only ever used to avoid storing an answer that has not changed. Compared by
 * value because the values are what the page draws: two objects built from two
 * identical rounds of RPC calls are never the same object.
 */
function sameReserves(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => a[k] === b[k]);
}

export default function GasManagement() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const wallet = useOrganizerWallet();
  const live = isChainConfigured();
  const [amount, setAmount] = useState('1.0');
  /**
   * Measured from past relays, not assumed.
   *
   * Every figure this screen quotes in ballots rests on it, including the hint
   * under the deposit field, which used to have the number written into all
   * thirteen translations.
   */
  const voteCost = useVoteCost();
  const [withdrawAmount, setWithdrawAmount] = useState('0.5');
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
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

  /**
   * What the free balance is still holding up.
   *
   * "Warn when the balance is low" needs a definition of low, and a constant
   * cannot have one: half a POL is nothing for two thousand voters and alarming
   * for three. The figure the chain already publishes is the right one, which is
   * how many people enrolled in a still-open election and have not voted. Every
   * one of them was told their ballot would be paid for.
   */
  const mine = useElectionPages({
    scope: 'mine',
    organizer: wallet.address ?? null,
    hydrateAll: true,
    keep: e => e.organizerAddress.toLowerCase() === wallet.address?.toLowerCase(),
  });
  const [reserves, setReserves] = useState<Record<string, number>>({});

  /**
   * WHICH elections, as a string, and not the array they came in.
   *
   * `all` is rebuilt on every render of the hook that produces it, so it is a
   * new array each time even when it holds exactly the same elections. As an
   * effect dependency that was an infinite loop: read the reserve of every
   * election, store it, re-render, get a new array, read them all again. With
   * thirty-three elections that is thirty-three RPC calls a lap, for as long
   * as the page is open.
   */
  const mineKey = mine.all.map(e => e.contractAddress).join(',');

  useEffect(() => {
    if (!live || mine.all.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const paymaster = getPaymaster();
        const pairs = await Promise.all(
          mine.all.map(async e => {
            const wei: bigint = await paymaster.reservedFor(e.contractAddress);
            return [e.contractAddress, Number(formatEther(wei))] as const;
          }),
        );
        if (cancelled) return;
        // KEPT IF NOTHING MOVED, which is the second lock on the same door.
        // Storing an equal object is still a state change to React, so a
        // caller that reintroduces an unstable dependency above would start
        // the loop again; answering with the previous object ends it after
        // one pass whatever the dependencies say.
        setReserves(prev => (sameReserves(prev, Object.fromEntries(pairs)) ? prev : Object.fromEntries(pairs)));
      } catch (e) {
        console.error('Could not read what is reserved per election:', e);
      }
    })();
    return () => { cancelled = true; };
    // `mine.all` is read inside and tracked by `mineKey`, which changes when
    // the set of elections does and not when the array is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, mineKey, reloadToken]);

  const needs = openNeeds(mine.all, e => reserves[e.contractAddress] ?? 0, voteCost.matic);
  const owed = totalShortfall(needs);
  const waitingVoters = needs.reduce((sum, need) => sum + need.remainingVoters, 0);
  const leftAfterWithdrawal = balance - (Number(withdrawAmount) || 0);
  const wouldStrandVoters = leftAfterWithdrawal < owed;

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
        () => depositGas(signer, amount),
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

  const handleWithdraw = async () => {
    setConfirmingWithdraw(false);
    setBusy(true);
    try {
      if (!wallet.address) {
        await wallet.connect();
        return;
      }
      if (await wallet.isWrongNetwork()) await wallet.switchToAmoy();
      const signer = await wallet.getSigner();
      // Read first, so the chain can answer "did this land" when the wallet's
      // reply does not come back. Same reason as the deposit above.
      const before = await getGasBalance(wallet.address);
      await wallet.withWalletApp(
        () => withdrawGas(signer, withdrawAmount),
        () => toast({ title: t('errors.confirm_in_wallet_app'), variant: 'info' }),
        async () => ((await getGasBalance(wallet.address!)) < before ? 'confirmed' : undefined),
      );
      setReloadToken(n => n + 1);
      toast({ title: t('gas.withdraw'), variant: 'success' });
    } catch (e) {
      if (isUserRejection(e)) return;
      if (e instanceof WalletAnswerLostError) {
        setReloadToken(n => n + 1);
        toast({ title: t('errors.wallet_answer_lost'), variant: 'info' });
        return;
      }
      toast({
        title: t('errors.generic_title'),
        description: e instanceof Error ? e.message : String(e),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

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
        {/* NO `onDeposit` here, deliberately. The widget's button exists to
            take an organizer to the screen where they can top up, which is
            this one: passing the handler put a second button on top of the
            deposit form doing exactly what the form's own button does. The
            dashboard still passes one, because there it navigates. */}
        <GasWidget
          balance={balance}
          estimatedVotesLeft={Math.floor(balance / voteCost.matic)}
          className="mb-6"
        />

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
                hint={t('gas.amount_hint', {
                  currency: chainInfo.currency,
                  cost: voteCost.matic.toFixed(4),
                })}
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

        {/* Withdraw.
            Reaches the free balance only. Gas reserved for a running election
            is not the organizer's to take back while voters are relying on it,
            and the contract will not let them: this is the money that is
            genuinely spare. */}
        <Card className="p-5 mb-6">
          <h2 className="text-sm font-semibold text-on-surface mb-4 flex items-center gap-2">
            <Undo2 className="w-4 h-4 text-on-surface-meta" />
            {t('gas.withdraw_title')}
          </h2>
          <div className="flex gap-2 items-end">
            <div className="flex-1 min-w-0">
              <Input
                label={t('gas.amount_token', { currency: chainInfo.currency })}
                type="number"
                step="0.1"
                min="0"
                max={balance}
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
              />
            </div>
            <Button
              variant="default"
              className="rounded-full px-5 h-11 shrink-0"
              disabled={busy || !live || Number(withdrawAmount) <= 0 || Number(withdrawAmount) > balance}
              onClick={() => setConfirmingWithdraw(true)}
            >
              {t('gas.withdraw_btn', { amount: withdrawAmount, currency: chainInfo.currency })}
            </Button>
          </div>
        </Card>

        {/* Asked before the wallet is, and it says what it costs rather than
            "are you sure": the number that matters is what the open elections
            still need, not the one being withdrawn. */}
        <Modal
          open={confirmingWithdraw}
          onClose={() => setConfirmingWithdraw(false)}
          title={t('gas.withdraw_btn', { amount: withdrawAmount, currency: chainInfo.currency })}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {owed > 0
                ? t('gas.withdraw_confirm_body', {
                    left: Math.max(0, leftAfterWithdrawal).toFixed(4),
                    needed: owed.toFixed(4),
                    voters: waitingVoters,
                    currency: chainInfo.currency,
                  })
                : t('gas.withdraw_nothing_owed', {
                    left: Math.max(0, leftAfterWithdrawal).toFixed(4),
                    currency: chainInfo.currency,
                  })}
            </p>
            {wouldStrandVoters && (
              <div className="flex gap-3 p-3 rounded-2xl bg-error/10 border border-error/25">
                <AlertTriangle className="w-4 h-4 text-error shrink-0 mt-0.5" />
                <p className="text-xs text-error leading-relaxed">{t('gas.withdraw_danger')}</p>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setConfirmingWithdraw(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant={wouldStrandVoters ? 'default' : 'gradient'}
                className="rounded-full px-5"
                onClick={() => void handleWithdraw()}
              >
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        </Modal>

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
              <Input
                placeholder={t('gas.search_placeholder')}
                value={filters.query}
                onChange={e => setFilters(f => ({ ...f, query: e.target.value }))}
                leftIcon={<Search className="w-4 h-4" />}
                rightIcon={filters.query ? (
                  <button
                    type="button"
                    onClick={() => setFilters(f => ({ ...f, query: '' }))}
                    aria-label={t('common.clear')}
                    className="cursor-pointer p-2 -m-2 hover:text-on-surface transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : undefined}
              />
              {/* One kind at a time, WRAPPED rather than scrolled sideways.
                  Six chips whose labels name a kind of movement do not fit one
                  row in most languages, and a horizontal scroll with no edge to
                  hint at it hid the last two entirely: a filter nobody can see
                  is a filter nobody has. Two lines is the cheaper cost.

                  EACH CHIP WEARS ITS OWN COLOUR AND ICON, the same ones its
                  rows do, so the filter row doubles as the legend for the list
                  under it. Learning what the cyan circle means costs nothing if
                  the thing that turns the list cyan is sitting right there
                  saying "returned from an election".

                  The icon keeps its colour even while the chip is not selected.
                  Greying it out would hide exactly the association this is for,
                  and the selected chip is already obvious from its fill. */}
              <div className="flex flex-wrap gap-2">
                {TYPE_FILTERS.map(option => {
                  const active = filters.type === option.key;
                  const tone = option.key ? MOVEMENT_TONE[option.key] : null;
                  const Icon = option.key ? MOVEMENT_ICON[option.key] : Layers;
                  return (
                    <button
                      key={option.key ?? 'all'}
                      type="button"
                      onClick={() => setFilters(f => ({ ...f, type: option.key }))}
                      className={[
                        'shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full',
                        'text-xs font-semibold border transition-all cursor-pointer',
                        active
                          ? tone?.chip ?? 'bg-primary/10 border-primary/30 text-primary-dim'
                          : 'bg-surface-low/30 border-outline-variant/20 text-on-surface-meta hover:text-on-surface hover:border-outline-variant/40',
                      ].join(' ')}
                      aria-pressed={active}
                    >
                      <Icon
                        className={[
                          'w-3.5 h-3.5 shrink-0',
                          tone ? tone.chipIcon : 'text-on-surface-meta',
                          active ? '' : 'opacity-70',
                        ].join(' ')}
                      />
                      {t(option.labelKey)}
                    </button>
                  );
                })}
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
              {/* At the foot of the filters and on the right, which is where
                  every other list in the app puts it. This one was on the left
                  and wore no cross: the same two words as the elections'
                  control, near enough to be compared and different enough to
                  have to be. */}
              <div className="flex justify-end items-center min-h-5">
                {isGasFilterActive(filters) && (
                  <ClearFiltersButton onClick={() => setFilters(EMPTY_GAS_FILTER)} />
                )}
              </div>
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
                    MOVEMENT_TONE[h.type].tile,
                  ].join(' ')}>
                    {(() => {
                      const Icon = MOVEMENT_ICON[h.type];
                      return <Icon className="w-4 h-4" />;
                    })()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface">
                      {{
                        deposit: t('gas.deposit'),
                        withdraw: t('gas.withdraw'),
                        spent: t('gas.used'),
                        reserved: t('gas.movement_reserved'),
                        released: t('gas.movement_released'),
                      }[h.type]}
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
                    {/* A release moves money between two pots of the same tank,
                        so it is shown without a sign: calling it an arrival
                        would double count it against the deposit that put it
                        there in the first place. */}
                    {/* The amount wears the same colour as its icon, so a row
                        is one thing rather than two. Gas used stays grey on
                        purpose: it is the most frequent row by far and a
                        coloured figure on every one of them would drown the
                        handful that are worth noticing. */}
                    <p className={['text-sm font-semibold', MOVEMENT_TONE[h.type].amount].join(' ')}>
                      {SIGNED.includes(h.type) && h.amount > 0 ? '+' : ''}
                      {(SIGNED.includes(h.type) ? h.amount : Math.abs(h.amount)).toFixed(4)}
                      {' '}{chainInfo.currency}
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
                      {h.date ? formatDateTime(h.date) : '—'}
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
