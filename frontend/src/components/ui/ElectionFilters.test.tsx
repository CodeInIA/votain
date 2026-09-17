import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ElectionFilters } from './ElectionFilters';
import { EMPTY_FILTERS } from '../../lib/electionFilter';

/**
 * Which chips the participation band offers, which is a question about the
 * ROLE BEING WORN and not about the page.
 *
 * The rule: a chip that cannot be answered is not drawn. "Enrolled", "still to
 * vote" and "voted" are facts about a voter, so for an organizer they are false
 * everywhere and would empty a list while explaining nothing. Saving belongs to
 * both roles, because an organizer follows other people's elections like
 * everybody else.
 *
 * THE ROLE AND NOT THE SESSIONS, which is the dual session case: one person can
 * hold both at once, and the app dresses for the one they are wearing. Reading
 * the sessions here would hand an organizer the voter's chips because a voter
 * cookie happened to exist in the same browser.
 *
 * Worth a test rather than a read-through: this is the second time a control
 * has changed meaning with the session, the first being the candidate count
 * that vanished on signing in, which reached the user before it reached a test.
 */

const auth = { activeRole: 'public' as 'public' | 'voter' | 'organizer' };

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => auth,
}));

const setup = () =>
  render(
    <ElectionFilters
      value={EMPTY_FILTERS}
      onChange={() => {}}
      open
      onToggleOpen={() => {}}
      searchPlaceholder="search"
      groups={['status', 'participation']}
    />,
  );

beforeEach(() => {
  auth.activeRole = 'public';
});

describe('the participation band and who is reading it', () => {
  it('offers a voter everything about themselves', () => {
    auth.activeRole = 'voter';
    setup();

    expect(screen.getByText('saved.filter')).toBeInTheDocument();
    expect(screen.getByText('phase.enrolled')).toBeInTheDocument();
    expect(screen.getByText('discover.pending_vote_only')).toBeInTheDocument();
    expect(screen.getByText('phase.voted')).toBeInTheDocument();
  });

  it('offers an organizer only what an organizer has', () => {
    // They follow other people's elections, but they do not enrol or vote as
    // themselves, so the other three chips would match nothing at all.
    auth.activeRole = 'organizer';
    setup();

    expect(screen.getByText('saved.filter')).toBeInTheDocument();
    expect(screen.queryByText('phase.enrolled')).not.toBeInTheDocument();
    expect(screen.queryByText('discover.pending_vote_only')).not.toBeInTheDocument();
  });

  it('gives an organizer wearing the hat the same band, whatever else they hold', () => {
    // Both sessions live, acting as organizer. The voter cookie in the same
    // browser is not an answer to "have I enrolled": the person reading is
    // wearing the other hat, and the rest of the app already treats them that
    // way, down to where their own elections link.
    auth.activeRole = 'organizer';
    setup();

    expect(screen.getByText('saved.filter')).toBeInTheDocument();
    expect(screen.queryByText('phase.voted')).not.toBeInTheDocument();
  });

  it('draws no band at all for a visitor with no session', () => {
    setup();

    expect(screen.queryByText('discover.group_participation')).not.toBeInTheDocument();
    expect(screen.queryByText('saved.filter')).not.toBeInTheDocument();
    // The election's own state is still there, since it needs nobody signed in.
    expect(screen.getByText('discover.group_status')).toBeInTheDocument();
  });
});
