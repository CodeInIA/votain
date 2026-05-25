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
        'shadow-[0_8px_32px_rgba(0,0,0,0.4)]',
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
