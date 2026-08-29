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
        /* The label takes a full line of its own on narrow screens and only sits
           beside the bar once there is room. A fixed 7rem column truncated every
           option whose name is a sentence, and "Blank vote / Abstain" is one, so
           a phone showed results with the choices cut off. It also never
           truncates now: a candidate name is the one thing on this chart that
           cannot be inferred from what is left. */
        <div key={c.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 last:mb-0">
          <div className="w-full sm:w-36 sm:shrink-0 text-left sm:text-right">
            <span className={cn(
              'text-sm font-medium block break-words',
              c.isWinner || c.isTie ? 'text-on-surface' : 'text-on-surface-variant'
            )}>
              {c.name}
            </span>
          </div>
          <div className="flex-1 min-w-0 relative">
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
