import { describe, it, expect } from 'vitest';

import { phaseTimeline } from './phase';
import type { Election, ElectionPhase } from '../data/seed';

/**
 * The schedule an election runs to, read as a sequence.
 *
 * What these are really about is the two ways of deciding where an election
 * has got to. Comparing the dates against the clock is the obvious one and it
 * is wrong: an organizer who closed enrolment early leaves the contract in
 * `pending_vote` with `enrollEnd` still in the future, and a timeline reading
 * the clock would draw enrolment as open on an election that has stopped
 * accepting anyone. The phase is the authority; the dates are only labels.
 */

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 16, 12, 0, 0);
const at = (days: number) => new Date(now + days * DAY);

const election = (
  phase: ElectionPhase,
  over: Partial<Election> = {},
): Parameters<typeof phaseTimeline>[0] =>
  ({
    phase,
    enrollStart: at(-4),
    enrollEnd: at(-2),
    voteStart: at(-1),
    voteEnd: at(3),
    ...over,
  }) as Election;

const keys = (phase: ElectionPhase, over?: Partial<Election>) =>
  phaseTimeline(election(phase, over), now).map(s => s.key);
const statuses = (phase: ElectionPhase, over?: Partial<Election>) =>
  Object.fromEntries(phaseTimeline(election(phase, over), now).map(s => [s.key, s.status]));

describe('which steps an election has at all', () => {
  it('drops the gap when voting opens the moment enrollment closes', () => {
    // The usual shape. A zero-length step between them would be a phase the
    // election never passes through.
    const sameInstant = { enrollEnd: at(-2), voteStart: at(-2) };
    expect(keys('active', sameInstant)).toEqual(['enrolling', 'active', 'results']);
  });

  it('keeps the gap when the organizer left one', () => {
    expect(keys('active')).toEqual(['enrolling', 'pending_vote', 'active', 'results']);
  });

  it('ends with a step that has no end date', () => {
    // Counting runs until the organizer publishes, which is not on a schedule.
    const last = phaseTimeline(election('tallying'), now).at(-1);
    expect(last?.key).toBe('results');
    expect(last?.end).toBeNull();
  });
});

describe('where the election has got to', () => {
  it('has nothing behind it before enrollment opens', () => {
    expect(statuses('upcoming')).toEqual({
      enrolling: 'upcoming', pending_vote: 'upcoming', active: 'upcoming', results: 'upcoming',
    });
  });

  it('marks the running window and nothing else', () => {
    expect(statuses('enrolling')).toEqual({
      enrolling: 'current', pending_vote: 'upcoming', active: 'upcoming', results: 'upcoming',
    });
    expect(statuses('active')).toEqual({
      enrolling: 'done', pending_vote: 'done', active: 'current', results: 'upcoming',
    });
  });

  it('separates counting from a published result', () => {
    // The one pair the sequence cannot tell apart on its own: both come after
    // voting, and only `closed` means there is something to read.
    expect(statuses('tallying').results).toBe('current');
    expect(statuses('closed').results).toBe('done');
  });

  it('abandons every step of a cancelled election, including the past ones', () => {
    // The chain records THAT it ended, never when. Calling enrollment
    // "completed" on an election called off halfway through it would be a
    // guess presented as a fact.
    expect(statuses('cancelled')).toEqual({
      enrolling: 'abandoned', pending_vote: 'abandoned', active: 'abandoned', results: 'abandoned',
    });
    expect(statuses('voided').enrolling).toBe('abandoned');
  });
});

describe('a window that closed before its date', () => {
  it('says so, rather than showing a finished step next to a future date', () => {
    // Enrollment was due to run another two days and the organizer cut it
    // short, so the contract is in `pending_vote` already.
    const early = phaseTimeline(election('pending_vote', { enrollEnd: at(2), voteStart: at(4) }), now);
    const enrolment = early.find(s => s.key === 'enrolling');
    expect(enrolment?.status).toBe('done');
    expect(enrolment?.endedEarly).toBe(true);
  });

  it('stays quiet when the window simply ran its course', () => {
    const onTime = phaseTimeline(election('active'), now);
    expect(onTime.find(s => s.key === 'enrolling')?.endedEarly).toBe(false);
  });

  it('never claims it of a step that has not finished', () => {
    const running = phaseTimeline(election('enrolling', { enrollEnd: at(2) }), now);
    expect(running.find(s => s.key === 'enrolling')?.endedEarly).toBe(false);
  });

  it('ignores a couple of minutes of disagreement between two clocks', () => {
    // The claim is made by comparing a date the CHAIN set against whatever
    // clock the caller hands over. Seconds of difference are a fact about
    // block production, and a window that closed one minute before its stated
    // end closed on time by any reading a person would give it.
    const drift = phaseTimeline(
      election('pending_vote', { enrollEnd: new Date(now + 60_000), voteStart: at(1) }),
      now,
    );
    expect(drift.find(s => s.key === 'enrolling')?.endedEarly).toBe(false);
  });
});

