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
  key: "announced" | "enrolling" | "pending_vote" | "active" | "results";
  /** i18n key for the step's name. */
  labelKey: string;
  start: Date;
  /** Null for a step with no scheduled end. See `openEnded`. */
  end: Date | null;
  /**
   * No end because it has not finished, as opposed to no end because it is a
   * moment.
   *
   * The two both carry `end: null` and read completely differently. Counting
   * runs from the close of voting until the organizer publishes, which is
   * "from this date onwards". An election coming into existence is an
   * instant, and "from 16/9 19:43 onwards" is not what happened.
   */
  openEnded: boolean;
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
  /**
   * The moment this step's own clock is running towards, on the ONE step that
   * has one, and null on every other.
   *
   * Which step that is depends on whether the election has started. A running
   * step counts towards its own end. An election that has not opened yet has
   * no running step at all, and its clock belongs to the FIRST step, counting
   * towards the moment it begins: the countdown vanished entirely on an
   * upcoming election, which is the phase where "how long until this starts"
   * is the only question anyone has.
   */
  countdownTo: Date | null;
  /** Whether `countdownTo` is this step's start. "Starts in", not "ends in". */
  countdownIsStart: boolean;
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
  announced: 0,
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
  e: Pick<
    Election,
    "phase" | "createdAt" | "enrollStart" | "enrollEnd" | "voteStart" | "voteEnd"
  >,
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

  // The fields the loop below derives are left off here: what the schedule IS,
  // and where the election has got to in it, are two different questions.
  type Window = Pick<TimelineStep, "key" | "labelKey" | "start" | "end" | "openEnded">;
  const steps: Window[] = [];

  /**
   * DEPLOYED AND WAITING: the stretch between the election existing and
   * enrolment opening.
   *
   * ALWAYS THE FIRST STEP, whenever the chain recorded a creation date. It
   * was conditional at first, which left the creation date homeless on the
   * elections that lacked the step and forced a second line under the
   * schedule to carry it. One list that always has the same shape is worth
   * more than that: the schedule now accounts for every moment of an
   * election's life, from existing to published, and nothing else has to.
   *
   * TWO SHAPES, because of one case that cannot happen through the product.
   * The wizard bounds `enrollStart` to the chain's clock, so an election
   * created in Votain always exists before its enrolment opens and this is a
   * window. The factory itself imposes no such rule, and the seed calls it
   * directly with backdated windows to produce demo elections already in
   * flight; there `createdAt` falls after `enrollStart` and there is no
   * window to draw, so the step becomes the instant of creation instead of a
   * range that would run backwards.
   *
   * Absent only when the chain never recorded a creation date, which is an
   * election deployed before the immutable existed. There is nothing to show
   * and nothing to guess from.
   */
  if (e.createdAt) {
    const openedLater = e.enrollStart.getTime() > e.createdAt.getTime();
    steps.push({
      key: "announced",
      labelKey: openedLater ? "timeline.announced" : "timeline.created",
      start: e.createdAt,
      end: openedLater ? e.enrollStart : null,
      openEnded: false,
    });
  }

  steps.push({
    key: "enrolling",
    labelKey: "timeline.enrollment",
    start: e.enrollStart,
    end: e.enrollEnd,
    openEnded: false,
  });
  if (e.voteStart.getTime() > e.enrollEnd.getTime()) {
    steps.push({
      key: "pending_vote",
      labelKey: "timeline.gap",
      start: e.enrollEnd,
      end: e.voteStart,
      openEnded: false,
    });
  }
  steps.push(
    { key: "active", labelKey: "timeline.voting", start: e.voteStart, end: e.voteEnd, openEnded: false },
    // The one genuinely open-ended step: counting runs until it is published.
    { key: "results", labelKey: "timeline.results", start: e.voteEnd, end: null, openEnded: true },
  );

  /**
   * Whether the clock hangs on the enrolment step's START rather than on the
   * end of whatever is running.
   *
   * A running step counts down to its own end, which is the ordinary case.
   * The exception is an election that has not opened yet: what its reader
   * wants is "enrolment opens in", so the clock goes on the enrolment step
   * even though the announced step above it is the current one. Those are the
   * same instant, and only one of them can be labelled in a way that answers
   * the question.
   *
   * Decided before the map, because which step gets it is a fact about the
   * whole list and not about any step in it.
   */
  const clockOnEnrolStart = !abandoned && rank === PHASE_RANK.upcoming;

  return steps.map(step => {
    if (abandoned) {
      return {
        ...step,
        status: "abandoned" as const,
        endedEarly: false,
        countdownTo: null,
        countdownIsStart: false,
      };
    }

    const stepRank = STEP_RANK[step.key];
    const status: TimelineStatus =
      rank > stepRank ? "done"
      : rank < stepRank ? "upcoming"
      // The last step is `current` while the count runs and `done` once the
      // result is out, which is the one place the rank cannot tell them apart.
      : step.key === "results" && e.phase === "closed" ? "done"
      : "current";

    const countsToStart = clockOnEnrolStart && step.key === "enrolling";
    return {
      ...step,
      status,
      endedEarly:
        status === "done" && step.end !== null && step.end.getTime() - now > EARLY_MARGIN_MS,
      // Two clocks, never one more. The announced step is the current one on
      // an upcoming election and its end is the same instant as enrolment's
      // start, so without `!clockOnEnrolStart` both would draw a countdown to
      // the same moment, one labelled "ends in" and one "starts in".
      //
      // The results step is `current` with no end, and rightly has no clock:
      // counting runs until the organizer publishes, which is not a deadline.
      countdownTo: countsToStart
        ? step.start
        : status === "current" && !clockOnEnrolStart
          ? step.end
          : null,
      countdownIsStart: countsToStart,
    };
  });
}
