import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ElectionFilters } from './ElectionFilters';
import { EMPTY_FILTERS } from '../../lib/electionFilter';

/**
 * Which controls the panel offers, which is a question about the ROLE BEING
 * WORN and not about the page.
 *
 * The rule: a control that cannot be answered is not drawn. "Enrolled", "still
 * to vote" and "voted" are facts about a voter, so for an organizer they are
 * false everywhere and would empty a list while explaining nothing.
 *
 * SAVED IS NOT HERE AT ALL any more, in the band or in the toolbar. A list the
 * reader made is not a way of narrowing the list they are looking at, it is a
 * different list, and it has a page of its own for each role.
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
  it('offers a voter everything about taking part', () => {
    auth.activeRole = 'voter';
    setup();

    expect(screen.getByText('phase.enrolled')).toBeInTheDocument();
    expect(screen.getByText('discover.pending_vote_only')).toBeInTheDocument();
    expect(screen.getByText('phase.voted')).toBeInTheDocument();
  });

  it('draws nothing about taking part for an organizer', () => {
    // Both sessions can be live at once, and this is the one wearing the
    // organizer's hat: they do not enrol or vote as themselves, so all three
    // would match nothing at all.
    auth.activeRole = 'organizer';
    setup();

    expect(screen.queryByText('discover.group_participation')).not.toBeInTheDocument();
    expect(screen.queryByText('phase.enrolled')).not.toBeInTheDocument();
    expect(screen.queryByText('discover.pending_vote_only')).not.toBeInTheDocument();
    expect(screen.queryByText('phase.voted')).not.toBeInTheDocument();
  });

  it('offers no saved control anywhere, in either role', () => {
    // It was a chip here and then a button in the toolbar. A list the reader
    // made is a place, and it has one: `/voter/saved`, `/organizer/saved`.
    for (const role of ['voter', 'organizer'] as const) {
      auth.activeRole = role;
      const { unmount } = setup();
      expect(screen.queryByText('saved.filter')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('draws nothing about the reader for a visitor with no session', () => {
    setup();

    expect(screen.queryByText('discover.group_participation')).not.toBeInTheDocument();
    expect(screen.queryByText('saved.filter')).not.toBeInTheDocument();
    // The election's own state is still there, since it needs nobody signed in.
    expect(screen.getByText('discover.group_status')).toBeInTheDocument();
  });
});
