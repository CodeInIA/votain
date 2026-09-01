import { describe, it, expect } from 'vitest';
import { keccak256, toUtf8Bytes } from 'ethers';

import type { EligibilityPolicy, PersonhoodLevel } from './eligibility';
import {
  canonicalPolicyJson,
  policyHash,
  isEmptyPolicy,
  normaliseCountries,
  requiresNationalityReveal,
  effectivePersonhood,
  hasAttributeRules,
  asPersonhoodLevel,
  personhoodSatisfied,
  eligibilityErrorKey,
  eligibilityErrorIsRetryable,
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

  it('serialises the personhood level exactly as the backend suite pins it', () => {
    // Both sides append it last and only when stated, which is what keeps every
    // election published before the field existed hashing to its own value.
    expect(canonicalPolicyJson({ minAge: 18, personhood: 'orb' })).toBe(
      '{"minAge":18,"personhood":"orb"}',
    );
    expect(canonicalPolicyJson({ minAge: 18, allowedCountries: ['ESP'] })).toBe(PINNED_CANONICAL);
  });

  it('reads an attribute policy as document level, stated or not', () => {
    expect(effectivePersonhood({ minAge: 18 })).toBe('document');
    expect(effectivePersonhood({})).toBe('device');
    expect(effectivePersonhood({ personhood: 'orb', minAge: 18 })).toBe('orb');
    expect(effectivePersonhood({ personhood: 'device', minAge: 18 })).toBe('device');
  });

  it('treats a level with no attribute rules as a real policy', async () => {
    const policy = { personhood: 'document' } as const;
    expect(hasAttributeRules(policy)).toBe(false);
    // It still needs an attester and a non-zero hash: reading it as empty would
    // deploy an election that asks for a document and lets anyone in.
    expect(isEmptyPolicy(policy)).toBe(false);
    expect(await policyHash(policy)).not.toBe(ZERO_HASH);
    // And `device` alone is still nothing at all.
    expect(isEmptyPolicy({ personhood: 'device' })).toBe(true);
    expect(await policyHash({ personhood: 'device' })).toBe(ZERO_HASH);
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

describe('does this voter reach the bar', () => {
  /**
   * Drives a green tick on the election page. Getting it wrong upwards promises
   * a voter an enrollment the backend will refuse; getting it wrong downwards
   * only sends them to check their World ID again.
   */

  it('reads the two vocabularies as one', () => {
    // The backend calls the floor `any`, a policy calls it `device`.
    expect(asPersonhoodLevel('any')).toBe('device');
    expect(asPersonhoodLevel('device')).toBe('device');
    expect(asPersonhoodLevel('document')).toBe('document');
    expect(asPersonhoodLevel('orb')).toBe('orb');
  });

  it('refuses to invent a level out of nothing', () => {
    expect(asPersonhoodLevel(null)).toBe(null);
    expect(asPersonhoodLevel(undefined)).toBe(null);
    expect(asPersonhoodLevel('selfie')).toBe(null);
  });

  it('lets anyone signed in past a device-level election', () => {
    expect(personhoodSatisfied('device', 'device')).toBe(true);
    // Even with nothing known: the bar is being signed in, and they are.
    expect(personhoodSatisfied('device', null)).toBe(true);
  });

  it('treats an unknown level as unproved, never as a low one that passes', () => {
    // A credential issued before the level was recorded, or a backend that
    // could not be reached. Neither is evidence.
    expect(personhoodSatisfied('document', null)).toBe(false);
    expect(personhoodSatisfied('orb', null)).toBe(false);
  });

  it('lets a stronger credential satisfy a weaker demand, and not the reverse', () => {
    expect(personhoodSatisfied('document', 'orb')).toBe(true);
    expect(personhoodSatisfied('orb', 'document')).toBe(false);
    expect(personhoodSatisfied('document', 'device')).toBe(false);
    expect(personhoodSatisfied('orb', 'orb')).toBe(true);
  });
});

describe('what the voter is told when eligibility refuses them', () => {
  it('names the refusal it can do something about', () => {
    // The card printed one generic line and dropped the reason, so a voter
    // refused for want of an Orb was told nothing they could act on.
    expect(eligibilityErrorKey('orb_required')).toBe('eligibility.error_orb_required');
  });

  it('recognises an expired session by either name it arrives under', () => {
    // The polling loop normalises a vanished session to 'expired'; the endpoint
    // itself says 'session expired'.
    expect(eligibilityErrorKey('expired')).toBe('eligibility.error_session_expired');
    expect(eligibilityErrorKey('session expired')).toBe('eligibility.error_session_expired');
  });

  it('keeps the generic line for anything it does not recognise', () => {
    // An internal failure is not made clearer by being shown raw to a voter,
    // and matching prose loosely would start misreading it the day it is
    // reworded.
    expect(eligibilityErrorKey('could not sign attestation')).toBe('eligibility.error');
    expect(eligibilityErrorKey(null)).toBe('eligibility.error');
    expect(eligibilityErrorKey('orb')).toBe('eligibility.error');
  });

  it('offers a retry only where one could work', () => {
    expect(eligibilityErrorIsRetryable('orb_required')).toBe(false);
    expect(eligibilityErrorIsRetryable('expired')).toBe(true);
    expect(eligibilityErrorIsRetryable(null)).toBe(true);
  });
});

describe('filtering by the level a card shows', () => {
  /**
   * The control mirrors the chip on the election card, so the two have to agree
   * about what a level means. Matched exactly and not "at least": picking
   * Document must not return the Orb elections, because the card in front of
   * the reader says Orb.
   */
  const keeps = (policy: EligibilityPolicy | undefined, levels: PersonhoodLevel[]) =>
    matchesEligibilityFilter(policy, { personhood: levels });

  it('finds the elections whose badge is the one that was picked', () => {
    expect(keeps({ personhood: 'document' }, ['document'])).toBe(true);
    expect(keeps({ personhood: 'orb' }, ['orb'])).toBe(true);
  });

  it('does not let a stronger level answer for a weaker one', () => {
    expect(keeps({ personhood: 'orb' }, ['document'])).toBe(false);
    expect(keeps({ personhood: 'document' }, ['orb'])).toBe(false);
  });

  it('reads an attribute policy as the document level it implicitly is', () => {
    // No `personhood` field, but a card shows it at document level, so the
    // filter has to find it there too.
    expect(keeps({ minAge: 18 }, ['document'])).toBe(true);
  });

  it('takes both levels at once, like the chips', () => {
    expect(keeps({ personhood: 'orb' }, ['document', 'orb'])).toBe(true);
    expect(keeps({ minAge: 18 }, ['document', 'orb'])).toBe(true);
  });

  it('drops an unrestricted election when a level is demanded', () => {
    expect(keeps(undefined, ['document'])).toBe(false);
    expect(keeps({}, ['orb'])).toBe(false);
  });

  it('keeps everything when no level is picked', () => {
    expect(keeps(undefined, [])).toBe(true);
    expect(matchesEligibilityFilter(undefined, {})).toBe(true);
  });

  it('counts as an active filter, so the panel can say so', () => {
    expect(isEligibilityFilterActive({ personhood: ['orb'] })).toBe(true);
    expect(isEligibilityFilterActive({ personhood: [] })).toBe(false);
  });
});

describe('how the four eligibility filters combine', () => {
  /**
   * Two different questions, and they get two different answers.
   *
   * ACROSS the dimensions it is AND: level, age and nationality each narrow the
   * list further, because they ask about independent properties and someone
   * setting all three means all three.
   *
   * WITHIN the level chips it is OR, like the phase chips above them. It has to
   * be: an election has exactly ONE personhood level, so an AND between Document
   * and Orb would be unsatisfiable by construction and the second click would
   * always empty the list.
   */

  const spanish18Orb: EligibilityPolicy = {
    personhood: 'orb',
    minAge: 18,
    allowedCountries: ['ESP'],
  };

  it('requires every dimension at once', () => {
    expect(
      matchesEligibilityFilter(spanish18Orb, {
        personhood: ['orb'],
        minAgeFrom: 18,
        nationality: 'ESP',
      }),
    ).toBe(true);
  });

  it('drops the election when any single dimension disagrees', () => {
    // The level is wrong, the rest match.
    expect(
      matchesEligibilityFilter(spanish18Orb, { personhood: ['document'], minAgeFrom: 18, nationality: 'ESP' }),
    ).toBe(false);
    // The age is wrong.
    expect(
      matchesEligibilityFilter(spanish18Orb, { personhood: ['orb'], minAgeFrom: 21, nationality: 'ESP' }),
    ).toBe(false);
    // The nationality is wrong: this election admits Spain and nowhere else.
    expect(
      matchesEligibilityFilter(spanish18Orb, { personhood: ['orb'], minAgeFrom: 18, nationality: 'FRA' }),
    ).toBe(false);
  });

  it('treats the two level chips as alternatives, not as a conjunction', () => {
    const both: PersonhoodLevel[] = ['document', 'orb'];
    expect(matchesEligibilityFilter({ personhood: 'orb' }, { personhood: both })).toBe(true);
    expect(matchesEligibilityFilter({ personhood: 'document' }, { personhood: both })).toBe(true);
  });
});
