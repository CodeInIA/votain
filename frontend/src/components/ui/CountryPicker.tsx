/**
 * Country multi-select with live search.
 *
 * The organizer types part of a country name in their own language and picks
 * from the list; chosen countries appear as removable cards with their flag.
 * ISO codes are never typed and barely shown, because nobody knows offhand that
 * Spain is ESP and a typo there silently produces a policy that excludes the
 * wrong country.
 *
 * Names and sorting come from `lib/countries.ts`, which reads them out of
 * `Intl.DisplayNames` in the active locale, so this list is translated into all
 * thirteen languages without a single string in the locale files.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { searchCountries, countryOption } from '../../lib/countries';

interface CountryPickerProps {
  /** Selected alpha-3 codes. */
  value: string[];
  onChange: (codes: string[]) => void;
  label?: string;
  hint?: string;
  error?: string;
  /** Refuses to add beyond this many. */
  max?: number;
  placeholder?: string;
}

/** How many matches to render at once. The full list is 250 rows. */
const VISIBLE_RESULTS = 60;

export function CountryPicker({
  value,
  onChange,
  label,
  hint,
  error,
  max,
  placeholder,
}: CountryPickerProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clicking anywhere else closes the list. Without this the results sit over
  // the rest of the step until the field is focused again.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const results = useMemo(
    () => searchCountries(query, locale, value),
    [query, locale, value],
  );

  const selected = useMemo(
    () => value.map(code => countryOption(code, locale))
      .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [value, locale],
  );

  const atLimit = max !== undefined && value.length >= max;

  const add = (alpha3: string) => {
    if (atLimit || value.includes(alpha3)) return;
    onChange([...value, alpha3]);
    setQuery('');
    // Focus stays in the field so several countries can be added in a row
    // without reaching for the mouse between each one.
    inputRef.current?.focus();
  };

  const remove = (alpha3: string) => onChange(value.filter(code => code !== alpha3));

  return (
    <div className="flex flex-col gap-2" ref={containerRef}>
      {label && (
        <label className="text-xs font-semibold text-on-surface-variant">{label}</label>
      )}

      <div className="relative">
        <span className="absolute left-4 inset-y-0 flex items-center text-on-surface-meta">
          <Search className="w-4 h-4" />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={atLimit}
          placeholder={atLimit ? t('country_picker.limit_reached', { max }) : (placeholder ?? t('country_picker.placeholder'))}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Escape') { setOpen(false); return; }
            // Enter takes the top match, so a full name can be typed and
            // confirmed without leaving the keyboard.
            if (e.key === 'Enter' && results.length > 0) {
              e.preventDefault();
              add(results[0].alpha3);
            }
          }}
          className={cn(
            'w-full h-12 pl-11 pr-10 rounded-2xl bg-surface-high/40 border text-sm text-on-surface',
            'placeholder:text-on-surface-meta focus:outline-none focus:ring-2 focus:ring-primary',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error ? 'border-error/50' : 'border-outline-variant/10',
          )}
        />
        {query && (
          <button
            type="button"
            aria-label={t('common.clear')}
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            className="absolute right-3 inset-y-0 flex items-center text-on-surface-meta hover:text-on-surface cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {open && !atLimit && (
          <div className="absolute z-20 mt-2 w-full max-h-64 overflow-y-auto rounded-2xl bg-surface-high border border-outline-variant/15 shadow-xl">
            {results.length === 0 ? (
              <p className="px-4 py-3 text-xs text-on-surface-meta">
                {t('country_picker.no_results')}
              </p>
            ) : (
              results.slice(0, VISIBLE_RESULTS).map(country => (
                <button
                  key={country.alpha3}
                  type="button"
                  onClick={() => add(country.alpha3)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-primary/10 cursor-pointer"
                >
                  <span className="text-base leading-none w-6 text-center">{country.flag}</span>
                  <span className="flex-1 text-sm text-on-surface">{country.name}</span>
                  <span className="text-[11px] text-on-surface-meta tabular-nums">{country.alpha3}</span>
                  <Plus className="w-3.5 h-3.5 text-on-surface-meta" />
                </button>
              ))
            )}
            {results.length > VISIBLE_RESULTS && (
              <p className="px-4 py-2 text-[11px] text-on-surface-meta border-t border-outline-variant/10">
                {t('country_picker.more_results', { count: results.length - VISIBLE_RESULTS })}
              </p>
            )}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {selected.map(country => (
            <span
              key={country.alpha3}
              className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full bg-surface-high/60 border border-outline-variant/15"
            >
              <span className="text-base leading-none">{country.flag}</span>
              <span className="text-xs text-on-surface">{country.name}</span>
              <button
                type="button"
                aria-label={t('country_picker.remove', { country: country.name })}
                onClick={() => remove(country.alpha3)}
                className="text-on-surface-meta hover:text-error cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : hint ? (
        <p className="text-xs text-on-surface-meta">{hint}</p>
      ) : null}
    </div>
  );
}
