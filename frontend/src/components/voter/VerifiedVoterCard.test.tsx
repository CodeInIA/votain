import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

/**
 * The number under "verified voter", which said nothing and did nothing.
 *
 * It was the World ID nullifier, truncated to twenty characters with no label
 * and nothing to press: enough to look like an identifier and not enough to be
 * one. A voter could neither tell what it was nor copy it, which is what they
 * would want it for.
 *
 * i18next is mocked globally to return the key, so the assertions read as keys.
 */

const NULLIFIER = '0x27ed8aeb03ae5aa444d1b7f7c34e9b2e6a1f0c5d9e8b7a6c5d4e3f2a1b0c9d8e';

const readOnDevice = vi.fn();
vi.mock('../../lib/deviceSeal', () => ({ readOnDevice: (name: string) => readOnDevice(name) }));

const { VerifiedVoterCard } = await import('./VerifiedVoterCard');

beforeEach(() => {
  readOnDevice.mockReset();
  readOnDevice.mockResolvedValue(NULLIFIER);
});

describe('the verified voter card', () => {
  it('says what the number is', async () => {
    render(<VerifiedVoterCard />);

    expect(await screen.findByText('profile.nullifier_hint')).toBeInTheDocument();
  });

  it('shows it short, and whole when asked', async () => {
    render(<VerifiedVoterCard />);

    const value = await screen.findByRole('button', { name: 'profile.nullifier_show' });
    // Sixty-six characters is three lines of monospace on a phone, so the card
    // opens with a stub and the whole thing is a press away.
    expect(value).toHaveAttribute('aria-expanded', 'false');
    expect(value.textContent).not.toBe(NULLIFIER);

    fireEvent.click(value);

    expect(value).toHaveAttribute('aria-expanded', 'true');
    expect(value.textContent).toBe(NULLIFIER);
  });

  it('copies the whole thing, never the stub', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<VerifiedVoterCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'common.copy' }));

    expect(writeText).toHaveBeenCalledWith(NULLIFIER);
  });

  it('shows nothing at all to somebody who has never verified', async () => {
    readOnDevice.mockResolvedValue(null);
    render(<VerifiedVoterCard />);

    await waitFor(() => expect(screen.getByText('nav.verified_voter')).toBeInTheDocument());
    expect(screen.queryByText('profile.nullifier_hint')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument();
  });
});
