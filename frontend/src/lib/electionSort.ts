/**
 * The order a list of elections is shown in.
 *
 * Kept beside `electionFilter` and for the same reason: Discover and the
 * organizer dashboard show different elections through one control, so they
 * have to agree on what each ordering MEANS. What they cannot always agree on
 * is how exact the answer is, which is what `sortNeedsEverything` is about.
 */
import { nextBoundary } from './phase';
import type { Election } from '../data/seed';

export type ElectionSort = 'newest' | 'oldest' | 'closing' | 'enrolled';

/** In the order the control offers them, default first. */
export const SORT_OPTIONS: ElectionSort[] = ['newest', 'oldest', 'closing', 'enrolled'];

export const DEFAULT_SORT: ElectionSort = 'newest';

/**
 * Whether the ordering can be answered from the elections already read.
 *
 * THE DISTINCTION THAT MATTERS HERE. Creation order is carried by the list of
 * ADDRESSES, which is one cheap call for all of them, so `newest` and `oldest`
 * are exact before a single election has been hydrated: the pager simply walks
 * the addresses from the other end.
 *
 * The other two read values that only exist once an election is hydrated, and
 * Discover deliberately hydrates a page at a time. So "closing soonest" over a
 * partly read list puts the soonest of what happens to be loaded at the top,
 * and an election closing in an hour can sit unread below it. That is not a
 * reason to refuse the ordering, which is genuinely useful and exact on any
 * screen that reads everything. It is a reason to say so, which is what the
 * callers use this for.
 */
export function sortNeedsEverything(sort: ElectionSort): boolean {
  return sort === 'closing' || sort === 'enrolled';
}

/** Milliseconds to the next scheduled boundary, or Infinity when there is none. */
function untilNextBoundary(election: Election): number {
  const boundary = nextBoundary(election);
  return boundary ? boundary.deadline.getTime() : Number.POSITIVE_INFINITY;
}

/**
 * Orders a list without mutating it.
 *
 * `newest` and `oldest` are deliberately NOT handled here. The list arrives in
 * creation order already, from the address list the pager walked, and
 * re-deriving it from the elections themselves would need a creation date that
 * nothing on the object carries. Sorting by a date it does have, such as the
 * enrolment start, would be a different question wearing the same label: an
 * election created today and announced for next year is the newest one and the
 * last to open.
 */
export function sortElections(elections: Election[], sort: ElectionSort): Election[] {
  switch (sort) {
    case 'closing':
      // Terminal elections have no next boundary and sort to the bottom, which
      // is where "what should I act on" wants them.
      return [...elections].sort((a, b) => untilNextBoundary(a) - untilNextBoundary(b));
    case 'enrolled':
      return [...elections].sort((a, b) => b.totalEnrolled - a.totalEnrolled);
    default:
      return elections;
  }
}
