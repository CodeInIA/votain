import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { Card } from './Card';
import { cn } from '../../lib/utils';
import type { Election } from '../../data/seed';

/**
 * The half of a published result that anyone can check with no key.
 *
 * Each voter's surviving ballot contributes exactly one to exactly one
 * counter, so the counters have to add up to the number of voters the contract
 * itself counted. Both numbers are public, so this catches invented or dropped
 * ballots without anybody being trusted. It does NOT catch votes moved between
 * options, which keeps the total intact and needs a proof of correct
 * decryption.
 *
 * WHY IT IS A COMPONENT. It lived inline on the public results page, which
 * meant the organizer, the one person who produced the numbers, was the only
 * reader who never saw the check applied to them. Publishing your own result
 * and being shown that it verifies is worth more to an honest organizer than
 * to anyone else.
 *
 * Renders nothing until results are published, since there is nothing to
 * check before that.
 */
export function TallyCheck({ election, className }: { election: Election; className?: string }) {
  const { t } = useTranslation();
  const check = election.tallyCheck;
  if (!check) return null;

  return (
    <Card className={cn('p-5 mb-5', className)}>
      <div className="flex items-start gap-3">
        {check.matches ? (
          <ShieldCheck className="w-5 h-5 text-success shrink-0 mt-0.5" />
        ) : (
          <ShieldAlert className="w-5 h-5 text-error shrink-0 mt-0.5" />
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-on-surface mb-1">
            {t(check.matches ? 'results.check_ok_title' : 'results.check_bad_title')}
          </h2>
          <p className="text-xs text-on-surface-variant">
            {t(check.matches ? 'results.check_ok_body' : 'results.check_bad_body', {
              declared: check.declared,
              voters: check.voters,
            })}
          </p>
          <p className="text-xs text-on-surface-meta mt-2">{t('results.check_limit')}</p>
        </div>
      </div>
    </Card>
  );
}
