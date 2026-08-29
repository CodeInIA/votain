import { Check, X, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';

export type EligibilityStatus = 'met' | 'not-met' | 'unknown';

interface EligibilityRowProps {
  label: string;
  description?: string;
  status: EligibilityStatus;
  className?: string;
}

export function EligibilityRow({ label, description, status, className }: EligibilityRowProps) {
  return (
    <div className={cn('flex items-start gap-3 py-3 border-b border-white/5 last:border-0', className)}>
      {/* Aligned to the FIRST LINE of the label, not to the block.
          `text-sm` gives a 20px line box and this circle is 24px, so centring it
          on that line means starting 2px above it: -2 + 12 puts its centre at 10,
          exactly the line's. The old `mt-0.5` pushed it 4px below instead, which
          is what showed as text sitting high against the icons.
          Doing it this way rather than with `items-center` keeps it correct when
          the label wraps to two lines or carries a description, where centring
          on the whole block would drift down as the block grows. */}
      <div className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center shrink-0 -mt-0.5',
        status === 'met'     && 'bg-green-500/10 text-green-400',
        status === 'not-met' && 'bg-error/10 text-error',
        status === 'unknown' && 'bg-surface-high text-on-surface-meta'
      )}>
        {status === 'met'     && <Check  className="w-3.5 h-3.5" strokeWidth={2.5} />}
        {status === 'not-met' && <X      className="w-3.5 h-3.5" strokeWidth={2.5} />}
        {status === 'unknown' && <Minus  className="w-3.5 h-3.5" strokeWidth={2.5} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm font-medium',
          status === 'met'     && 'text-on-surface',
          status === 'not-met' && 'text-error',
          status === 'unknown' && 'text-on-surface-variant'
        )}>
          {label}
        </p>
        {description && (
          <p className="text-xs text-on-surface-meta mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
    </div>
  );
}
