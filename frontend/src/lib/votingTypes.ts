/**
 * The four ways an election can be decided, in one place.
 *
 * The order and the icons were duplicated the moment a second screen needed
 * them: the create wizard lists the types, the cards label them, the filter bar
 * offers them and the election views name them. A rule that appears on a card,
 * in a filter and on the election itself has to look the same in all three, or
 * the icon stops being a shorthand and becomes something else to learn.
 *
 * Icons carry meaning rather than decoration, which is why none of them repeat:
 * a trophy for the option that simply wins, a half-filled circle for the bar at
 * 50%, scales for the two-thirds supermajority, and a checked person for a count
 * of confirmations, which is the only rule about WHO confirms rather than about
 * proportions.
 */
import { CircleDashed, Scale, Trophy, UserCheck, type LucideIcon } from 'lucide-react';
import type { VotingType } from '../data/seed';

/** Wizard order, filter order, and the order any future list should use. */
export const VOTING_TYPES: readonly VotingType[] = [
  'simple_plurality',
  'absolute_majority',
  'two_thirds',
  'witness_threshold',
] as const;

export const VOTING_TYPE_ICONS: Record<VotingType, LucideIcon> = {
  simple_plurality: Trophy,
  absolute_majority: CircleDashed,
  two_thirds: Scale,
  witness_threshold: UserCheck,
};

/** The label key, kept here so no caller builds the string itself. */
export function votingTypeLabelKey(type: VotingType): string {
  return `voting_type.${type}`;
}

export function votingTypeDescriptionKey(type: VotingType): string {
  return `voting_type.${type}_desc`;
}
