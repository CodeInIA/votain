import { useTranslation } from 'react-i18next';
import { Fuel, AlertTriangle } from 'lucide-react';
import { fundingVerdict, remainingVoters } from '../../lib/gasNeeds';
import { useVoteCost } from '../../hooks/useVoteCost';
import type { Election } from '../../data/seed';
import { cn } from '../../lib/utils';

interface FundingNoticeProps {
  election: Election;
  /** Committed to this election, in the chain's native token. */
  reserved: number;
  /** The organizer's withdrawable balance, which may also be spent here. */
  organizerFree: number;
  className?: string;
}

/**
 * Whether the ballot a voter is about to cast can be paid for.
 *
 * Voters here hold no wallet by design, so a relay nobody can reimburse is not
 * a delay, it is the vote not happening. Until now the only way to find out was
 * to try: generate a proof on a phone, wait, and be told afterwards by a revert.
 *
 * SAYS WHOSE PROBLEM IT IS. A voter turned away by an empty tank has done
 * nothing wrong and can do nothing about it except tell the organizer, and a
 * message that does not say so reads as "you are not allowed to vote".
 *
 * Only the reserve is ever called a guarantee. The organizer's free balance is
 * real money that will be spent if the reserve runs out, and is also money they
 * can withdraw at any moment, so it is never counted as a promise to anyone.
 */
export function FundingNotice({ election, reserved, organizerFree, className }: FundingNoticeProps) {
  const { t } = useTranslation();
  // Read here rather than passed down: the answer is shared and cached, so two
  // components asking is one request, and a caller cannot forget to thread it.
  const voteCost = useVoteCost();
  const verdict = fundingVerdict(election, reserved, organizerFree, voteCost.matic);

  if (verdict.unfunded) {
    return (
      <div
        className={cn(
          'flex gap-3 p-4 rounded-2xl bg-error/10 border border-error/25 text-left',
          className,
        )}
        role="status"
      >
        <AlertTriangle className="w-5 h-5 text-error shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-error">{t('funding.unfunded_title')}</p>
          <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
            {t('funding.unfunded_body')}
          </p>
        </div>
      </div>
    );
  }

  if (verdict.short) {
    return (
      <div
        className={cn(
          'flex gap-3 p-3 rounded-2xl bg-warning/10 border border-warning/25 text-left',
          className,
        )}
        role="status"
      >
        <Fuel className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <p className="text-xs text-on-surface-variant leading-relaxed">
          {t('funding.short', { votes: verdict.possible, voters: remainingVoters(election) })}
        </p>
      </div>
    );
  }

  // Funded and comfortable. Nothing is said, because a line confirming that
  // everything is fine on every election trains people to stop reading the one
  // that says it is not.
  return null;
}
