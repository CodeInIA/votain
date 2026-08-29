import { describe, it, expect } from 'vitest';
import { keccak256, toUtf8Bytes } from 'ethers';

import {
  canonicalPolicyJson,
  policyHash,
  isEmptyPolicy,
  normaliseCountries,
  requiresNationalityReveal,
  ZERO_HASH,
} from './eligibility';
import {
  allCountries,
  countryFlag,
  countryName,
  isKnownAlpha3,
  searchCountries,
  ALL_ALPHA3,
} from './countries';
import { matchesEligibilityFilter, isEligibilityFilterActive } from './eligibilityFilter';

/**
 * The canonical form is duplicated in `backend/src/eligibility/policy.ts`, and
 * the two are only ever compared through the hash stored on chain: the organizer
 * computes it here at creation, the backend recomputes it at enrollment. Pinning
 * the exact string in BOTH test suites is what turns a silent mismatch (which
 * would read as tampering) into a failing test.
 */
const PINNED_CANONICAL = '{"minAge":18,"allowedCountries":["ESP"]}';

describe('policy canonicalisation', () => {
  it('produces the exact string the backend suite also pins', () => {
    const policy = { minAge: 18, allowedCountries: ['ESP'] };
    expect(canonicalPolicyJson(policy)).toBe(PINNED_CANONICAL);
  });

  it('hashes to keccak256 of that string', async () => {
    const policy = { minAge: 18, allowedCountries: ['ESP'] };
    expect(await policyHash(policy)).toBe(keccak256(toUtf8Bytes(PINNED_CANONICAL)));
  });

  it('orders keys independently of how the object was built', async () => {
    const a = { allowedCountries: ['ESP'], minAge: 18 };
    const b = { minAge: 18, allowedCountries: ['ESP'] };
    expect(await policyHash(a)).toBe(await policyHash(b));
  });

  it('an empty policy hashes to the contract sentinel', async () => {
    expect(await policyHash({})).toBe(ZERO_HASH);
    expect(isEmptyPolicy({})).toBe(true);
    expect(isEmptyPolicy({ allowedCountries: [] })).toBe(true);
    expect(isEmptyPolicy({ minAge: 18 })).toBe(false);
  });

  it('sorts and deduplicates country codes, so picking order cannot change the hash', () => {
    expect(normaliseCountries(['fra', 'esp', 'ESP'])).toEqual(['ESP', 'FRA']);
  });

  it('only an allowlist costs the voter a nationality reveal', () => {
    expect(requiresNationalityReveal({ minAge: 18 })).toBe(false);
    expect(requiresNationalityReveal({ blockedCountries: ['PRK'] })).toBe(false);
    expect(requiresNationalityReveal({ allowedCountries: ['ESP'] })).toBe(true);
  });
});

describe('country data', () => {
  it('covers the whole ISO 3166-1 list', () => {
    expect(ALL_ALPHA3.length).toBeGreaterThan(240);
    expect(isKnownAlpha3('ESP')).toBe(true);
    expect(isKnownAlpha3('esp')).toBe(true);
    expect(isKnownAlpha3('XXX')).toBe(false);
  });

  it('builds flags from the alpha-2 regional indicators', () => {
    expect(countryFlag('ESP')).toBe('\u{1F1EA}\u{1F1F8}');
    expect(countryFlag('JPN')).toBe('\u{1F1EF}\u{1F1F5}');
    expect(countryFlag('XXX')).toBe('');
  });

  it('names countries in the requested language', () => {
    expect(countryName('ESP', 'en')).toBe('Spain');
    expect(countryName('ESP', 'es')).toBe('España');
    expect(countryName('DEU', 'de')).toBe('Deutschland');
  });

  it('falls back to the code itself for anything unknown', () => {
    expect(countryName('XXX', 'en')).toBe('XXX');
  });

  it('sorts by the localised name, not by code', () => {
    const names = allCountries('en').map(c => c.name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'en'))).toEqual(names);
  });
});

