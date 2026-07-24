import { useTranslation } from 'react-i18next';
import { Fuel, AlertTriangle, TrendingDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { chainInfo } from '../../lib/deployments';
import { Button } from './Button';

interface GasWidgetProps {
  /** Sponsored gas balance, in the chain's native token. */
  balance: number;
  estimatedVotesLeft?: number;
  onDeposit?: () => void;
  className?: string;
}

function getLevel(balance: number): 'good' | 'low' | 'critical' {
  if (balance > 1.0) return 'good';
  if (balance > 0.2) return 'low';
  return 'critical';
}

export function GasWidget({ balance, estimatedVotesLeft, onDeposit, className }: GasWidgetProps) {
  const { t } = useTranslation();
  const level = getLevel(balance);

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all',
      level === 'good'     && 'bg-green-500/5  border-green-500/15',
      level === 'low'      && 'bg-yellow-400/5 border-yellow-400/15',
      level === 'critical' && 'bg-error/5      border-error/20',
      className
    )}>
      <div className={cn(
        'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
        level === 'good'     && 'bg-green-500/10  text-green-400',
        level === 'low'      && 'bg-yellow-400/10 text-yellow-400',
        level === 'critical' && 'bg-error/10      text-error'
      )}>
        {level === 'critical' ? (
          <AlertTriangle className="w-4.5 h-4.5" />
        ) : level === 'low' ? (
          <TrendingDown className="w-4.5 h-4.5" />
        ) : (
          <Fuel className="w-4.5 h-4.5" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm font-semibold',
          level === 'good'     && 'text-green-300',
          level === 'low'      && 'text-yellow-300',
          level === 'critical' && 'text-error'
        )}>
          {balance.toFixed(4)} {chainInfo.currency}
        </p>
        {estimatedVotesLeft !== undefined && (
          <p className="text-xs text-on-surface-meta">
            {t('gas.votes_remaining', { count: estimatedVotesLeft })}
          </p>
        )}
      </div>

      {onDeposit && (level === 'low' || level === 'critical') && (
        <Button
          size="sm"
          onClick={onDeposit}
          className="text-xs font-semibold bg-primary/20 text-primary-dim border-0 hover:bg-primary/30 shrink-0"
        >
          {t('election.top_up')}
        </Button>
      )}
    </div>
  );
}
