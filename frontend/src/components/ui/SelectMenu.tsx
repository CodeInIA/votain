/**
 * Styled dropdown built on Radix Select — the same primitive behind
 * LanguageSelector, so every dropdown in the app looks and behaves alike.
 *
 * Prefer this over the native `Select` in `Input.tsx`: a native <select> renders
 * OS chrome that cannot be themed to match the Liquid Glass surfaces.
 */
import * as Select from '@radix-ui/react-select';
import { ChevronDown, Check, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTapSafeSelect } from '../../hooks/useTapSafeSelect';

export interface SelectMenuOption {
  value: string;
  label: string;
  description?: string;
  /**
   * Optional glyph for the choice. Shown in the list AND on the trigger, so a
   * value the app labels with an icon elsewhere is recognisable by the same one
   * while it is being picked.
   */
  icon?: LucideIcon;
}

interface SelectMenuProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectMenuOption[];
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  className?: string;
  id?: string;
}

export function SelectMenu({
  value,
  onChange,
  options,
  label,
  hint,
  error,
  placeholder,
  className,
  id,
}: SelectMenuProps) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  const selected = options.find(o => o.value === value);
  // Controlled so a tap on the trigger closes the list instead of reopening it
  // on touch devices. See the hook for what Radix does.
  const { open, onOpenChange } = useTapSafeSelect();

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-on-surface-variant">
          {label}
        </label>
      )}

      <Select.Root open={open} onOpenChange={onOpenChange} value={value} onValueChange={onChange}>
        <Select.Trigger
          id={selectId}
          aria-label={label}
          className={cn(
            'group flex items-center justify-between gap-2 w-full h-11 px-4 rounded-xl text-sm',
            'bg-surface-lowest/60 border border-outline-variant/20 text-on-surface',
            'transition-all duration-200 cursor-pointer',
            'hover:border-outline-variant/40',
            'focus:outline-none focus:border-primary/60 focus:shadow-[0_0_0_3px_rgba(79,142,247,0.15)]',
            'data-[state=open]:border-primary/60',
            error && 'border-error/60',
            className,
          )}
        >
          <Select.Value placeholder={placeholder}>
            <span className="flex items-center gap-2 min-w-0">
              {selected?.icon && <selected.icon className="w-4 h-4 shrink-0 text-primary" strokeWidth={2.5} />}
              <span className="truncate">{selected?.label ?? placeholder}</span>
            </span>
          </Select.Value>
          <Select.Icon asChild>
            <ChevronDown className="w-4 h-4 text-on-surface-meta transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            position="popper"
            side="bottom"
            align="start"
            sideOffset={6}
            className={cn(
              'z-[100] w-[var(--radix-select-trigger-width)] p-1 rounded-2xl',
              'bg-surface-high border border-white/8 shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
            )}
          >
            <Select.Viewport className="max-h-72">
              {options.map(opt => (
                <Select.Item
                  key={opt.value}
                  value={opt.value}
                  className={cn(
                    'flex items-start gap-3 px-3 py-2.5 rounded-xl text-sm cursor-pointer select-none outline-none transition-colors',
                    'text-on-surface-variant data-[highlighted]:text-on-surface data-[highlighted]:bg-white/5',
                    'data-[state=checked]:text-on-surface data-[state=checked]:bg-primary/10',
                  )}
                >
                  {opt.icon && (
                    <opt.icon
                      className="w-4 h-4 shrink-0 mt-0.5 text-on-surface-meta"
                      strokeWidth={2.5}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <Select.ItemText asChild>
                      <span className="font-medium block">{opt.label}</span>
                    </Select.ItemText>
                    {opt.description && (
                      <span className="block text-xs text-on-surface-meta mt-0.5">{opt.description}</span>
                    )}
                  </div>
                  <Select.ItemIndicator>
                    <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>

      {error && <p className="text-xs text-error">{error}</p>}
      {!error && hint && <p className="text-xs text-on-surface-meta">{hint}</p>}
    </div>
  );
}
