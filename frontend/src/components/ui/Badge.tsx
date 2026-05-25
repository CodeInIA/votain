import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide uppercase select-none transition-colors',
  {
    variants: {
      variant: {
        enrolling:  'bg-yellow-400/10 text-yellow-400 ring-1 ring-yellow-400/20',
        enrolled:   'bg-primary/10 text-primary-dim ring-1 ring-primary/20',
        active:     'bg-green-400/10 text-green-400 ring-1 ring-green-400/20',
        voted:      'bg-green-600/10 text-green-300 ring-1 ring-green-600/20',
        tallying:   'bg-secondary/10 text-secondary-dim ring-1 ring-secondary/20',
        closed:     'bg-white/5 text-on-surface-variant ring-1 ring-white/10',
        voided:     'bg-white/5 text-on-surface-meta ring-1 ring-white/10',
        cancelled:  'bg-error/10 text-error ring-1 ring-error/20',
        voter:      'bg-tertiary/10 text-tertiary ring-1 ring-tertiary/20',
        organizer:  'bg-secondary/10 text-secondary-dim ring-1 ring-secondary/20',
        tie:        'bg-warning/10 text-warning ring-1 ring-warning/20',
        blockchain: 'bg-primary/10 text-primary-dim ring-1 ring-primary/20',
        ipfs:       'bg-tertiary/10 text-tertiary ring-1 ring-tertiary/20',
        default:    'bg-white/5 text-on-surface-variant ring-1 ring-white/10',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

const DOT_COLORS: Record<string, string> = {
  enrolling:  'bg-yellow-400',
  enrolled:   'bg-primary',
  active:     'bg-green-400',
  voted:      'bg-green-300',
  tallying:   'bg-secondary-dim',
  closed:     'bg-on-surface-meta',
  voided:     'bg-on-surface-meta',
  cancelled:  'bg-error',
  voter:      'bg-tertiary',
  organizer:  'bg-secondary-dim',
  tie:        'bg-warning',
  blockchain: 'bg-primary',
  ipfs:       'bg-tertiary',
  default:    'bg-on-surface-meta',
};

export function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  const key = variant ?? 'default';
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props}>
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', DOT_COLORS[key] ?? 'bg-on-surface-meta')} />
      )}
      {children}
    </span>
  );
}
