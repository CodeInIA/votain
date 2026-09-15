import { describe, it, expect } from 'vitest';
import {
  matchesGasFilter,
  countUndated,
  isGasFilterActive,
  EMPTY_GAS_FILTER,
  type GasFilterState,
} from './gasFilter';
import type { GasMovement } from './organizer';

const at = (iso: string): GasMovement => ({
  type: 'spent',
  amount: -0.01,
  date: new Date(iso),
  txHash: '0xAbCdEf0123456789',
  blockNumber: 1,
});

const filter = (over: Partial<GasFilterState> = {}): GasFilterState => ({
  ...EMPTY_GAS_FILTER,
  ...over,
});

describe('matchesGasFilter', () => {
  it('lets everything through when nothing is set', () => {
    expect(isGasFilterActive(EMPTY_GAS_FILTER)).toBe(false);
    expect(matchesGasFilter(at('2026-09-15T12:30'), EMPTY_GAS_FILTER)).toBe(true);
  });

  it('finds a hash however it was typed', () => {
    const movement = at('2026-09-15T12:30');
    expect(matchesGasFilter(movement, filter({ query: 'abcdef' }))).toBe(true);
    expect(matchesGasFilter(movement, filter({ query: '0xABCDEF' }))).toBe(true);
    expect(matchesGasFilter(movement, filter({ query: '  0123456789  ' }))).toBe(true);
    expect(matchesGasFilter(movement, filter({ query: 'deadbeef' }))).toBe(false);
  });

  it('treats the same minute at both ends as that one minute', () => {
    // The "one exact time" case. Against the start of the minute this window
    // would be empty, and a reasonable question would get a misleading "none".
    const exact = filter({ from: '2026-09-15T12:30', to: '2026-09-15T12:30' });
    expect(matchesGasFilter(at('2026-09-15T12:30:00'), exact)).toBe(true);
    expect(matchesGasFilter(at('2026-09-15T12:30:59'), exact)).toBe(true);
    expect(matchesGasFilter(at('2026-09-15T12:31:00'), exact)).toBe(false);
    expect(matchesGasFilter(at('2026-09-15T12:29:59'), exact)).toBe(false);
  });

  it('accepts an open range at either end', () => {
    const movement = at('2026-09-15T12:30');
    expect(matchesGasFilter(movement, filter({ from: '2026-09-15T00:00' }))).toBe(true);
    expect(matchesGasFilter(movement, filter({ from: '2026-09-16T00:00' }))).toBe(false);
    expect(matchesGasFilter(movement, filter({ to: '2026-09-15T23:59' }))).toBe(true);
    expect(matchesGasFilter(movement, filter({ to: '2026-09-15T11:00' }))).toBe(false);
  });

  it('drops a movement with no date from a date range, and counts it', () => {
    const undated: GasMovement = { ...at('2026-09-15T12:30'), date: undefined };
    const range = filter({ from: '2026-09-15T00:00', to: '2026-09-15T23:59' });

    // No range can honestly claim a movement that cannot be placed in time.
    expect(matchesGasFilter(undated, range)).toBe(false);
    // But it is never quietly missing: the screen says how many.
    expect(countUndated([undated], range)).toBe(1);
    // With no date filter there is nothing to warn about.
    expect(countUndated([undated], EMPTY_GAS_FILTER)).toBe(0);
    expect(matchesGasFilter(undated, filter({ query: 'abcdef' }))).toBe(true);
  });

  it('counts only the undated rows the search would have shown', () => {
    const mine: GasMovement = { ...at('2026-09-15T12:30'), date: undefined };
    const other: GasMovement = { ...mine, txHash: '0x9999999999999999' };
    const range = filter({ query: 'abcdef', from: '2026-09-15T00:00' });
    expect(countUndated([mine, other], range)).toBe(1);
  });
});

describe('the kind of movement', () => {
  const deposit: GasMovement = { ...at('2026-09-15T12:00'), type: 'deposit', amount: 1 };
  const spent: GasMovement = { ...at('2026-09-15T12:00'), type: 'spent', amount: -0.01 };
  const withdraw: GasMovement = { ...at('2026-09-15T12:00'), type: 'withdraw', amount: -0.5 };

  it('shows one kind at a time, or all of them', () => {
    expect([deposit, spent, withdraw].filter(m => matchesGasFilter(m, filter({ type: 'deposit' }))))
      .toEqual([deposit]);
    expect([deposit, spent, withdraw].filter(m => matchesGasFilter(m, filter({ type: null }))))
      .toHaveLength(3);
  });

  it('counts undated rows only within the kind being looked at', () => {
    // The warning has to be about the rows the rest of the filter would have
    // shown. Counting a withdrawal while the reader is looking at deposits
    // would report money as missing that was never being looked for.
    const undatedSpent: GasMovement = { ...spent, date: undefined };
    const undatedDeposit: GasMovement = { ...deposit, date: undefined };
    const range = filter({ type: 'deposit', from: '2026-09-15T00:00' });
    expect(countUndated([undatedSpent, undatedDeposit], range)).toBe(1);
  });

  it('counts the kind as narrowing the list', () => {
    expect(isGasFilterActive(filter({ type: 'spent' }))).toBe(true);
  });
});
