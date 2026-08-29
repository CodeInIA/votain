/**
 * An election's restrictions as compact chips, for lists.
 *
 * `usePolicyRequirements` writes the rules out as sentences, which is right on
 * the election page and in the verification flow. A card has room for neither,
 * and a generic "Restricted" answers the wrong question: someone scanning a list
 * wants to know whether THEY qualify, and "18+" or a Spanish flag settles that
 * at a glance while the word "restricted" sends them into the election to find
 * out.
 *
 * Each chip keeps the full sentence as its `title`, so the short form never
 * costs the precise one.
 */
import { useTranslation } from 'react-i18next';
import { countryOption } from '../lib/countries';
import type { EligibilityPolicy } from '../lib/eligibility';

/** Beyond this the flags stop being readable and become a smear. */
const MAX_FLAGS = 3;

export type PolicyChipKind = 'age' | 'allowed' | 'blocked';

export interface PolicyChip {
  kind: PolicyChipKind;
  /** Short form, for the chip itself. */
  label: string;
  /** The full sentence, for the tooltip. */
  title: string;
}

export function usePolicyChips(policy: EligibilityPolicy | null | undefined): PolicyChip[] {
  const { t, i18n } = useTranslation();

  if (!policy) return [];

  const options = (codes: string[]) =>
    codes
      .map(code => countryOption(code, i18n.language))
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language));

  /** Flags for the chip, with a count once there are too many to read. */
  const flagLabel = (codes: string[]): string => {
    const all = options(codes);
    const shown = all.slice(0, MAX_FLAGS).map(c => c.flag).join(' ');
    return all.length > MAX_FLAGS ? `${shown} +${all.length - MAX_FLAGS}` : shown;
  };

  const sentence = (codes: string[]) =>
    options(codes).map(c => `${c.flag} ${c.name}`).join(', ');

  const chips: PolicyChip[] = [];

  if (policy.minAge !== undefined) {
    chips.push({
      kind: 'age',
      // "18+" reads the same in every language this app ships, so it stays a
      // numeral rather than becoming thirteen translations of "over 18".
      label: `${policy.minAge}+`,
      title: t('eligibility.req_min_age', { age: policy.minAge }),
    });
  }

  if (policy.allowedCountries?.length) {
    chips.push({
      kind: 'allowed',
      label: flagLabel(policy.allowedCountries),
      title: t('eligibility.req_allowed', { countries: sentence(policy.allowedCountries) }),
    });
  }

  if (policy.blockedCountries?.length) {
    chips.push({
      kind: 'blocked',
      label: flagLabel(policy.blockedCountries),
      title: t('eligibility.req_blocked', { countries: sentence(policy.blockedCountries) }),
    });
  }

  return chips;
}
