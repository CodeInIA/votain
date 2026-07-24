/**
 * Shared election-phase helpers, so every screen derives countdowns and status
 * dots the same way instead of re-implementing the phase→date/label mapping.
 */
import type { Election, ElectionPhase } from "../data/seed";

/** Phases that show an animated status dot (a waiting or live election). */
export const PULSE_PHASES: ReadonlySet<ElectionPhase> = new Set([
  "upcoming", "enrolling", "pending_vote", "active",
]);

export interface PhaseBoundary {
  /** i18n key for the countdown label. */
  labelKey: string;
  /** The moment this phase gives way to the next. */
  deadline: Date;
}

/**
 * The next scheduled boundary a countdown should tick down to, or null for
 * terminal/decided phases (tallying, closed, voided, cancelled) that have no
 * pending deadline.
 */
export function nextBoundary(
  e: Pick<Election, "phase" | "enrollStart" | "enrollEnd" | "voteStart" | "voteEnd">,
): PhaseBoundary | null {
  switch (e.phase) {
    case "upcoming":     return { labelKey: "election.enrollment_opens", deadline: e.enrollStart };
    case "enrolling":    return { labelKey: "election.enrollment_closes", deadline: e.enrollEnd };
    case "pending_vote": return { labelKey: "election.voting_opens", deadline: e.voteStart };
    case "active":       return { labelKey: "election.voting_closes", deadline: e.voteEnd };
    default:             return null;
  }
}
