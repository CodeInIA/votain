import { cn } from '../../lib/utils';

interface RadioCardProps {
  value: string;
  selected: boolean;
  onSelect: (value: string) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export function RadioCard({ value, selected, onSelect, label, description, disabled, className }: RadioCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => onSelect(value)}
      className={cn(
        'relative w-full min-h-12 px-5 py-4 rounded-2xl border text-left',
        'transition-all duration-200 cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'active:scale-[0.99]',
        selected
          ? 'bg-primary/10 border-primary/60 shadow-[0_0_0_1px_rgba(79,142,247,0.3),inset_0_0_20px_rgba(79,142,247,0.05)]'
          : 'bg-surface-lowest/40 border-outline-variant/20 hover:border-outline-variant/50 hover:bg-surface-lowest/60',
        disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          'w-5 h-5 rounded-full border-2 shrink-0 transition-all duration-200 flex items-center justify-center',
          selected ? 'border-primary bg-primary/20' : 'border-outline-variant/50'
        )}>
          {selected && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <span className={cn(
            'block text-sm font-medium leading-tight',
            selected ? 'text-on-surface' : 'text-on-surface-variant'
          )}>
            {label}
          </span>
          {description && (
            <span className="block text-xs text-on-surface-meta mt-0.5 leading-relaxed">{description}</span>
          )}
        </div>
        {selected && (
          <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-primary" />
        )}
      </div>
    </button>
  );
}

interface RadioGroupProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; description?: string; disabled?: boolean }>;
  className?: string;
}

export function RadioGroup({ value, onChange, options, className }: RadioGroupProps) {
  return (
    <div role="radiogroup" className={cn('flex flex-col gap-2', className)}>
      {options.map(opt => (
        <RadioCard
          key={opt.value}
          value={opt.value}
          label={opt.label}
          description={opt.description}
          selected={value === opt.value}
          onSelect={onChange}
          disabled={opt.disabled}
        />
      ))}
    </div>
  );
}
