/**
 * The hat following the page, and not fighting the header for it.
 *
 * `RoleFromRoute` exists so that opening `/voter/saved` from a bookmark while
 * the organizer hat is on redresses the chrome. It used to re-run whenever the
 * ROLE changed too, and that let it undo the very choice the header had just
 * made: switching to voter from `/organizer/election/:id` sets the role and
 * navigates in one tick, so the effect fired while React Router still reported
 * the page being left, found an organizer route under a voter hat, and put the
 * organizer hat back. The address bar moved and the switch did not.
 *
 * These pin both halves: that arriving somewhere still redresses the chrome,
 * and that a role changing by itself is a decision rather than an arrival.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.fn();
vi.mock('./contexts/AuthContext', () => ({ useAuth: () => auth() }));

const { RoleFromRoute } = await import('./App');

const setActiveRole = vi.fn();

/** Both sessions live, which is the only case with a choice to make. */
function sesionDoble(activeRole: 'voter' | 'organizer') {
  auth.mockReturnValue({
    voterLoggedIn: true,
    organizerLoggedIn: true,
    activeRole,
    setActiveRole,
  });
}

function pintar(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="*" element={<RoleFromRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.mockReset();
  setActiveRole.mockReset();
});

describe('the hat that follows the page', () => {
  it('redresses the chrome for a page belonging to the other role', () => {
    sesionDoble('organizer');
    pintar('/voter/saved');
    expect(setActiveRole).toHaveBeenCalledWith('voter');
  });

  it('leaves a page that belongs to nobody alone', () => {
    sesionDoble('organizer');
    pintar('/election/0xabc');
    expect(setActiveRole).not.toHaveBeenCalled();
  });

  it('says nothing when the page already matches the hat', () => {
    sesionDoble('voter');
    pintar('/voter/saved');
    expect(setActiveRole).not.toHaveBeenCalled();
  });

  it('never dresses anybody as a role they do not hold', () => {
    auth.mockReturnValue({
      voterLoggedIn: true,
      organizerLoggedIn: false,
      activeRole: 'voter',
      setActiveRole,
    });
    pintar('/organizer/gas');
    expect(setActiveRole).not.toHaveBeenCalled();
  });

  it('does not undo a switch made while standing on the page being left', () => {
    // The reported bug, as the render sequence that produced it: the role has
    // already changed to voter, and this pass still reports the organizer's
    // panel because the router has not caught up. Re-running for the ROLE is
    // what made it answer; it must not.
    sesionDoble('organizer');
    const { rerender } = pintar('/organizer/election/0xabc');
    expect(setActiveRole).not.toHaveBeenCalled();

    sesionDoble('voter');
    rerender(
      <MemoryRouter initialEntries={['/organizer/election/0xabc']}>
        <Routes>
          <Route path="*" element={<RoleFromRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(setActiveRole).not.toHaveBeenCalledWith('organizer');
  });
});
