import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { useVoterIdentity } from './useVoterIdentity';

/**
 * What happens when a voter has a session and this browser has no identity.
 *
 * The case: somebody who set up WITHOUT a passkey, so the twelve words on this
 * device were the only copy, and then lost this browser's storage. The World ID
 * session survives in a cookie, and nothing behind it does.
 *
 * It looked exactly like a locked device and behaved worse: `unlock` swallowed
 * every error alike, so pressing the one button on screen summoned nothing and
 * said nothing, on every page, for good.
 *
 * Signing them out is the wrong remedy and these tests do not ask for it. The
 * session proves the human, it is still true, and BOTH ways back need it: the
 * phrase has to register its restored commitment, and recovery rotates the
 * registry entry against a fresh World ID proof. What they need is the screen
 * that offers those two doors.
 */

const getOrCreateIdentity = vi.fn();

vi.mock('../lib/semaphore', async () => {
  const actual = await vi.importActual<typeof import('../lib/semaphore')>('../lib/semaphore');
  return {
    ...actual,
    isIdentityLoaded: () => false,
    getOrCreateIdentity: () => getOrCreateIdentity(),
  };
});

function Screen() {
  const { unlock, unlocking } = useVoterIdentity(true);
  return (
    <button type="button" onClick={() => void unlock()} disabled={unlocking}>
      unlock
    </button>
  );
}

const setup = () =>
  render(
    <MemoryRouter initialEntries={['/voter/elections']}>
      <Routes>
        <Route path="/voter/elections" element={<Screen />} />
        <Route path="/voter/identity" element={<p>identity step</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('unlocking an identity this browser does not have', () => {
  it('sends a session with nothing behind it to the screen that can fix it', async () => {
    const { IdentityNotSetUpError } = await import('../lib/semaphore');
    getOrCreateIdentity.mockRejectedValue(new IdentityNotSetUpError());

    setup();
    screen.getByRole('button').click();

    await waitFor(() => expect(screen.getByText('identity step')).toBeInTheDocument());
  });

  it('leaves a locked device where it is, with its offer still on screen', async () => {
    // A vault exists and no passkey here opened it: the prompt was dismissed,
    // or their authenticator is elsewhere. Nothing is broken and nothing is
    // lost, so nothing moves.
    const { IdentityLockedError } = await import('../lib/semaphore');
    getOrCreateIdentity.mockRejectedValue(new IdentityLockedError());

    setup();
    screen.getByRole('button').click();

    await waitFor(() => expect(getOrCreateIdentity).toHaveBeenCalled());
    expect(screen.queryByText('identity step')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
