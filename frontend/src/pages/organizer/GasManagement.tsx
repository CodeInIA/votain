import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Fuel, ArrowDownLeft } from 'lucide-react';
import { formatEther } from 'ethers';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { GasWidget } from '../../components/ui/GasWidget';
import { useToast } from '../../components/ui/useToast';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { useRefreshOnReturn } from '../../hooks/useRefreshOnReturn';
import { isChainConfigured, chainInfo } from '../../lib/deployments';
import { depositGas, getGasBalance, fetchGasHistory, type GasMovement } from '../../lib/organizer';
import { WalletAnswerLostError } from '../../lib/walletRequest';
import { isUserRejection } from '../../lib/walletErrors';

/** Sample movements shown only in demo mode (no contracts configured). */
const SEED_HISTORY: GasMovement[] = [
  { type: 'deposit', amount: 1.0,   date: new Date(Date.now() - 5 * 86_400_000), txHash: '0xabc1' },
  { type: 'spent',   amount: -0.12, date: new Date(Date.now() - 3 * 86_400_000), txHash: '0xdef2' },
  { type: 'spent',   amount: -0.08, date: new Date(Date.now() - 1 * 86_400_000), txHash: '0xghi3' },
];

const VOTE_COST = 0.03; // approx native token per sponsored vote

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

  const HISTORY = history;

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
          <h2 className="text-sm font-semibold text-on-surface mb-4">{t('gas.history')}</h2>
          {HISTORY.length === 0 ? (
            <p className="text-sm text-on-surface-meta text-center py-6">{t('gas.history_empty')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {HISTORY.map(h => (
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
                    <p className="text-xs text-on-surface-meta font-mono truncate">
                      {h.txHash.slice(0, 10)}…
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={['text-sm font-semibold', h.amount > 0 ? 'text-success' : 'text-on-surface-meta'].join(' ')}>
                      {h.amount > 0 ? '+' : ''}{h.amount.toFixed(4)} {chainInfo.currency}
                    </p>
                    <p className="text-xs text-on-surface-meta">{h.date.toLocaleDateString()}</p>
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
