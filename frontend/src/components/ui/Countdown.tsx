import * as React from 'react';
import { cn } from '../../lib/utils';

interface TimeLeft {
  total: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calcTimeLeft(deadline: Date): TimeLeft {
  const total = Math.max(0, deadline.getTime() - Date.now());
  const seconds = Math.floor((total / 1000) % 60);
  const minutes = Math.floor((total / 1000 / 60) % 60);
  const hours   = Math.floor((total / 1000 / 3600) % 24);
  const days    = Math.floor(total / 1000 / 86400);
  return { total, days, hours, minutes, seconds };
}

function formatTimeLeft(t: TimeLeft): string {
  if (t.total <= 0) return '—';
  if (t.days > 0) return `${t.days}d ${t.hours}h ${t.minutes}m`;
  if (t.hours > 0) return `${t.hours}h ${t.minutes}m ${t.seconds}s`;
  return `${t.minutes}m ${String(t.seconds).padStart(2, '0')}s`;
}

const TZ_ABBR = new Intl.DateTimeFormat('en', { timeZoneName: 'short' })
  .formatToParts(new Date())
  .find(p => p.type === 'timeZoneName')?.value ?? '';

interface CountdownProps {
  deadline: Date;
  showTimezone?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Countdown({ deadline, showTimezone = true, className, size = 'md' }: CountdownProps) {
  const [timeLeft, setTimeLeft] = React.useState<TimeLeft>(() => calcTimeLeft(deadline));

  React.useEffect(() => {
    const id = setInterval(() => setTimeLeft(calcTimeLeft(deadline)), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const urgent = timeLeft.total > 0 && timeLeft.total < 3600_000;

  return (
    <span className={cn(
      'font-mono font-medium tabular-nums transition-colors',
      size === 'sm' && 'text-xs',
      size === 'md' && 'text-sm',
      size === 'lg' && 'text-base',
      urgent ? 'text-red-400' : 'text-on-surface-variant',
      className
    )}>
      {timeLeft.total <= 0 ? '—' : formatTimeLeft(timeLeft)}
      {showTimezone && timeLeft.total > 0 && (
        <span className={cn('ml-1 opacity-60', size === 'sm' ? 'text-[10px]' : 'text-xs')}>
          {TZ_ABBR}
        </span>
      )}
    </span>
  );
}
