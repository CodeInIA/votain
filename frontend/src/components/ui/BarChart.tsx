import { cn } from '../../lib/utils';

export interface BarChartCandidate {
  name: string;
  votes: number;
  isWinner?: boolean;
  isTie?: boolean;
}

interface ResultBarChartProps {
  candidates: BarChartCandidate[];
  totalVotes: number;
  className?: string;
}

export function ResultBarChart({ candidates, totalVotes, className }: ResultBarChartProps) {
  const data = candidates.map(c => ({
    ...c,
    pct: totalVotes > 0 ? Math.round((c.votes / totalVotes) * 1000) / 10 : 0,
  }));

  return (
    <div className={cn('w-full', className)}>
      {data.map(c => (
        <div key={c.name} className="flex items-center gap-3 mb-3 last:mb-0">
          <div className="w-28 sm:w-36 shrink-0 text-right">
            <span className={cn(
              'text-sm font-medium truncate block',
              c.isWinner || c.isTie ? 'text-on-surface' : 'text-on-surface-variant'
            )}>
              {c.name}
            </span>
          </div>
          <div className="flex-1 relative">
            <div className="h-8 rounded-lg bg-surface-high/50 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-lg transition-all duration-700 ease-out',
                  c.isWinner && 'bg-primary/80 shadow-[0_0_12px_rgba(79,142,247,0.4)]',
                  c.isTie    && 'bg-warning/70',
                  !c.isWinner && !c.isTie && 'bg-surface-highest'
                )}
                style={{ width: `${c.pct}%` }}
              />
            </div>
          </div>
          <div className="w-16 shrink-0 text-right">
            <span className={cn(
              'text-sm font-mono',
              c.isWinner || c.isTie ? 'text-on-surface font-semibold' : 'text-on-surface-meta'
            )}>
              {c.pct}%
            </span>
            <span className="text-xs text-on-surface-meta block">{c.votes.toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
