/**
 * Narrowing the gas tank's movement list.
 *
 * Kept out of the screen so the rules can be stated once and tested: what "the
 * same minute at both ends" means, and what happens to a movement whose date
 * could not be read. Both are decisions, not details, and neither is obvious
 * from a component that only shows the result.
 */
import type { GasMovement } from './organizer';

export interface GasFilterState {
  /** Matched against the transaction hash. */
  query: string;
  /** 'yyyy-mm-ddThh:mm', local time, or empty. */
  from: string;
  to: string;
  /**
   * Money in, money out, or money spent. Null means all three.
   *
   * A single choice rather than a set: the three are alternatives, and someone
   * narrowing by kind is looking at one of them. The tank's three events answer
   * three different questions, and mixing them is what makes a long list hard
   * to read: deposits are what you PUT IN, and the sponsored votes are what it
   * went on.
   */
  type: GasMovement['type'] | null;
}

export const EMPTY_GAS_FILTER: GasFilterState = { query: '', from: '', to: '', type: null };

export function isDateFilterActive(filter: GasFilterState): boolean {
  return Boolean(filter.from || filter.to);
}

export function isGasFilterActive(filter: GasFilterState): boolean {
  return Boolean(filter.query.trim()) || Boolean(filter.type) || isDateFilterActive(filter);
}

/** One minute, in milliseconds, minus nothing: the end of a minute is the start of the next. */
const MINUTE = 60_000;

/** 'yyyy-mm-ddThh:mm' is local time by specification, which is what was picked. */
function parseLocal(value: string): number | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isNaN(at) ? null : at;
}

/**
 * Whether a hash matches what was typed.
 *
 * The `0x` is ignored on both sides, so a hash pasted from anywhere matches a
 * search typed either way. Case is ignored too: a hash is the same value in
 * either casing, and an explorer will hand it over in whichever it prefers.
 */
function matchesHash(txHash: string, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/^0x/, '');
  if (!needle) return true;
  return txHash.toLowerCase().replace(/^0x/, '').includes(needle);
}

/**
 * Everything except the date.
 *
 * Shared with the undated count, so the warning is always about the rows the
 * rest of the filter would have shown. Counting rows the search or the kind had
 * already excluded would report money as missing that was never being looked
 * for.
 */
function matchesApartFromDate(movement: GasMovement, filter: GasFilterState): boolean {
  if (filter.type && movement.type !== filter.type) return false;
  return matchesHash(movement.txHash, filter.query);
}

export function matchesGasFilter(movement: GasMovement, filter: GasFilterState): boolean {
  if (!matchesApartFromDate(movement, filter)) return false;

  const from = parseLocal(filter.from);
  const to = parseLocal(filter.to);
  if (from === null && to === null) return true;

  /**
   * A movement with no readable date cannot be placed in time, so no date range
   * can honestly claim it. It is dropped rather than guessed at, and the screen
   * counts how many so the money is never quietly missing: this is a financial
   * record, and a row that vanishes without explanation is worse than a row
   * that says its date is unknown.
   */
  if (!movement.date) return false;

  const at = movement.date.getTime();
  if (from !== null && at < from) return false;
  /**
   * The upper bound runs to the END of its minute.
   *
   * Someone who puts the same minute at both ends is asking for that minute,
   * which is exactly the "one exact time" case. Compared against the start of
   * the minute it would be an empty window, and the honest-looking answer to a
   * reasonable question would be "no movements".
   */
  if (to !== null && at >= to + MINUTE) return false;
  return true;
}

/**
 * Movements a date filter cannot speak for.
 *
 * Only ever above zero when a provider failed to hand over a block, which is
 * rare and worth saying out loud when it happens.
 */
export function countUndated(movements: GasMovement[], filter: GasFilterState): number {
  if (!isDateFilterActive(filter)) return 0;
  return movements.filter(m => !m.date && matchesApartFromDate(m, filter)).length;
}
