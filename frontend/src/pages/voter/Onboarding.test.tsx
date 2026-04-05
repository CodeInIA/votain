import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Onboarding from './Onboarding';

// Mock useNavigate to intercept route changes
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('Voter Onboarding Flow', () => {
  const setup = () => {
    mockNavigate.mockClear();
    return render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>
    );
  };

  it('renders the initial step correctly', () => {
    setup();

    // Check main title of the first step
    expect(screen.getByText('onboarding.what_title')).toBeInTheDocument();
    expect(screen.getByText('onboarding.what_desc')).toBeInTheDocument();

    // The "Next" button should be available
    expect(screen.getByRole('button', { name: 'onboarding.btn_next' })).toBeInTheDocument();

    // The back button should navigate to landing on the first step
    const backBtn = screen.getByRole('button', { name: 'Go back' });
    expect(backBtn).toBeInTheDocument();

    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('navigates forward and backward through the steps', async () => {
    setup();

    // Next button
    const nextBtn = screen.getByRole('button', { name: 'onboarding.btn_next' });

    // Step 1 -> Step 2
    fireEvent.click(nextBtn);
    expect(await screen.findByText('onboarding.privacy_title')).toBeInTheDocument();

    // Step 2 -> Step 3
    fireEvent.click(nextBtn);
    expect(await screen.findByText('onboarding.coercion_title')).toBeInTheDocument();

    // Test Go back (from step 3 to step 2)
    const backBtn = screen.getByRole('button', { name: 'Go back' });
    fireEvent.click(backBtn);
    expect(await screen.findByText('onboarding.privacy_title')).toBeInTheDocument();
  });

  it('allows navigation via step indicators', async () => {
    setup();

    // Check for the 5 indicator buttons mapping to the steps
    const indicators = screen.getAllByRole('button', { name: /Go to step/i });
    expect(indicators).toHaveLength(5);

    // Click the 4th step indicator directly
    fireEvent.click(indicators[3]);

    // Should display the 4th step content directly
    expect(await screen.findByText('onboarding.free_title')).toBeInTheDocument();
  });

  it('displays the Verification step as the final step', async () => {
    setup();

    // Click to the last step (5th step) using indicators
    const indicators = screen.getAllByRole('button', { name: /Go to step/i });
    fireEvent.click(indicators[4]);

    // Should display verify content
    expect(await screen.findByText('verify.title')).toBeInTheDocument();
    expect(await screen.findByText('verify.description')).toBeInTheDocument();

    // The button should now be "verify.btn_verify" instead of "Next"
    const verifyBtn = await screen.findByRole('button', { name: /verify\.btn_verify/i });
    expect(verifyBtn).toBeInTheDocument();
  });
});
