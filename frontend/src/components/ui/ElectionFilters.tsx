/**
 * The election filter bar, shared by Discover and the organizer dashboard.
 *
 * It lives in one place because it drifted once already: the two lists grew
 * their own filter rows, the dashboard ended up with the eligibility inputs but
 * no phase chips, and an organizer looking for their restricted elections had to
 * learn a second set of rules. One component means one set.
 *
 * Controlled throughout. Each page owns the state, because each also owns the
 * list being filtered and the empty message that goes with it.
 */
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, SlidersHorizontal, X, Globe, ShieldCheck } from 'lucide-react';
import { Badge } from './Badge';
import { Button } from './Button';
import { Input } from './Input';
import { EligibilityFilterControls } from './EligibilityFilterControls';
import { cn } from '../../lib/utils';
import { VOTING_TYPE_ICONS, VOTING_TYPES, votingTypeLabelKey } from '../../lib/votingTypes';
import {
  EMPTY_FILTERS,
  PHASE_FILTERS,
  isAnyFilterActive,
  type ElectionFilterState,
} from '../../lib/electionFilter';

/**
 * A property filter: verified domain, has requirements.
 *
 * DELIBERATELY NOT A `Badge`. Those are the phase chips beside it, and every
 * hue in the palette is already spoken for by one: primary is `enrolled`,
 * secondary `tallying`, tertiary `pending_vote`, warning `tie`, error
 * `cancelled`, yellow `enrolling`, green `active`. Picking another colour could
 * only collide with a state, which is exactly the confusion this avoids.
 *
 * So it carries no hue at all. It is a square-cornered, mixed-case chip with an
 * icon, and contrast alone says whether it is on. That matches the requirement
 * chips on the cards, and gives the app one rule worth having: a rounded-full
 * uppercase pill is a PHASE, a rounded chip with an icon is a PROPERTY.
 */
function FilterToggle({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Globe;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-pointer',
        'text-xs font-semibold leading-none whitespace-nowrap ring-1 transition-colors',
        active
          ? 'bg-white/15 text-white ring-white/30'
          : 'bg-transparent text-on-surface-meta ring-outline-variant/30 hover:text-on-surface-variant hover:ring-outline-variant/50',
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />
      {children}
    </button>
  );
}

/**
 * One band of filters, under the question it answers.
 *
 * Everything used to sit in a single wrapping row: phase pills, then two
 * property chips, then the four voting rules, all the same distance apart. They
 * are four independent questions, and running them together made them look like
 * one long list of alternatives, so the second line of chips read as more of
 * whatever the first line was. A caption and a rule between bands is the whole
 * fix; nothing about how any filter behaves changes.
 */
function FilterGroup({
  label,
  first,
  children,
}: {
  label: string;
  /** No divider above the first band, since there is nothing to divide it from. */
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-2', !first && 'pt-3 border-t border-white/5')}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-meta/70">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

interface Props {
  value: ElectionFilterState;
  onChange: (next: ElectionFilterState) => void;
  /** Open state is the page's, so collapsing does not reset on every keystroke. */
  open: boolean;
  onToggleOpen: () => void;
  searchPlaceholder: string;
}

export function ElectionFilters({ value, onChange, open, onToggleOpen, searchPlaceholder }: Props) {
  const { t } = useTranslation();
  const set = (patch: Partial<ElectionFilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            placeholder={searchPlaceholder}
            value={value.query}
            onChange={e => set({ query: e.target.value })}
            leftIcon={<Search className="w-4 h-4" />}
            rightIcon={value.query ? (
              <button
                type="button"
                onClick={() => set({ query: '' })}
                aria-label={t('common.clear')}
                className="cursor-pointer hover:text-on-surface transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            ) : undefined}
          />
        </div>
        <Button
          onClick={onToggleOpen}
          className="gap-2 h-11 px-4 rounded-2xl text-sm text-on-surface-variant hover:text-on-surface"
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">{t('common.filter')}</span>
          {/* Any active filter, not just the phase: with only the domain chip
              on, the collapsed bar gave no sign the list was being filtered. */}
          {isAnyFilterActive(value) && <span className="w-2 h-2 rounded-full bg-primary" />}
        </Button>
      </div>

      {open && (
        <div className="flex flex-col gap-3">
          <FilterGroup label={t('discover.group_status')} first>
            {PHASE_FILTERS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => set({ phase: value.phase === p ? null : p })}
                className="transition-all cursor-pointer"
              >
                <Badge
                  variant={p}
                  dot={p === 'active' || p === 'enrolling'}
                  className={value.phase === p ? 'ring-2 ring-primary/40' : 'opacity-60 hover:opacity-100'}
                >
                  {t(`phase.${p}`)}
                </Badge>
              </button>
            ))}
          </FilterGroup>

          <FilterGroup label={t('discover.group_properties')}>
            {/* Only verified is offered, not its negative: "no verified domain"
                is the normal state for most organizers, so a chip for it would
                read as a category of suspicion rather than a filter. */}
            <FilterToggle
              active={value.domainOnly}
              onClick={() => set({ domainOnly: !value.domainOnly })}
              icon={Globe}
            >
              {t('discover.verified_domain')}
            </FilterToggle>

            {/* Beside the domain chip rather than with the age and nationality
                inputs, because it is the same shape of question: a yes/no
                property of the election, not a value to match against. */}
            <FilterToggle
              active={value.restrictedOnly}
              onClick={() => set({ restrictedOnly: !value.restrictedOnly })}
              icon={ShieldCheck}
            >
              {t('discover.restricted_only')}
            </FilterToggle>
          </FilterGroup>

          {/* How the election is decided, one chip per rule, with the icons the
              cards and the election views already use so a chip and a card read
              as one label.

              Single choice: the four rules are alternatives, so picking one
              clears the last, and picking the active one clears it. Same
              behaviour as the phase pills above. */}
          <FilterGroup label={t('discover.group_voting_type')}>
            {VOTING_TYPES.map(type => (
              <FilterToggle
                key={type}
                active={value.votingType === type}
                onClick={() => set({ votingType: value.votingType === type ? null : type })}
                icon={VOTING_TYPE_ICONS[type]}
              >
                {t(votingTypeLabelKey(type))}
              </FilterToggle>
            ))}
          </FilterGroup>

          {/* The only band that asks about the VOTER rather than the election:
              "would I qualify", answered with values instead of chips. */}
          <FilterGroup label={t('discover.group_eligibility')}>
            <EligibilityFilterControls
              value={value.eligibility}
              onChange={eligibility => set({ eligibility })}
            />
          </FilterGroup>
          {/* Clearing lives in the panel, not only in the empty state.
              `Discover` offered it when a filter had hidden everything, which
              is the one moment the person can already see something is wrong.
              Two chips and an age bound that merely narrow the list to a few
              are harder to notice and just as annoying to undo one at a time.

              Resets the search box too: it sits above these bands and narrows
              the same list, so leaving it behind would clear the filters and
              still show a filtered list. */}
          {(isAnyFilterActive(value) || value.query !== '') && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              className="self-start inline-flex items-center gap-1.5 pt-3 border-t border-white/5 w-full sm:w-auto sm:border-t-0 sm:pt-0 text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              <X className="w-3.5 h-3.5 shrink-0" />
              {t('common.clear_filters')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
