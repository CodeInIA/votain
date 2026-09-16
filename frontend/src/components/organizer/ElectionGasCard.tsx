import { useState } from 'react';
import type { JsonRpcSigner } from 'ethers';
import { useTranslation } from 'react-i18next';
import { Fuel, Lock, Undo2 } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/useToast';
import { useElectionFunding } from '../../hooks/useElectionFunding';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { fundElection, releaseElectionReserve, getElectionFunding } from '../../lib/organizer';
import { WalletAnswerLostError } from '../../lib/walletRequest';
import { chainInfo } from '../../lib/deployments';
import { remainingVoters, stillOpen, splitFunding, toWei } from '../../lib/gasNeeds';
import { useVoteCost } from '../../hooks/useVoteCost';
import { isUserRejection } from '../../lib/walletErrors';
import type { Election } from '../../data/seed';

interface ElectionGasCardProps {
  election: Election;
}

/**
 * One election's own gas, and what the organizer may do with it.
 *
 * Reserved gas belongs to the election until it ends. That is not a restriction
 * bolted on for its own sake: it is the only reason a voter can be told their
 * ballot will be paid for. A balance the organizer could withdraw mid-election
 * promises nothing, and used to be exactly what they had.
 */
export function ElectionGasCard({ election }: ElectionGasCardProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const wallet = useOrganizerWallet();
  const funding = useElectionFunding(election.contractAddress);
  const [amount, setAmount] = useState('0.5');
  const [busy, setBusy] = useState(false);

  const voteCost = useVoteCost();
  const open = stillOpen(election);
  const remaining = remainingVoters(election);
  const covered = Math.floor(funding.reserved / voteCost.matic);
  // The same split the transaction will make, so the sentence and the signature
  // cannot disagree.
  const split = splitFunding(toWei(Number(amount)), toWei(funding.free));
  const needed = Math.max(0, remaining * voteCost.matic - funding.reserved);

  /**
   * Signs something, the way every other wallet action on this site does.
   *
   * Through `withWalletApp` rather than awaiting the signer directly: over
   * WalletConnect the prompt appears in another app, and leaving this page to
   * approve it kills the relay socket the answer would have come back through.
   * `confirm` reads the chain afterwards to settle the question the lost reply
   * cannot. See `lib/walletRequest.ts`.
   */
  const run = async (
    work: (signer: JsonRpcSigner) => Promise<string>,
    landed: () => Promise<boolean>,
  ): Promise<void> => {
    setBusy(true);
    try {
      const signer = await wallet.getSigner();
      await wallet.withWalletApp(
        () => work(signer),
        () => toast({ title: t('errors.confirm_in_wallet_app'), variant: 'info' }),
        async () => ((await landed()) ? 'confirmed' : undefined),
      );
      funding.refresh();
    } catch (e) {
      if (isUserRejection(e)) return;
      if (e instanceof WalletAnswerLostError) {
        funding.refresh();
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

  return (
    <Card className="p-5 mb-5">
      <h2 className="text-sm font-semibold text-on-surface mb-4 flex items-center gap-2">
        <Fuel className="w-4 h-4 text-primary" />
        {t('gas.reserved_here')}
      </h2>

      <div className="flex items-baseline gap-2 mb-1">
        <p className="text-2xl font-bold text-on-surface">
          {funding.reserved.toFixed(4)}
        </p>
        <span className="text-sm text-on-surface-meta">{chainInfo.currency}</span>
      </div>
      {/* About, never exactly: what a relay costs depends on the gas price when
          it is mined, which nobody knows in advance. */}
      <p className="text-xs text-on-surface-meta mb-4">
        {t('funding.reserved_votes', { votes: covered })}
      </p>

      {/* The same sentence the voter is shown, and deliberately so: an
          organizer should be told what their voters are being told, in the same
          words, rather than a softer version of it. */}
      {open && needed > 0 && (
        <p className="text-xs text-warning mb-4">
          {t('funding.short', {
            votes: Math.floor((funding.reserved + funding.free) / voteCost.matic),
            voters: remaining,
          })}
        </p>
      )}

      {open ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 items-end">
            <div className="flex-1 min-w-0">
              <Input
                label={t('gas.amount_token', { currency: chainInfo.currency })}
                type="number"
                step="0.1"
                min="0.1"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>
            <Button
              variant="gradient"
              className="rounded-full px-5 h-11 shrink-0"
              disabled={busy}
              onClick={() => void run(
                signer =>
                  fundElection(
                    signer,
                    election.contractAddress,
                    amount,
                    toWei(funding.free),
                  ),
                async () =>
                  (await getElectionFunding(election.contractAddress)).reserved >
                  BigInt(Math.floor(funding.reserved * 1e18)),
              )}
            >
              {t('gas.fund_election')}
            </Button>
          </div>
          {/* Where it comes from, said before it is taken. The balance is
              already inside the contract, so spending it costs a transaction
              and no transfer; only the shortfall is asked of the wallet. */}
          <p className="text-xs text-on-surface-meta">
            {split.fromWallet > 0n
              ? t('gas.reserve_source_split', {
                  fromBalance: (Number(split.fromBalance) / 1e18).toFixed(4),
                  fromWallet: (Number(split.fromWallet) / 1e18).toFixed(4),
                  currency: chainInfo.currency,
                })
              : t('gas.reserve_source_balance', {
                  amount: (Number(split.fromBalance) / 1e18).toFixed(4),
                  currency: chainInfo.currency,
                })}
          </p>
          <p className="text-xs text-on-surface-meta flex items-start gap-1.5">
            <Lock className="w-3 h-3 shrink-0 mt-0.5" />
            {t('gas.reserve_note')}
          </p>
        </div>
      ) : funding.reserved > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-on-surface-variant">
            {t('gas.release_available', {
              amount: funding.reserved.toFixed(4),
              currency: chainInfo.currency,
            })}
          </p>
          <Button
            variant="default"
            className="rounded-full gap-2"
            disabled={busy}
            onClick={() => void run(
              signer => releaseElectionReserve(signer, election.contractAddress),
              async () => (await getElectionFunding(election.contractAddress)).reserved === 0n,
            )}
          >
            <Undo2 className="w-4 h-4" />
            {t('gas.release')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