describe('which step carries the clock', () => {
  const clock = (phase: ElectionPhase, over?: Partial<Election>) =>
    phaseTimeline(election(phase, over), now).find(s => s.countdownTo !== null);

  it('hangs it on the running step, counting to the end of that step', () => {
    const step = clock('active');
    expect(step?.key).toBe('active');
    expect(step?.countdownIsStart).toBe(false);
    expect(step?.countdownTo?.getTime()).toBe(at(3).getTime());
  });

  it('hangs it on the first step of an election that has not opened', () => {
    // The gap this closes: `upcoming` has no running step, so nothing carried
    // a countdown and the clock vanished from the one phase where "how long
    // until this starts" is the only question anyone has.
    const step = clock('upcoming', { enrollStart: at(2), enrollEnd: at(5), voteStart: at(5), voteEnd: at(9) });
    expect(step?.key).toBe('enrolling');
    expect(step?.countdownIsStart).toBe(true);
    expect(step?.countdownTo?.getTime()).toBe(at(2).getTime());
  });

  it('puts it on exactly one step, never two', () => {
    for (const phase of ['upcoming', 'enrolling', 'pending_vote', 'active'] as ElectionPhase[]) {
      const withClock = phaseTimeline(election(phase), now).filter(s => s.countdownTo !== null);
      expect(withClock).toHaveLength(1);
    }
  });

  it('gives the count no clock, because publishing is not a deadline', () => {
    expect(clock('tallying')).toBeUndefined();
    expect(clock('closed')).toBeUndefined();
  });

  it('gives a stopped election no clock at all', () => {
    expect(clock('cancelled')).toBeUndefined();
    expect(clock('voided')).toBeUndefined();
  });
});

describe('the phases that describe the reader instead of the election', () => {
  it('treats them as the election phase each one implies', () => {
    // `enrolled` and `voted` are badge states for the voter's own standing, and
    // `ElectionPhase` doubles as that vocabulary. A caller passing one should
    // get a sensible timeline, not a crash.
    expect(statuses('enrolled').enrolling).toBe('current');
    expect(statuses('voted').active).toBe('current');
  });
});

describe('when the election came into existence', () => {
  // Deployed four days ago, enrolment opens in two.
  const announced = (over: Partial<Election> = {}) =>
    election('upcoming', {
      createdAt: at(-4),
      enrollStart: at(2),
      enrollEnd: at(5),
      voteStart: at(5),
      voteEnd: at(9),
      ...over,
    });

  it('opens the schedule with a moment that is already behind', () => {
    const steps = phaseTimeline(announced(), now);
    expect(steps.map(s => s.key)).toEqual(['created', 'enrolling', 'active', 'results']);
    expect(steps[0].start).toEqual(at(-4));
    // A moment, not a window: as a window it was the step an upcoming
    // election was IN, so that one election drew a live first row where
    // every other one drew a finished one.
    expect(steps[0].end).toBeNull();
    expect(steps[0].openEnded).toBe(false);
    expect(steps[0].status).toBe('done');
  });

  it('is done on every phase, so the list keeps one shape', () => {
    const todas: ElectionPhase[] =
      ['upcoming', 'enrolling', 'pending_vote', 'active', 'tallying', 'closed'];
    for (const phase of todas) {
      expect(phaseTimeline(announced({ phase }), now)[0].status).toBe('done');
    }
  });

  it('leaves the countdown on enrollment, which is what happens next', () => {
    const clock = phaseTimeline(announced(), now).filter(s => s.countdownTo !== null);
    expect(clock).toHaveLength(1);
    expect(clock[0].key).toBe('enrolling');
    expect(clock[0].countdownIsStart).toBe(true);
    expect(clock[0].countdownTo).toEqual(at(2));
  });

  it('draws the same shape when enrollment was already open at deployment', () => {
    // `createdAt` after `enrollStart`. The wizard cannot produce this, since
    // it bounds the enrolment start to the chain clock, but the factory takes
    // it and the seed backdates windows to stage elections already in flight.
    // A moment cannot run backwards, so there is nothing to special case.
    const late = phaseTimeline(election('enrolling', { createdAt: at(1), enrollStart: at(-4) }), now);
    expect(late[0].key).toBe('created');
    expect(late[0].end).toBeNull();
    expect(late[0].status).toBe('done');
  });

  it('separates a moment from a step that has simply not ended', () => {
    // Both carry no end and mean opposite things: counting runs from the
    // close of voting onwards, creation is an instant.
    const steps = phaseTimeline(announced(), now);
    expect(steps.find(s => s.key === 'created')?.openEnded).toBe(false);
    expect(steps.find(s => s.key === 'results')?.openEnded).toBe(true);
  });

  it('is left out only when the chain never recorded a creation date', () => {
    // Deployed before the immutable existed. The step would have no start,
    // and nothing else on the election can be turned into one.
    const steps = phaseTimeline(election('upcoming', { enrollStart: at(2) }), now);
    expect(steps.map(s => s.key)).not.toContain('created');
    // And the clock still finds enrollment, which is the fallback that
    // existed before this step did.
    const clock = steps.find(s => s.countdownTo !== null);
    expect(clock?.key).toBe('enrolling');
    expect(clock?.countdownIsStart).toBe(true);
  });

  it('survives the election being called off, unlike every other step', () => {
    // Cancelling does not un-create a thing. Striking this row through with
    // the rest would say a schedule was abandoned before it began.
    const steps = phaseTimeline(announced({ phase: 'cancelled' }), now);
    expect(steps.find(s => s.key === 'created')?.status).toBe('done');
    expect(steps.find(s => s.key === 'enrolling')?.status).toBe('abandoned');
  });
});
