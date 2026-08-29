import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { searchCountries, countryOption } from '../../lib/countries';
import type { EligibilityFilter } from '../../lib/eligibilityFilter';

/**
 * Age and nationality filters, shared by Discover and the organizer dashboard.
 *
 * Both read the same way and mean the same thing, which is why they are one
 * component: a filter that behaves differently in two lists of the same objects
 * is worse than no filter.
 *
 * The nationality control asks which elections would ADMIT a country rather than
 * which ones name it, so an unrestricted election matches every choice. That is
 * the question someone browsing is actually asking, and it keeps the filter from
 * quietly hiding everything that has no policy.
 */
interface Props {
  value: EligibilityFilter;
  onChange: (next: EligibilityFilter) => void;
  className?: string;
}

const VISIBLE_RESULTS = 40;

export function EligibilityFilterControls({ value, onChange, className }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);

  const results = useMemo(() => searchCountries(query, locale), [query, locale]);
  const selected = value.nationality ? countryOption(value.nationality, locale) : null;

  /** Empty means "no bound", which is different from zero. */
  const numeric = (raw: string): number | undefined => {
    const parsed = Number(raw);
    return raw.trim() === '' || Number.isNaN(parsed) ? undefined : parsed;
  };

  const ageField = (
    placeholder: string,
    current: number | undefined,
    apply: (next: number | undefined) => EligibilityFilter,
  ) => (
    <input
      type="number"
      min={0}
      max={120}
      inputMode="numeric"
      placeholder={placeholder}
      value={current ?? ''}
      onChange={e => onChange(apply(numeric(e.target.value)))}
      className={cn(
        'w-20 h-9 px-3 rounded-xl bg-surface-high/40 border border-outline-variant/10',
        'text-sm text-on-surface placeholder:text-on-surface-meta',
        'focus:outline-none focus:ring-2 focus:ring-primary',
      )}
    />
  );

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-on-surface-meta">{t('discover.min_age')}</span>
        {ageField(t('discover.age_from'), value.minAgeFrom, next => ({ ...value, minAgeFrom: next }))}
        <span className="text-xs text-on-surface-meta">{t('discover.age_to')}</span>
        {ageField(t('discover.age_to_placeholder'), value.minAgeTo, next => ({ ...value, minAgeTo: next }))}
      </div>

      <div className="relative">
        {selected ? (
          <span className="inline-flex items-center gap-2 h-9 pl-3 pr-2 rounded-xl bg-surface-high/60 border border-outline-variant/15">
            <span className="text-base leading-none">{selected.flag}</span>
            <span className="text-xs text-on-surface">{selected.name}</span>
            <button
              type="button"
              aria-label={t('common.clear')}
              onClick={() => { onChange({ ...value, nationality: undefined }); setQuery(''); }}
              className="text-on-surface-meta hover:text-error cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ) : (
          <>
            <span className="absolute left-3 inset-y-0 flex items-center text-on-surface-meta">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              value={query}
              placeholder={t('discover.nationality')}
              onChange={e => { setQuery(e.target.value); setListOpen(true); }}
              onFocus={() => setListOpen(true)}
              onBlur={() => setTimeout(() => setListOpen(false), 150)}
              className={cn(
                'w-44 h-9 pl-9 pr-3 rounded-xl bg-surface-high/40 border border-outline-variant/10',
                'text-sm text-on-surface placeholder:text-on-surface-meta',
                'focus:outline-none focus:ring-2 focus:ring-primary',
              )}
            />
            {listOpen && query.trim() !== '' && (
              <div className="absolute z-20 mt-2 w-56 max-h-56 overflow-y-auto rounded-2xl bg-surface-high border border-outline-variant/15 shadow-xl">
                {results.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-on-surface-meta">
                    {t('country_picker.no_results')}
                  </p>
                ) : (
                  results.slice(0, VISIBLE_RESULTS).map(country => (
                    <button
                      key={country.alpha3}
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        onChange({ ...value, nationality: country.alpha3 });
                        setQuery('');
                        setListOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-primary/10 cursor-pointer"
                    >
                      <span className="text-base leading-none w-6 text-center">{country.flag}</span>
                      <span className="flex-1 text-sm text-on-surface">{country.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
