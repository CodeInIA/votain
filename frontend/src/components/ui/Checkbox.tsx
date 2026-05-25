import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Checkbox({ checked, onChange, label, description, disabled, id, className }: CheckboxProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <button
        role="checkbox"
        aria-checked={checked}
        id={inputId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'w-5 h-5 mt-0.5 rounded-md border-2 shrink-0 flex items-center justify-center transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          checked
            ? 'bg-primary border-primary'
            : 'bg-surface-lowest/60 border-outline-variant/50 hover:border-primary/50',
          disabled && 'opacity-40 cursor-not-allowed pointer-events-none'
        )}
      >
        {checked && <Check className="w-3 h-3 text-background" strokeWidth={3} />}
      </button>
      {(label || description) && (
        <div className="flex flex-col gap-0.5">
          {label && (
            <label htmlFor={inputId} className="text-sm font-medium text-on-surface cursor-pointer">
              {label}
            </label>
          )}
          {description && (
            <span className="text-xs text-on-surface-meta leading-relaxed">{description}</span>
          )}
        </div>
      )}
    </div>
  );
}
