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

describe('the phases that describe the reader instead of the election', () => {
  it('treats them as the election phase each one implies', () => {
    // `enrolled` and `voted` are badge states for the voter's own standing, and
    // `ElectionPhase` doubles as that vocabulary. A caller passing one should
    // get a sensible timeline, not a crash.
    expect(statuses('enrolled').enrolling).toBe('current');
    expect(statuses('voted').active).toBe('current');
  });
});
