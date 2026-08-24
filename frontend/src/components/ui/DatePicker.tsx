/**
 * Dark-themed date (and optional time) picker built on Radix Popover.
 *
 * Chromium's native <input type="date"> calendar popup follows the OS theme,
 * not the page's `color-scheme` CSS — there is no way to force it dark from
 * CSS alone. This renders the whole calendar ourselves (same pattern as
 * SelectMenu's Radix-backed dropdown) so it always matches the app's theme.
 */
import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';

interface DatePickerProps {
  label?: string;
  hint?: string;
  error?: string;
  /** 'yyyy-mm-dd', or 'yyyy-mm-ddThh:mm' when `withTime`. Empty when unset. */
  value: string;
  onChange: (value: string) => void;
  /**
   * 'yyyy-mm-dd', or 'yyyy-mm-ddThh:mm' to bound the time too. With a time, the
   * day itself stays selectable and the clock is clamped on that day only, so
   * "today" does not disappear from the calendar just because noon has passed.
   */
  min?: string;
  max?: string; // 'yyyy-mm-dd'
  /** Also pick an hour/minute. Election deadlines are timestamps, not whole days. */
  withTime?: boolean;
  id?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDateISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toValue = (d: Date, withTime: boolean) =>
  withTime ? `${toDateISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}` : toDateISO(d);

/** Parses both 'yyyy-mm-dd' and 'yyyy-mm-ddThh:mm' as local time. */
const parseValue = (s: string) => {
  const [datePart, timePart] = s.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart ? timePart.split(':').map(Number) : [0, 0];
  return new Date(y, m - 1, d, hh, mm);
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const isSameDay = (a: Date, b: Date | null) =>
  !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// A locale-agnostic "dd/mm/yyyy"-style placeholder, derived from how the
// locale actually orders/punctuates its dates instead of hardcoding one order.
const placeholderFor = (locale: string, withTime: boolean) => {
  const date = new Intl.DateTimeFormat(locale).formatToParts(new Date(2000, 0, 2)).map(p => {
    if (p.type === 'day') return 'dd';
    if (p.type === 'month') return 'mm';
    if (p.type === 'year') return 'yyyy';
    return p.value;
  }).join('');
  return withTime ? `${date} --:--` : date;
};

// Jan 1 2023 was a Sunday — used purely as a Sunday anchor to read off
// locale-correct weekday initials via Intl, independent of the current date.
const WEEKDAY_ANCHOR = new Date(2023, 0, 1);

/**
 * True on touch devices. There the OS picker is the better control — it is a
 * full-screen native wheel that already follows the phone's dark theme, and it
 * beats a cramped custom calendar on a small screen.
 */
const COARSE_POINTER = '(pointer: coarse)';
function useCoarsePointer() {
  const subscribe = React.useCallback((onChange: () => void) => {
    const mq = window.matchMedia(COARSE_POINTER);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false, // server/no-DOM: assume a mouse and render the custom calendar
  );
}

export function DatePicker({
  label, hint, error, value, onChange, min, max, withTime = false, id,
}: DatePickerProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const coarsePointer = useCoarsePointer();

  const selected = value ? parseValue(value) : null;
  const minDate = min ? parseValue(min) : null;
  const maxDate = max ? parseValue(max) : null;

  const [viewDate, setViewDate] = React.useState(() => selected ?? minDate ?? new Date());
  // Re-sync the visible month to the current value each time the popover opens.
  const handleOpenChange = (next: boolean) => {
    if (next) setViewDate(selected ?? minDate ?? new Date());
    setOpen(next);
  };

  const pickerId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  // min/max constrain the day; the caller validates the exact ordering of times.
  const isDisabled = (d: Date) =>
    (!!minDate && d < startOfDay(minDate)) || (!!maxDate && d > startOfDay(maxDate));

  const monthLabel = new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(viewDate);
  const weekdayFmt = new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' });
  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    weekdayFmt.format(new Date(WEEKDAY_ANCHOR.getFullYear(), WEEKDAY_ANCHOR.getMonth(), WEEKDAY_ANCHOR.getDate() + i)));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const startOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells: { date: Date; outside: boolean }[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, prevMonthDays - i), outside: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), outside: false });
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), outside: true });
  }

  /**
   * Raises an instant to the lower bound. The calendar can only refuse whole
   * days, so on the bound's own day every earlier hour is still reachable:
   * picking that day would otherwise land on 00:00, below a bound of 20:25.
   */
  const atLeastMin = (d: Date) => (minDate && d < minDate ? new Date(minDate) : d);

  const selectDay = (d: Date) => {
    if (isDisabled(d)) return;
    const next = new Date(d);
    if (withTime && selected) next.setHours(selected.getHours(), selected.getMinutes());
    onChange(toValue(withTime ? atLeastMin(next) : next, withTime));
    // With a time to set, keep the popover open so the user can finish there.
    if (!withTime) setOpen(false);
  };

  /** True when `d` falls on the same calendar day as the lower bound. */
  const onMinDay = (d: Date) =>
    !!minDate && startOfDay(d).getTime() === startOfDay(minDate).getTime();

  const setTimePart = (part: 'h' | 'm', raw: string) => {
    if (!selected) return;
    const n = Number(raw);
    if (!Number.isInteger(n)) return;
    const next = new Date(selected);
    if (part === 'h') next.setHours(clamp(n, 0, 23));
    else next.setMinutes(clamp(n, 0, 59));
    // The calendar can only refuse whole days, so an hour earlier than the
    // bound would otherwise slip through on the bound's own day.
    onChange(toValue(atLeastMin(next), true));
  };

  /** Lower bounds for the spinners, active only on the minimum day. */
  const minHour = selected && onMinDay(selected) && minDate ? minDate.getHours() : 0;
  const minMinute =
    selected && onMinDay(selected) && minDate && selected.getHours() === minDate.getHours()
      ? minDate.getMinutes()
      : 0;

  const timeFieldClass =
    'w-12 h-9 rounded-lg bg-surface-lowest/60 border border-outline-variant/20 text-on-surface ' +
    'text-sm text-center transition-colors focus:outline-none focus:border-primary/60 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed';

  const fieldClass = cn(
    'flex items-center justify-between gap-2 w-full h-11 px-4 rounded-xl text-sm text-left cursor-pointer',
    'bg-surface-lowest/60 border border-outline-variant/20 text-on-surface',
    'transition-all duration-200 hover:border-outline-variant/40',
    'focus:outline-none focus:border-primary/60 focus:shadow-[0_0_0_3px_rgba(79,142,247,0.15)]',
    error && 'border-error/60',
  );

  // Touch devices: hand off to the OS picker instead of the custom calendar.
  if (coarsePointer) {
    const nativeType = withTime ? 'datetime-local' : 'date';
    // A datetime-local bound needs a time component or the browser ignores it.
    const toNativeBound = (s?: string) =>
      !s ? undefined : withTime && !s.includes('T') ? `${s}T00:00` : s;

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={pickerId} className="text-sm font-medium text-on-surface-variant">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          <input
            id={pickerId}
            type={nativeType}
            value={value}
            min={toNativeBound(min)}
            max={toNativeBound(max)}
            onChange={e => onChange(e.target.value)}
            className={cn(fieldClass, 'pr-10')}
          />
          <CalendarIcon className="absolute right-3.5 w-4 h-4 text-on-surface-meta pointer-events-none" />
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
        {!error && hint && <p className="text-xs text-on-surface-meta">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label htmlFor={pickerId} className="text-sm font-medium text-on-surface-variant">
          {label}
        </label>
      )}
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger asChild>
          <button
            type="button"
            id={pickerId}
            className={cn(fieldClass, 'data-[state=open]:border-primary/60')}
          >
            <span className={cn('truncate', selected ? 'text-on-surface' : 'text-on-surface-meta')}>
              {selected
                ? new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: 'medium',
                    ...(withTime ? { timeStyle: 'short' as const } : {}),
                  }).format(selected)
                : placeholderFor(i18n.language, withTime)}
            </span>
            <CalendarIcon className="w-4 h-4 text-on-surface-meta shrink-0" />
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            className={cn(
              'z-[100] p-3 rounded-2xl bg-surface-high border border-white/8 shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
              // Match the trigger's width so the calendar lines up with the field.
              'w-[var(--radix-popover-trigger-width)] min-w-64',
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setViewDate(new Date(year, month - 1, 1))}
                className="p-1.5 rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-on-surface transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-on-surface capitalize">{monthLabel}</span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setViewDate(new Date(year, month + 1, 1))}
                className="p-1.5 rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-on-surface transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-1">
              {weekdayLabels.map((w, i) => (
                <span key={i} className="h-8 flex items-center justify-center text-xs font-medium text-on-surface-meta">
                  {w}
                </span>
              ))}
              {cells.map(({ date, outside }, i) => {
                const disabled = isDisabled(date);
                const isSelected = isSameDay(date, selected);
                const isToday = isSameDay(date, new Date());
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectDay(date)}
                    className={cn(
                      'h-8 w-8 mx-auto flex items-center justify-center text-sm rounded-lg transition-colors cursor-pointer',
                      outside && 'text-on-surface-meta/40',
                      !outside && !disabled && !isSelected && 'text-on-surface hover:bg-white/8',
                      !outside && isToday && !isSelected && 'ring-1 ring-inset ring-primary/50',
                      isSelected && 'bg-primary text-white font-semibold',
                      disabled && 'text-on-surface-meta/25 cursor-not-allowed hover:bg-transparent',
                    )}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>

            {withTime && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/8">
                <Clock className="w-4 h-4 text-on-surface-meta shrink-0" />
                <input
                  type="number"
                  min={minHour}
                  max={23}
                  aria-label="Hour"
                  disabled={!selected}
                  value={selected ? pad(selected.getHours()) : ''}
                  onChange={e => setTimePart('h', e.target.value)}
                  className={timeFieldClass}
                />
                <span className="text-on-surface-meta">:</span>
                <input
                  type="number"
                  min={minMinute}
                  max={59}
                  aria-label="Minute"
                  disabled={!selected}
                  value={selected ? pad(selected.getMinutes()) : ''}
                  onChange={e => setTimePart('m', e.target.value)}
                  className={timeFieldClass}
                />
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'ml-auto h-9 px-3 rounded-lg text-sm font-medium transition-colors cursor-pointer',
                    'bg-primary/15 text-primary hover:bg-primary/25',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                  )}
                >
                  {t('common.confirm')}
                </button>
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && <p className="text-xs text-error">{error}</p>}
      {!error && hint && <p className="text-xs text-on-surface-meta">{hint}</p>}
    </div>
  );
}