describe('country search', () => {
  it('matches on the localised name', () => {
    expect(searchCountries('spa', 'en').map(c => c.alpha3)).toContain('ESP');
    expect(searchCountries('españa', 'es').map(c => c.alpha3)).toContain('ESP');
  });

  it('ignores diacritics, so an unaccented keyboard still finds the country', () => {
    expect(searchCountries('espana', 'es').map(c => c.alpha3)).toContain('ESP');
  });

  it('matches on the alpha-3 code for anyone who happens to know it', () => {
    expect(searchCountries('esp', 'en').map(c => c.alpha3)).toContain('ESP');
  });

  it('matches inside the name, not only at the start', () => {
    // Someone after South Korea should find it by typing "korea".
    expect(searchCountries('korea', 'en').map(c => c.alpha3)).toContain('KOR');
  });

  it('hides what is already selected', () => {
    expect(searchCountries('spa', 'en', ['ESP']).map(c => c.alpha3)).not.toContain('ESP');
  });

  it('returns the whole list for an empty query', () => {
    expect(searchCountries('', 'en').length).toBe(ALL_ALPHA3.length);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchCountries('zzzzzz', 'en')).toEqual([]);
  });
});

describe('eligibility filtering', () => {
  const open = undefined;
  const adults = { minAge: 18 };
  const spaniards = { allowedCountries: ['ESP'] };
  const notSanctioned = { blockedCountries: ['PRK'] };

  it('is inactive until something is set', () => {
    expect(isEligibilityFilterActive({})).toBe(false);
    expect(isEligibilityFilterActive({ nationality: '' })).toBe(false);
    expect(isEligibilityFilterActive({ minAgeFrom: 18 })).toBe(true);
    expect(isEligibilityFilterActive({ nationality: 'ESP' })).toBe(true);
  });

  it('matches everything when nothing is set', () => {
    expect(matchesEligibilityFilter(open, {})).toBe(true);
    expect(matchesEligibilityFilter(adults, {})).toBe(true);
  });

  it('treats an election with no age rule as requiring zero', () => {
    // "Open to everyone" belongs in a range that starts at zero, and must not
    // be excluded just for having nothing to state.
    expect(matchesEligibilityFilter(open, { minAgeTo: 18 })).toBe(true);
    expect(matchesEligibilityFilter(open, { minAgeFrom: 18 })).toBe(false);
  });

  it('bounds the election\'s required age from both ends', () => {
    expect(matchesEligibilityFilter(adults, { minAgeFrom: 18 })).toBe(true);
    expect(matchesEligibilityFilter(adults, { minAgeFrom: 21 })).toBe(false);
    expect(matchesEligibilityFilter(adults, { minAgeTo: 18 })).toBe(true);
    expect(matchesEligibilityFilter(adults, { minAgeTo: 16 })).toBe(false);
    expect(matchesEligibilityFilter(adults, { minAgeFrom: 16, minAgeTo: 21 })).toBe(true);
  });

  it('asks whether an election ADMITS a nationality, not whether it names one', () => {
    // An unrestricted election admits everyone, so it matches every country.
    expect(matchesEligibilityFilter(open, { nationality: 'ESP' })).toBe(true);
    expect(matchesEligibilityFilter(spaniards, { nationality: 'ESP' })).toBe(true);
    expect(matchesEligibilityFilter(spaniards, { nationality: 'FRA' })).toBe(false);
  });

  it('admits anyone a blocklist does not name', () => {
    expect(matchesEligibilityFilter(notSanctioned, { nationality: 'ESP' })).toBe(true);
    expect(matchesEligibilityFilter(notSanctioned, { nationality: 'PRK' })).toBe(false);
  });

  it('is case insensitive on the country code', () => {
    expect(matchesEligibilityFilter(spaniards, { nationality: 'esp' })).toBe(true);
  });

  it('applies every set condition at once', () => {
    const policy = { minAge: 18, allowedCountries: ['ESP'] };
    expect(matchesEligibilityFilter(policy, { minAgeFrom: 18, nationality: 'ESP' })).toBe(true);
    expect(matchesEligibilityFilter(policy, { minAgeFrom: 18, nationality: 'FRA' })).toBe(false);
    expect(matchesEligibilityFilter(policy, { minAgeFrom: 21, nationality: 'ESP' })).toBe(false);
  });
});
