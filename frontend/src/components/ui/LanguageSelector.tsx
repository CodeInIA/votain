import * as Select from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { LANGUAGES, getLanguageByCode } from '../../data/languages';
import { useTapSafeSelect } from '../../hooks/useTapSafeSelect';
import { setLanguage, type Language } from '../../i18n/config';

interface LanguageSelectorProps {
  className?: string;
  align?: 'left' | 'right';
}

export function LanguageSelector({ className, align = 'right' }: LanguageSelectorProps) {
  const { i18n } = useTranslation();
  const currentLang = getLanguageByCode(i18n.language) ?? LANGUAGES[0];
  // Controlled so a tap on the trigger closes the list instead of reopening it
  // on touch devices. See the hook for what Radix does.
  const { open, onOpenChange } = useTapSafeSelect();

  return (
    <Select.Root
      open={open}
      onOpenChange={onOpenChange}
      value={currentLang.code}
      onValueChange={code => void setLanguage(code as Language)}
    >
      <Select.Trigger
        aria-label="Language"
        className={cn(
          'group flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-on-surface-variant hover:text-on-surface',
          'bg-surface-low/40 hover:bg-surface-low/70 border border-white/5 hover:border-white/10',
          'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'cursor-pointer data-[state=open]:text-on-surface',
          className
        )}
      >
        <span className="text-base leading-none">{currentLang.flag}</span>
        {/* Named at every width. It was flag-only below `sm:`, and a flag is
           not a language: several are shared, and the one shown belongs to the
           language currently set, which is the one a person looking for this
           control cannot read. It fits on a phone. */}
        <span className="font-medium">{currentLang.nativeName}</span>
        <Select.Icon asChild>
          <ChevronDown className="w-3.5 h-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          position="popper"
          side="bottom"
          align={align === 'right' ? 'end' : 'start'}
          sideOffset={6}
          className={cn(
            'z-[100] w-48 p-1 rounded-2xl',
            'bg-surface-high border border-white/8 shadow-[0_8px_32px_rgba(0,0,0,0.5)]'
          )}
        >
          <Select.Viewport className="max-h-64">
            {LANGUAGES.map(lang => (
              <Select.Item
                key={lang.code}
                value={lang.code}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl cursor-pointer select-none outline-none transition-colors',
                  'text-on-surface-variant data-[highlighted]:text-on-surface data-[highlighted]:bg-white/5',
                  'data-[state=checked]:text-on-surface data-[state=checked]:bg-primary/10'
                )}
              >
                <span className="text-base leading-none w-6 text-center">{lang.flag}</span>
                <Select.ItemText asChild>
                  <span className="font-medium flex-1 text-left">{lang.nativeName}</span>
                </Select.ItemText>
                <Select.ItemIndicator>
                  <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
