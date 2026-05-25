import * as React from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { LANGUAGES, getLanguageByCode } from '../../data/languages';

interface LanguageSelectorProps {
  className?: string;
  align?: 'left' | 'right';
}

export function LanguageSelector({ className, align = 'right' }: LanguageSelectorProps) {
  const { i18n } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const currentLang = getLanguageByCode(i18n.language) ?? LANGUAGES[0];

  React.useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (code: string): void => {
    void i18n.changeLanguage(code);
    setOpen(false);
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-on-surface-variant hover:text-on-surface',
          'bg-surface-low/40 hover:bg-surface-low/70 border border-white/5 hover:border-white/10',
          'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        )}
      >
        <span className="text-base leading-none">{currentLang.flag}</span>
        <span className="hidden sm:inline font-medium">{currentLang.nativeName}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={cn(
              'absolute z-50 mt-1.5 w-48 py-1 rounded-2xl',
              'bg-surface-high/90 backdrop-blur-xl border border-white/8 shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
              align === 'right' ? 'right-0' : 'left-0'
            )}
          >
            <div className="max-h-64 overflow-y-auto scrollbar-none">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => handleSelect(lang.code)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors',
                    lang.code === currentLang.code
                      ? 'text-on-surface bg-primary/10'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
                  )}
                >
                  <span className="text-base leading-none w-6 text-center">{lang.flag}</span>
                  <span className="font-medium flex-1 text-left">{lang.nativeName}</span>
                  {lang.code === currentLang.code && (
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
