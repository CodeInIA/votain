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
import {
  Search,
  SlidersHorizontal,
  X,
  Globe,
  ShieldCheck,
  Clock,
  CalendarCheck,
  CalendarClock,
  Ban,
  ShieldAlert,
  ArrowDownWideNarrow,
  ArrowDownNarrowWide,
  Hourglass,
  Users,
} from 'lucide-react';
import { Badge } from './Badge';
import { Button } from './Button';
import { Input } from './Input';
import { EligibilityFilterControls } from './EligibilityFilterControls';
import { SelectMenu } from './SelectMenu';
import { DatePicker } from './DatePicker';
import { cn } from '../../lib/utils';
import { VOTING_TYPE_ICONS, VOTING_TYPES, votingTypeLabelKey } from '../../lib/votingTypes';
import {
  EMPTY_FILTERS,
  PHASE_FILTERS,
  isAnyFilterActive,
  type ElectionFilterState,
} from '../../lib/electionFilter';
import { DEFAULT_SORT, SORT_OPTIONS, type ElectionSort } from '../../lib/electionSort';

/** One icon per ordering, so the trigger says which is on without being read. */
const SORT_ICONS: Record<ElectionSort, typeof Globe> = {
  newest: ArrowDownWideNarrow,
  oldest: ArrowDownNarrowWide,
  closing: Hourglass,
  enrolled: Users,
};

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
 * A form field made to sit among the chips above.
 *
 * Kept next to `FilterToggle` because it exists to match it: same 1px
 * outline over nothing, same corner radius, same text size. The height stays
 * a touch taller than a chip, since a chip is read and a date field is aimed
 * at.
 */
const FIELD_AS_CHIP =
  'h-9 rounded-lg text-xs bg-transparent border-outline-variant/30 hover:border-outline-variant/50';

/**
 * Its label, at hint weight rather than heading weight.
 *
 * The band already has a caption above it. A second bold line under it made
 * "From" and "To" look like two more bands rather than two ends of one range.
 */
const FIELD_LABEL_AS_HINT = 'text-[11px] font-medium text-on-surface-meta';

/**
 * A dropdown trigger made to sit beside the filter button in the toolbar.
 *
 * `SelectMenu` defaults to a form field: `bg-surface-lowest/60`, the darkest
 * surface, which is right in a wizard where every control is a field on a
 * card. In the toolbar its only neighbour is `Button`'s default variant, a
 * lighter `bg-surface-high/40`, so the two sat side by side at visibly
 * different weights and the order control read as the heavier, sunken one.
 *
 * These are `buttonVariants.default` written out. Not imported from it,
 * because that string also carries `rounded-full` and the focus ring for a
 * real button; only the surface is being matched here.
 */
