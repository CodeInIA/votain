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

/**
 * How long before the close of voting an election counts as urgent.
 *
 * `Countdown` turns red at the same figure, and it is the same fact, so the two
 * are not allowed to disagree about when it starts being true.
 */
export const ENDS_SOON_MS = 3_600_000;

/**
 * How near its next deadline an election is for someone BROWSING.
 *
 * A day, where `ENDS_SOON_MS` is an hour, because the two answer different
 * questions. That one is a personal deadline turning red on an election the
 * voter already joined, and an hour is when a warning stops being useful and
 * starts being a fire alarm. This one is "what is worth my attention today",
 * asked by someone looking through a list, and an hour would hide almost
 * everything they could still act on.
 */
export const CLOSING_SOON_MS = 86_400_000;

/**
 * Whether this election's NEXT deadline is near, whatever that deadline is.
 *
 * Through `nextBoundary`, so an enrolling election is measured against the
 * close of enrolment and an active one against the close of voting. For someone
 * deciding where to spend the next hour, "the chance to join ends tonight" and
 * "the chance to vote ends tonight" are the same news.
 *
 * Says nothing about the reader, unlike `endsSoon`: an election closing soon is
 * closing soon for everybody.
 */
export function closingSoon(
  election: Parameters<typeof nextBoundary>[0],
  now: number = Date.now(),
): boolean {
  const boundary = nextBoundary(election);
  if (!boundary) return false;
  const left = boundary.deadline.getTime() - now;
  return left > 0 && left < CLOSING_SOON_MS;
}

/**
 * A ballot the voter can still cast and is about to lose the chance to.
 *
 * All three conditions matter. Voting has to be open, because there is nothing
 * to hurry towards otherwise; the voter has to be in, because an election they
 * cannot enter is not their deadline; and they must not have voted already,
 * since a cast ballot makes the clock somebody else's problem.
 */
export function endsSoon(
  election: Pick<Election, "phase" | "voteEnd" | "isEnrolled" | "hasVoted">,
  now: number = Date.now(),
): boolean {
  return (
    election.phase === "active" &&
    election.isEnrolled === true &&
    !election.hasVoted &&
    election.voteEnd.getTime() - now < ENDS_SOON_MS
  );
}

/* ────────────────────────────────────────────────────────────────────────
   The schedule the organizer set, as a sequence rather than one deadline.
   ──────────────────────────────────────────────────────────────────────── */

/** Where a step stands. `abandoned` is only reachable by cancelling or voiding. */
export type TimelineStatus = "done" | "current" | "upcoming" | "abandoned";

export interface TimelineStep {
  /** Stable across renders and used as the React key. */
  key: "enrolling" | "pending_vote" | "active" | "results";
  /** i18n key for the step's name. */
  labelKey: string;
  start: Date;
  /** The results step runs until the organizer publishes, so it has no end. */
  end: Date | null;
  status: TimelineStatus;
  /**
   * The step finished well before the date beside it.
   *
   * Only possible on an election whose dates the organizer can move, and worth
   * saying out loud: without it the step reads "closed" next to a date still in
   * the future, which looks like a bug rather than like the organizer using the
   * power the card says they kept.
   *
   * "Well before" and not "before", by `EARLY_MARGIN_MS`. The claim is made by
   * comparing a chain date against a clock, and a clock that is a minute out
   * would make it about every election on the platform. See the `now` argument.
   */
  endedEarly: boolean;
}

/**
 * How far along the phase itself says the election is.
 *
 * Driven by the PHASE and not by the clock, which is the whole difficulty. An
 * organizer who closed enrolment early leaves the election in `pending_vote`
 * while `enrollEnd` is still in the future, and a timeline that compared dates
 * against `now` would draw enrolment as still open on an election that has
 * stopped accepting anyone.
 *
 * `tallying` and `closed` share a rank because they are the same step seen
 * before and after publication, which the step's own status then separates.
 */
