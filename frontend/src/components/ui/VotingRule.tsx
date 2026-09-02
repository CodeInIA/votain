/**
 * How an election is decided, said on the election itself.
 *
 * The rule was chosen in the create wizard, written to the contract, and then
 * never shown again: no view of an election named it, so a voter could not tell
 * whether their ballot fed a plurality, a two-thirds bar or a count of
 * confirmations, and the organizer could not check that the election they
 * deployed carries the rule they picked. The wizard's own descriptions are
 * reused here, so the two cannot drift apart.
 *
 * Shared by the voter, public and organizer views because the rule is a
 * property of the election, not of who is looking at it.
 */
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';
import type { VotingType } from '../../data/seed';
import {
  VOTING_TYPE_ICONS,
  votingTypeDescriptionKey,
  votingTypeLabelKey,
} from '../../lib/votingTypes';

interface Props {
  type: VotingType;
  /** Yes votes needed to approve. Only read for `witness_threshold`. */
  thresholdValue?: number;
  className?: string;
}

export function VotingRule({ type, thresholdValue, className }: Props) {
  const { t } = useTranslation();
  const Icon = VOTING_TYPE_ICONS[type];

  // The witness rule is the one whose description is incomplete on its own:
  // "at least N confirmations" is not a rule until N has a value.
  const detail =
    type === 'witness_threshold' && thresholdValue
      ? t('election.witness_rule', { count: thresholdValue })
      : t(votingTypeDescriptionKey(type));

  return (
    <div className={cn('flex items-start gap-3', className)}>
      <span className="w-8 h-8 shrink-0 rounded-full bg-secondary/10 flex items-center justify-center">
        <Icon className="w-4 h-4 text-secondary" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-on-surface break-words">{t(votingTypeLabelKey(type))}</p>
        <p className="text-xs text-on-surface-meta mt-0.5 break-words">{detail}</p>
      </div>
    </div>
  );
}
