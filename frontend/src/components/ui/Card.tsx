import * as React from 'react';
import { cn } from '../../lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
  depth?: 'low' | 'mid' | 'high';
}

export function Card({ className, glass = true, depth = 'mid', children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-3xl border border-white/5 transition-all',
        glass && 'backdrop-blur-xl',
        depth === 'low'  && 'bg-surface-low/40',
        depth === 'mid'  && 'bg-surface-mid/50',
        depth === 'high' && 'bg-surface-high/60',
        /* NO BOX-SHADOW HERE, and it is not an omission.
         *
         * A drop shadow on an element that also carries `backdrop-filter` made
         * Chromium paint a band of the wrong colour along the card's bottom
         * edge, appearing after a hover anywhere on the page repainted. Bisected
         * against the running app:
         *
         *   disable the ambient blur(140px) layers  no change
         *   disable every backdrop-filter           gone
         *   remove the shadow                       gone
         *   shadow with no vertical offset          still there, fainter
         *   shadow + isolate + translateZ           still there
         *
         * So the two cannot share an element, and the shadow is the half worth
         * giving up: the glass IS the design, the depth is decoration. The
         * border and the background carry it now.
         *
         * If it is ever wanted back, it has to be painted by something that is
         * not this element, a wrapper or a pseudo-element with no
         * `backdrop-filter` of its own. Not by turning this line back on.
         */
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pt-6 pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-lg font-semibold tracking-tight text-on-surface leading-tight', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm text-on-surface-variant leading-relaxed', className)} {...props} />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pb-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-6 pb-6 pt-2 flex items-center gap-3 border-t border-white/5', className)}
      {...props}
    />
  );
}