const TRIGGER_AS_TOOLBAR_BUTTON = [
  'bg-surface-high/40 border-outline-variant/10',
  'hover:bg-surface-high/60 hover:border-outline-variant/10',
  'text-on-surface-variant hover:text-on-surface',
].join(' ');

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

  /**
   * Whether "clear" has anything to undo.
   *
   * WIDER THAN `isAnyFilterActive`, and the difference is the whole point of
   * having two. That one answers "is the list being narrowed", which drives
   * the dot warning that elections are hidden, and an order hides nothing so
   * it must stay out of it. This answers "is anything not as it was", which is
   * what the button resets: the search box and the order are both part of that
   * and neither is a filter.
   */
  const anythingToClear =
    isAnyFilterActive(value) || value.query !== '' || value.sort !== DEFAULT_SORT;

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

        {/* BESIDE THE FILTER BUTTON, NOT INSIDE THE PANEL IT OPENS, and the
            reason is the one already written into `ElectionFilterState`: an
            order is not a filter. Everything behind that button hides
            something, and the dot on it means something is hidden. This shows
            every election whichever value it has, so putting it in there
            would have made it the one control in the panel that cannot
            justify the panel's own warning, and it would have been two clicks
            away for no reason.

            A dropdown and not chips because the four are one exclusive choice
            out of a set that will grow. The current value is always visible,
            which is what a control outside a collapsed panel has to be. */}
        <SelectMenu
          value={value.sort}
          onChange={sort => set({ sort: sort as ElectionSort })}
          options={SORT_OPTIONS.map(s => ({
            value: s,
            label: t(`sort.${s}`),
            icon: SORT_ICONS[s],
          }))}
          label={t('discover.group_order')}
          // Announced, not drawn: nothing else in this row has a label above
          // it, and one here would make the row two heights.
          labelHidden
          wrapperClassName="w-auto shrink-0"
          className={cn(
            'rounded-2xl px-3 sm:px-4 max-w-[9.5rem] sm:max-w-none',
            TRIGGER_AS_TOOLBAR_BUTTON,
          )}
          // Left to size itself: the trigger is as narrow as the current
          // value here, and a menu matching it would truncate every other
          // option to the length of whichever one happens to be chosen.
          contentClassName="w-max"
        />
      </div>

      {/* IN THE TOOLBAR AND NOT ONLY IN THE PANEL, which is where it used to
          live. Collapsing the panel does not undo anything, so a list could
          sit narrowed by an age bound and a phase with the only way to undo
          them hidden behind the button that had to be pressed to see them in
          the first place.

          It appears for a non-default ORDER too. The order is not a filter and
          never lights the dot, and it is still a thing the reader changed and
          may want back: "clear" is the one control that puts the whole panel
          back to how it started. */}
      {!open && anythingToClear && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="self-start inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline cursor-pointer"
        >
          <X className="w-3.5 h-3.5 shrink-0" />
          {t('common.clear_filters')}
        </button>
      )}

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

            {/* Whatever the next deadline is: an enrolling election is measured
                against the close of enrolment and an active one against the
                close of voting. To someone deciding where to spend the evening,
                "the chance to join ends tonight" and "the chance to vote ends
                tonight" are the same news. */}
            <FilterToggle
              active={value.closingSoon}
              onClick={() => set({ closingSoon: !value.closingSoon })}
              icon={Clock}
            >
              {t('discover.closing_soon')}
            </FilterToggle>

          </FilterGroup>

          {/* The two promises an organizer makes at deployment and cannot take
              back. Named for the promises rather than for the dates, because
              the second one is not about dates at all: an election can keep
              every published date and still be called off tomorrow.

              THE DATES CHIPS OFFER BOTH ANSWERS, unlike the verified-domain
              chip above and unlike the cancel chip beside them. A missing
              domain is the normal state and a chip for it would read as
              suspicion, which is also true of "the organizer can call it off",
              the default every election has. Fixed and movable are two
              deliberate choices instead, and each is worth searching for: one
              to find the elections that cannot be cut short, the other to audit
              the ones that can. Single choice, so picking one clears the
              other. */}
          <FilterGroup label={t('discover.group_commitments')}>
            <FilterToggle
              active={value.schedule === 'fixed'}
              onClick={() => set({ schedule: value.schedule === 'fixed' ? null : 'fixed' })}
              icon={CalendarCheck}
            >
              {t('schedule.fixed')}
            </FilterToggle>
            <FilterToggle
              active={value.schedule === 'movable'}
              onClick={() => set({ schedule: value.schedule === 'movable' ? null : 'movable' })}
              icon={CalendarClock}
            >
              {t('schedule.movable_short')}
            </FilterToggle>
            {/* Independent of the two beside them, not a third and fourth
                state of the same control: the combinations are real, and
                "dates that can move on an election that cannot be called
                off" is a set someone can ask for here.

                Both answers, matching the dates. This was one chip for the
                promise alone, which left the panel offering two ways to ask
                about the schedule and one way to ask about cancelling, and
                nothing on screen explained the difference because there
                was none. */}
            <FilterToggle
              active={value.cancel === 'no_cancel'}
              onClick={() => set({ cancel: value.cancel === 'no_cancel' ? null : 'no_cancel' })}
              icon={Ban}
            >
              {t('schedule.no_cancel')}
            </FilterToggle>
            <FilterToggle
              active={value.cancel === 'can_cancel'}
              onClick={() => set({ cancel: value.cancel === 'can_cancel' ? null : 'can_cancel' })}
              icon={ShieldAlert}
            >
              {t('schedule.can_cancel_short')}
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

          {/* WHEN IT APPEARED, which no other control here can ask.
              Every date in the schedule was chosen by the organizer and can
              be set to anything; this is the one the chain wrote. So "what
              turned up this week" is a different question from "what is
              happening this week", and only this band answers it.

              Two days rather than one, because either end alone is a useful
              question: "nothing older than the first" is how someone finds
              what is new, and "nothing newer than the last" is how they read
              the platform as it stood. The upper bound runs to the end of its
              day, so the same day at both ends means that day. */}
          <FilterGroup label={t('discover.group_created')}>
            {/* Boxed to a width each. `DatePicker` is `w-full` for the create
                wizard, where it owns its column; here two of them at full
                width became two stacked rows taller than every other band in
                the panel.

                DRESSED AS CHIPS, which is the point of `FIELD_AS_CHIP`. The
                default field is a filled box, right on a form where every
                control is one, and here it sat among transparent outlined
                chips reading as a darker, heavier thing from somewhere else.
                Same outline, same corner, same text size; only the height
                keeps a little more, because a date is a target you click. */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-[9.5rem]">
                <DatePicker
                  value={value.createdFrom}
                  onChange={createdFrom => set({ createdFrom })}
                  label={t('discover.created_from')}
                  max={value.createdTo || undefined}
                  className={FIELD_AS_CHIP}
                  labelClassName={FIELD_LABEL_AS_HINT}
                  id="created-from"
                />
              </div>
              <div className="w-[9.5rem]">
                <DatePicker
                  value={value.createdTo}
                  onChange={createdTo => set({ createdTo })}
                  label={t('discover.created_to')}
                  min={value.createdFrom || undefined}
                  className={FIELD_AS_CHIP}
                  labelClassName={FIELD_LABEL_AS_HINT}
                  id="created-to"
                />
              </div>
            </div>
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
          {anythingToClear && (
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
