import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isAddress } from 'ethers';
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { Card } from './Card';
import { cn } from '../../lib/utils';
import { hasPublishedResults, type Election } from '../../data/seed';
import { isChainConfigured } from '../../lib/deployments';
import { auditPublishedTally, type TallyAudit } from '../../lib/tallyAudit';

/**
 * A published result, checked against the ballots on chain with no key.
 *
 * Runs `verifyTally` in the reader's own browser: the published counters have
 * to be exactly what the valid final ballots add up to, and every ballot left
 * out has to be opened and shown to be invalid. Anyone can repeat it and reach
 * the same answer, so nobody has to take the organizer's word for the result.
 *
 * WHY IT IS A COMPONENT. The organizer, the one person who produced the
 * numbers, is also a reader: publishing your own result and being shown that
 * it verifies is worth more to an honest organizer than to anyone else.
 *
 * Renders nothing until results are published, or on the demo data, which has
 * no chain to check against.
 */
export function TallyCheck({ election, className }: { election: Election; className?: string }) {
  const { t } = useTranslation();
  const address = election.contractAddress;
  const checkable = hasPublishedResults(election) && isChainConfigured() && isAddress(address);
  // Keyed by the address it answers for, so a result never outlives the
  // election it was about and "pending" needs no state of its own.
  const [settled, setSettled] = useState<{ address: string; audit: TallyAudit | null } | null>(null);

  useEffect(() => {
    if (!checkable) return;
    let cancelled = false;
    auditPublishedTally(address)
      .then(result => { if (!cancelled) setSettled({ address, audit: result }); })
      .catch(() => { if (!cancelled) setSettled({ address, audit: null }); });
    return () => { cancelled = true; };
  }, [checkable, address]);

  const audit: TallyAudit | 'pending' | null =
    settled?.address === address ? settled.audit : 'pending';
  if (!checkable || audit === null) return null;

  if (audit === 'pending') {
    return (
      <Card className={cn('p-5 mb-5', className)}>
        <p className="flex items-center gap-2 text-xs text-on-surface-variant">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('results.check_pending')}
        </p>
      </Card>
    );
  }

  const Icon =
    audit.status === 'verified' ? ShieldCheck : audit.status === 'failed' ? ShieldAlert : ShieldQuestion;
  const tone =
    audit.status === 'verified' ? 'text-success' : audit.status === 'failed' ? 'text-error' : 'text-warning';

  return (
    <Card className={cn('p-5 mb-5', className)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('w-5 h-5 shrink-0 mt-0.5', tone)} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-on-surface mb-1">
            {t(`results.check_${audit.status}_title`)}
          </h2>
          <p className="text-xs text-on-surface-variant">
            {audit.status === 'verified'
              ? t('results.check_verified_body', { valid: audit.validBallots, voters: audit.voters })
              : t(`results.check_${audit.status}_body`)}
          </p>
          {audit.status === 'verified' && audit.invalidBallots > 0 && (
            <p className="text-xs text-on-surface-variant mt-2">
              {t('results.check_excluded', { excluded: audit.invalidBallots })}
            </p>
          )}
          {audit.status === 'failed' && (
            <p className="text-xs text-on-surface-meta mt-2 font-mono break-words">{audit.reason}</p>
          )}
        </div>
      </div>
    </Card>
  );
}
