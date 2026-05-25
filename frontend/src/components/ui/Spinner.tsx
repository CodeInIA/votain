import { cn } from '../../lib/utils';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <svg
      className={cn(
        'animate-spin text-primary',
        size === 'sm' && 'w-4 h-4',
        size === 'md' && 'w-6 h-6',
        size === 'lg' && 'w-10 h-10',
        className
      )}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-20"
        cx="12" cy="12" r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-80"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

interface ProgressDotsProps {
  total: number;
  current: number;
  onDotClick?: (index: number) => void;
  disabled?: boolean;
  className?: string;
}

export function ProgressDots({ total, current, onDotClick, disabled, className }: ProgressDotsProps) {
  return (
    <div className={cn('flex gap-2 items-center', className)}>
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => !disabled && onDotClick?.(i)}
          disabled={disabled}
          aria-label={`Step ${i + 1}`}
          className={cn(
            'h-1.5 rounded-full transition-all duration-500',
            onDotClick ? 'cursor-pointer' : 'cursor-default',
            i === current ? 'w-8 bg-primary' : 'w-1.5 bg-outline-variant hover:bg-primary/50',
            disabled && 'pointer-events-none'
          )}
        />
      ))}
    </div>
  );
}