const PHASE_RANK: Record<ElectionPhase, number> = {
  upcoming: 0,
  enrolling: 1,
  pending_vote: 2,
  active: 3,
  tallying: 4,
  closed: 4,
  // Off the sequence entirely: see `phaseTimeline`.
  voided: -1,
  cancelled: -1,
  // Not phases an election is ever in. `ElectionPhase` doubles as the badge
  // vocabulary, and these two describe the READER's standing: "you are in" and
  // "you have voted". They are ranked as the election phase each one implies,
  // so a caller that passes one gets a sensible timeline rather than a crash.
  enrolled: 1,
  voted: 3,
};

/**
 * How much of a window has to be left over before it counts as cut short.
 *
 * The same five minutes `CLOCK_GAP_MS` uses, and for the same reason: seconds
 * of disagreement between two clocks are a fact about block production, not
 * about the organizer.
 */
const EARLY_MARGIN_MS = 5 * 60 * 1000;

const STEP_RANK: Record<TimelineStep["key"], number> = {
  enrolling: 1,
  pending_vote: 2,
  active: 3,
  results: 4,
};

/**
 * The election's whole schedule, one step per window the organizer defined.
 *
 * WHY IT EXISTS. Every screen showed a single countdown to the next boundary,
 * which answers "how long until the thing that is about to happen" and nothing
 * else. It cannot say what comes after, so a voter arriving during enrolment
 * had no way to see when they would be asked to vote without opening the
 * election and reading four dates out of a list, and could not tell at a glance
 * whether there was a gap between the two windows at all.
 *
 * THE GAP IS DROPPED WHEN THERE IS NONE. Most elections open voting the moment
 * enrolment closes, and a zero-length step drawn between them would be a
 * phase the election never passes through.
 *
 * A CANCELLED OR VOIDED ELECTION ABANDONS EVERY STEP, including ones whose
 * dates have passed. The chain records that it ended, not WHEN the organizer
 * ended it, so saying "enrolment completed" about an election called off
 * halfway through enrolment would be a guess presented as a fact. Marking the
 * schedule as not followed is the one thing that is certainly true.
 */
export function phaseTimeline(
  e: Pick<Election, "phase" | "enrollStart" | "enrollEnd" | "voteStart" | "voteEnd">,
  /**
   * Preferably `block.timestamp`, not the browser's clock.
   *
   * It is only read to decide `endedEarly`, and that decision compares a date
   * the CHAIN set against whatever clock it is handed. On a local node seeded
   * with `evm_increaseTime` the two sit days apart, so the browser's clock
   * concludes that every window on the chain was cut short. `useChainNow` is
   * the answer; the default is a fallback for callers with no chain to ask.
   */
  now: number = Date.now(),
): TimelineStep[] {
  const abandoned = e.phase === "cancelled" || e.phase === "voided";
  const rank = PHASE_RANK[e.phase];

  const steps: Omit<TimelineStep, "status" | "endedEarly">[] = [
    { key: "enrolling", labelKey: "timeline.enrollment", start: e.enrollStart, end: e.enrollEnd },
  ];
  if (e.voteStart.getTime() > e.enrollEnd.getTime()) {
    steps.push({ key: "pending_vote", labelKey: "timeline.gap", start: e.enrollEnd, end: e.voteStart });
  }
  steps.push(
    { key: "active", labelKey: "timeline.voting", start: e.voteStart, end: e.voteEnd },
    { key: "results", labelKey: "timeline.results", start: e.voteEnd, end: null },
  );

  return steps.map(step => {
    if (abandoned) return { ...step, status: "abandoned" as const, endedEarly: false };

    const stepRank = STEP_RANK[step.key];
    const status: TimelineStatus =
      rank > stepRank ? "done"
      : rank < stepRank ? "upcoming"
      // The last step is `current` while the count runs and `done` once the
      // result is out, which is the one place the rank cannot tell them apart.
      : step.key === "results" && e.phase === "closed" ? "done"
      : "current";

    return {
      ...step,
      status,
      endedEarly:
        status === "done" && step.end !== null && step.end.getTime() - now > EARLY_MARGIN_MS,
    };
  });
}
