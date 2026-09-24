import type { Election } from '../data/seed';

/**
 * How many PEOPLE voted, and what share of the roll that is.
 *
 * WHY THIS IS A FILE. `castVotes` counts ballots and `distinctVoters` counts
 * people, and they differ exactly when the feature this system is proudest of
 * is used: a coerced voter can vote again, the later ballot replaces the
 * earlier one, and the chain keeps both. Dividing ballots by the roll gives
 * turnouts above 100%, which is why the screen that did it capped the result
 * at 100 and hid the mistake instead of fixing it.
 *
 * The cards were corrected; the election page was not, so the same election
 * read one turnout on a card and another on the page it opened. Two copies of
 * a rule drift, so there is one copy now and both call it.
 */

type Counted = Pick<Election, 'distinctVoters' | 'castVotes' | 'totalEnrolled'>;

/**
 * People who have voted at least once.
 *
 * `distinctVoters` is the tally's own count, known once a result is published.
 * Before that nobody can know it, by design: re-votes are indistinguishable
 * from first votes. Ballots are then all there is, an UPPER bound on voters,
 * capped at the roll so the number stays sayable.
 */
export function votersOf(election: Counted): number {
  return election.distinctVoters ?? Math.min(election.castVotes, election.totalEnrolled);
}

/** Ballots beyond the first one per voter, which is what a re-vote leaves. */
export function replacedBallots(election: Counted): number {
  return Math.max(0, election.castVotes - votersOf(election));
}

/**
 * Turnout as a percentage of the roll.
 *
 * Still capped, but only for the fallback above: an exact `distinctVoters`
 * can never exceed `totalEnrolled`, since nobody votes without enrolling.
 * Before the tally it is the upper bound `votersOf` gives, and says so no more
 * precisely than that.
 */
export function turnoutPct(election: Counted): number {
  if (election.totalEnrolled <= 0) return 0;
  return Math.min(100, Math.round((votersOf(election) / election.totalEnrolled) * 100));
}
