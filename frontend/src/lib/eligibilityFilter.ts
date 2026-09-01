import { effectivePersonhood, type EligibilityPolicy, type PersonhoodLevel } from './eligibility';

/**
 * Filtering a list of elections by the restrictions they declare.
 *
 * Shared by Discover and the organizer dashboard so the same controls mean the
 * same thing in both, and pure so it can be tested without rendering anything.
 */
export interface EligibilityFilter {
  /** Lower bound on the election's required minimum age. */
  minAgeFrom?: number;
  /** Upper bound on the election's required minimum age. */
  minAgeTo?: number;
  /** ISO 3166-1 alpha-3. Matches elections that would ADMIT this nationality. */
  nationality?: string;
  /**
   * Which personhood levels to keep. Empty or absent means all of them.
   *
   * A list rather than a single value, and matched EXACTLY rather than "at
   * least", so the control answers the question the cards ask: each card shows
   * one level, and picking that level finds the cards showing it. An "at least
   * Orb" reading would make selecting Document return Orb elections too, which
   * is not what the badge in front of the reader says.
   */
  personhood?: PersonhoodLevel[];
}

export function isEligibilityFilterActive(filter: EligibilityFilter): boolean {
  return (
    filter.minAgeFrom !== undefined ||
    filter.minAgeTo !== undefined ||
    (filter.nationality !== undefined && filter.nationality !== '') ||
    (filter.personhood?.length ?? 0) > 0
  );
}

/**
 * An election with no age rule is treated as requiring 0, not as excluded.
 *
 * That is the honest reading: "open to everyone" satisfies "at least 18 allowed"
 * as much as an explicit 18 does, and a range starting at 0 finds it too.
 */
function requiredAge(policy: EligibilityPolicy | undefined): number {
  return policy?.minAge ?? 0;
}

/**
 * Whether an election would admit this nationality.
 *
 * Phrased as admission rather than as "declares this country", because that is
 * the question someone browsing is actually asking. An unrestricted election
 * admits everyone and therefore matches every nationality; a blocklist admits
 * anyone it does not name.
 */
function admitsNationality(policy: EligibilityPolicy | undefined, alpha3: string): boolean {
  const code = alpha3.toUpperCase();
  if (policy?.allowedCountries?.length && !policy.allowedCountries.includes(code)) return false;
  if (policy?.blockedCountries?.includes(code)) return false;
  return true;
}

export function matchesEligibilityFilter(
  policy: EligibilityPolicy | undefined,
  filter: EligibilityFilter,
): boolean {
  const age = requiredAge(policy);
  if (filter.minAgeFrom !== undefined && age < filter.minAgeFrom) return false;
  if (filter.minAgeTo !== undefined && age > filter.minAgeTo) return false;
  if (filter.nationality && !admitsNationality(policy, filter.nationality)) return false;
  if (filter.personhood?.length && !filter.personhood.includes(effectivePersonhood(policy))) {
    return false;
  }
  return true;
}
