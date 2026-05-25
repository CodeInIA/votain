import { useState, useCallback } from 'react';
import { cn } from '../../lib/utils';

interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export function Avatar({ src, alt, fallback, size = 'md', className }: AvatarProps) {
  const [error, setError] = useState(false);
  const sizeClass = {
    xs: 'w-6 h-6 text-xs',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-base',
  }[size];

  return (
    <div className={cn(
      'rounded-full bg-surface-high border border-white/10 flex items-center justify-center overflow-hidden shrink-0',
      sizeClass,
      className
    )}>
      {src && !error ? (
        <img src={src} alt={alt} onError={() => setError(true)} className="w-full h-full object-cover" />
      ) : (
        <span className="font-semibold text-on-surface-variant uppercase select-none">
          {fallback ? fallback.slice(0, 2) : '?'}
        </span>
      )}
    </div>
  );
}

interface IdentityCommitmentProps {
  commitment: string;
  prefixChars?: number;
  suffixChars?: number;
  className?: string;
  copyable?: boolean;
}

export function IdentityCommitment({
  commitment,
  prefixChars = 6,
  suffixChars = 4,
  className,
  copyable = false,
}: IdentityCommitmentProps) {
  const [copied, setCopied] = useState(false);
  const truncated = `${commitment.slice(0, prefixChars)}…${commitment.slice(-suffixChars)}`;

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(commitment);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  }, [commitment]);

  const content = (
    <span className={cn(
      'font-mono text-xs text-on-surface-variant bg-surface-lowest/60 px-2 py-0.5 rounded-lg',
      copyable && 'cursor-pointer hover:text-on-surface hover:bg-surface-lowest transition-colors',
      className
    )}>
      {copied ? '✓ Copied' : truncated}
    </span>
  );

  if (copyable) {
    return (
      <button type="button" onClick={handleCopy} title={commitment}>
        {content}
      </button>
    );
  }
  return content;
}
