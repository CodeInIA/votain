import * as React from 'react';
import { cn } from '../../lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  lines?: number;
  circle?: boolean;
}

function SkeletonBase({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-xl bg-surface-high/60',
        className
      )}
      {...props}
    />
  );
}

export function Skeleton({ className, lines, circle, ...props }: SkeletonProps) {
  if (circle) {
    return <SkeletonBase className={cn('rounded-full', className)} {...props} />;
  }
  if (lines && lines > 1) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }, (_, i) => (
          <SkeletonBase
            key={i}
            className={cn(
              'h-4',
              i === lines - 1 ? 'w-3/4' : 'w-full',
              className
            )}
          />
        ))}
      </div>
    );
  }
  return <SkeletonBase className={className} {...props} />;
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-3xl border border-white/5 bg-surface-low/40 p-5 flex flex-col gap-4', className)}>
      <div className="flex items-center gap-3">
        <Skeleton circle className="w-10 h-10 shrink-0" />
        <div className="flex-1 flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Skeleton lines={2} />
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
  );
}
