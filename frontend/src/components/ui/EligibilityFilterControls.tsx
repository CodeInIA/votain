import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, IdCard, ScanFace } from 'lucide-react';
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
        'flex-1 min-w-0 sm:flex-none sm:w-20 h-9 px-3 rounded-xl bg-surface-high/40 border border-outline-variant/10',
        'text-sm text-on-surface placeholder:text-on-surface-meta',
        'focus:outline-none focus:ring-2 focus:ring-primary',
      )}
    />
  );

  /**
   * The personhood levels, as the same two shapes the cards carry.
   *
   * Deliberately the same icon, the same wording and the same colour as the
   * chip on the election card: someone who saw "Orb" on a card and wants more
   * of those should recognise the control that finds them without reading it.
   * `device` is not offered, because on a card it is the ABSENCE of a chip and
   * a filter for "elections with no personhood requirement" is what the
   * unrestricted toggle beside it already means.
   */
  const levelToggle = (level: 'document' | 'orb', Icon: typeof IdCard) => {
    const selectedLevels = value.personhood ?? [];
    const on = selectedLevels.includes(level);
    return (
      <button
        key={level}
        type="button"
        aria-pressed={on}
        onClick={() =>
          onChange({
            ...value,
            personhood: on
              ? selectedLevels.filter(l => l !== level)
              : [...selectedLevels, level],
          })
        }
        className={cn(
          'inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border text-xs font-semibold',
          'transition-colors cursor-pointer whitespace-nowrap',
          on
            ? 'bg-primary/15 border-primary/40 text-on-surface'
            : 'bg-surface-high/40 border-outline-variant/10 text-on-surface-variant hover:border-outline-variant/30',
        )}
      >
        <Icon className={cn('w-3.5 h-3.5 shrink-0', on ? 'text-primary' : 'text-on-surface-meta')} strokeWidth={2.5} />
        {t(`eligibility.personhood_${level}_short`)}
      </button>
    );
  };

  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center', className)}>
      <div className="flex items-center gap-2">
        {levelToggle('document', IdCard)}
        {levelToggle('orb', ScanFace)}
      </div>

      {/* One row per group on a phone. Squeezed onto one line, the two age
          boxes and their two labels left about forty pixels for each number,
          and the nationality search ended up alone on a line at a third of the
          width. */}
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <span className="text-xs text-on-surface-meta shrink-0">{t('discover.min_age')}</span>
        {ageField(t('discover.age_from'), value.minAgeFrom, next => ({ ...value, minAgeFrom: next }))}
        <span className="text-xs text-on-surface-meta shrink-0">{t('discover.age_to')}</span>
        {ageField(t('discover.age_to_placeholder'), value.minAgeTo, next => ({ ...value, minAgeTo: next }))}
      </div>

      <div className="relative w-full sm:w-auto">
        {selected ? (
          <span className="inline-flex w-full sm:w-auto items-center gap-2 h-9 pl-3 pr-2 rounded-xl bg-surface-high/60 border border-outline-variant/15">
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
                'w-full sm:w-44 h-9 pl-9 pr-3 rounded-xl bg-surface-high/40 border border-outline-variant/10',
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
