import { useTranslation } from 'react-i18next';
import { countryOption } from '../lib/countries';
import { effectivePersonhood, type EligibilityPolicy } from '../lib/eligibility';

/**
 * An election's attribute restrictions, written out for a reader.
 *
 * Shared so the election page and the verification flow cannot describe the same
 * policy differently. Countries are named in the reader's own language with
 * their flag, never as raw ISO codes: "ESP, PRT" asks someone to decode
 * something they were never told.
 *
 * Returns an empty array for an unrestricted election, so a caller can use the
 * length to decide whether to render anything at all.
 */
export function usePolicyRequirements(policy: EligibilityPolicy | null | undefined): string[] {
  const { t, i18n } = useTranslation();

  if (!policy) return [];

  const named = (codes: string[]) =>
    codes
      .map(code => countryOption(code, i18n.language))
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language))
      .map(country => `${country.flag} ${country.name}`)
      .join(', ');

  const requirements: string[] = [];

  // Stated first and in full: it is the requirement that decides what has to
  // happen before any of the others can even be checked.
  const personhood = effectivePersonhood(policy);
  if (personhood !== 'device') {
    requirements.push(t(`eligibility.personhood_${personhood}_hint`));
  }

  if (policy.minAge !== undefined) {
    requirements.push(t('eligibility.req_min_age', { age: policy.minAge }));
  }
  if (policy.allowedCountries?.length) {
    requirements.push(t('eligibility.req_allowed', { countries: named(policy.allowedCountries) }));
  }
  if (policy.blockedCountries?.length) {
    requirements.push(t('eligibility.req_blocked', { countries: named(policy.blockedCountries) }));
  }

  return requirements;
}
