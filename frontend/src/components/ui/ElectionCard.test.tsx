import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { ElectionCard } from './ElectionCard';
import type { Election, ElectionPhase } from '../../data/seed';

/**
 * What a voter can tell about their own standing from the card alone.
 *
 * The gap these cover: a card the voter had already enrolled in looked exactly
 * like one they had not, in every phase except `active` (where the vote button
 * gives it away) and after voting. The only way to find out was to open the
 * election.
 *
 * i18next is mocked globally to return the key, so the assertions read as keys.
 */

function makeElection(overrides: Partial<Election> = {}): Election {
  const now = Date.now();
  return {
    id: '0xabc',
    contractAddress: '0xabc',
    title: 'Neighbourhood Budget',
    description: 'Where the money goes.',
    phase: 'enrolling' as ElectionPhase,
    organizer: 'Asociacion Vecinal',
    organizerAddress: '0xorganizer',
    enrollStart: new Date(now - 1000),
    enrollEnd: new Date(now + 86_400_000),
    voteStart: new Date(now + 86_400_000),
    voteEnd: new Date(now + 172_800_000),
    candidates: [{ id: 'option-0', name: 'A' }, { id: 'option-1', name: 'B' }],
    eligibility: [],
    totalEnrolled: 3,
    castVotes: 0,
    votingType: 'simple_plurality',
    privacyQuorum: 1,
    ...overrides,
  } as Election;
}

const setup = (election: Election, voterView = true) =>
  render(
    <MemoryRouter>
      <ElectionCard election={election} voterView={voterView} />
    </MemoryRouter>,
  );

describe('ElectionCard, what it tells the voter about themselves', () => {
  it('says so while enrollment is open and there is nothing yet to do', () => {
    setup(makeElection({ isEnrolled: true }));
    expect(screen.getByText('election.already_enrolled')).toBeInTheDocument();
  });

  it('says so once enrollment has closed and voting has not opened', () => {
    setup(makeElection({ phase: 'pending_vote', isEnrolled: true }));
    expect(screen.getByText('election.already_enrolled')).toBeInTheDocument();
  });

  it('stays quiet for a voter who is not enrolled', () => {
    setup(makeElection({ isEnrolled: false }));
    expect(screen.queryByText('election.already_enrolled')).not.toBeInTheDocument();
  });

  it('stays quiet when nobody is signed in', () => {
    // `isEnrolled` is undefined with no stored commitment, and a card on the
    // public Discover page must not claim anything about a visitor.
    setup(makeElection({ isEnrolled: true }), false);
    expect(screen.queryByText('election.already_enrolled')).not.toBeInTheDocument();
  });

  it('lets the vote button speak for it while voting is open', () => {
    // Two things saying "you are in" is one too many, and the button is the one
    // that also says what to do about it.
    setup(makeElection({ phase: 'active', isEnrolled: true }));
    expect(screen.getByText('election.vote_now')).toBeInTheDocument();
    expect(screen.queryByText('election.already_enrolled')).not.toBeInTheDocument();
  });

  it('gives way to the voted badge, which is the stronger fact', () => {
    setup(makeElection({ phase: 'active', isEnrolled: true, hasVoted: true }));
    expect(screen.getByText('phase.voted')).toBeInTheDocument();
    expect(screen.queryByText('election.already_enrolled')).not.toBeInTheDocument();
  });

  it('drops it once the election is over, where enrollment changes nothing', () => {
    setup(makeElection({ phase: 'closed', isEnrolled: true }));
    expect(screen.queryByText('election.already_enrolled')).not.toBeInTheDocument();
  });
});

describe('the ends-soon warning', () => {
  /**
   * It used to be pinned over the card's top edge with `absolute -top-1.5`, in
   * the same corner and the same green as the phase pill directly below it, so
   * the two read as one control that had come apart. It is a normal child of
   * the badge column now, which is also why these can be written at all.
   */

  const urgent = (overrides = {}) =>
    makeElection({
      phase: 'active',
      isEnrolled: true,
      voteEnd: new Date(Date.now() + 10 * 60_000),
      ...overrides,
    });

  it('warns the voter whose ballot is about to become uncastable', () => {
    setup(urgent());
    expect(screen.getByText('voter_elections.ends_soon')).toBeInTheDocument();
  });

  it('says nothing on the public listing, where the clock belongs to someone else', () => {
    setup(urgent(), false);
    expect(screen.queryByText('voter_elections.ends_soon')).not.toBeInTheDocument();
  });

  it('says nothing to a voter who has already voted', () => {
    setup(urgent({ hasVoted: true }));
    expect(screen.queryByText('voter_elections.ends_soon')).not.toBeInTheDocument();
  });

  it('says nothing about an election the voter never joined', () => {
    setup(urgent({ isEnrolled: false }));
    expect(screen.queryByText('voter_elections.ends_soon')).not.toBeInTheDocument();
  });

  it('waits until the last hour', () => {
    setup(urgent({ voteEnd: new Date(Date.now() + 3 * 86_400_000) }));
    expect(screen.queryByText('voter_elections.ends_soon')).not.toBeInTheDocument();
  });
});

describe('the participation bar', () => {
  /** The filled part is the only element in the card carrying an inline width. */
  const bar = () => document.querySelector<HTMLElement>('div[style*="width"]');

  it('caps turnout instead of reporting more than everyone', () => {
    // One enrolled voter who changed their mind casts two ballots, and the chain
    // counts ballots, not voters. The card used to read "200% voted".
    setup(makeElection({ phase: 'active', totalEnrolled: 1, castVotes: 2 }));
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    expect(bar()?.style.width).toBe('100%');
  });

  it('draws nothing for an election nobody has joined', () => {
    // An empty grey track says nothing the "0% voted" line does not, and reads
    // as a component that failed to load rather than as a zero.
    setup(makeElection({ phase: 'active', totalEnrolled: 0, castVotes: 0 }));
    expect(bar()).toBeNull();
  });

  it('draws the real proportion when there is one', () => {
    setup(makeElection({ phase: 'active', totalEnrolled: 4, castVotes: 1 }));
    expect(bar()?.style.width).toBe('25%');
  });

  it('stays out of phases where voting is not happening', () => {
    setup(makeElection({ phase: 'enrolling', totalEnrolled: 4, castVotes: 0 }));
    expect(bar()).toBeNull();
  });

  it('announces itself, with the denominator the percentage hides', () => {
    // An unlabelled 1px bar says nothing to a screen reader and, to everyone
    // else, means whatever they infer from the number above it. And "100%" is a
    // very different fact at one enrolled voter than at two hundred.
    setup(makeElection({ phase: 'active', totalEnrolled: 20, castVotes: 12 }));
    const track = screen.getByRole('progressbar');
    expect(track).toHaveAttribute('aria-valuenow', '60');
    expect(track).toHaveAttribute('aria-label', 'election.turnout_detail');
    expect(track).toHaveAttribute('title', 'election.turnout_detail');
  });
});
