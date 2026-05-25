import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Onboarding from './Onboarding';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

describe('Voter Onboarding Flow', () => {
  const setup = () => {
    mockNavigate.mockClear();
    return render(<MemoryRouter><Onboarding /></MemoryRouter>);
  };

  it('renders the first info step on initial load', () => {
    setup();
    expect(screen.getByText('onboarding.what_title')).toBeInTheDocument();
    expect(screen.getByText('onboarding.what_desc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'onboarding.btn_next' })).toBeInTheDocument();
    // Back on step 0 calls navigate(-1)
    const backBtn = screen.getByRole('button', { name: 'common.back' });
    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('navigates forward through info steps', async () => {
    setup();
    const nextBtn = screen.getByRole('button', { name: 'onboarding.btn_next' });

    // Step 0 (what) → step 1 (privacy)
    fireEvent.click(nextBtn);
    expect(await screen.findByText('onboarding.privacy_title')).toBeInTheDocument();

    // Step 1 → step 2 (coercion)
    fireEvent.click(nextBtn);
    expect(await screen.findByText('onboarding.coercion_title')).toBeInTheDocument();
  });

  it('navigates backward through info steps', async () => {
    setup();
    const nextBtn = screen.getByRole('button', { name: 'onboarding.btn_next' });
    fireEvent.click(nextBtn);
    expect(await screen.findByText('onboarding.privacy_title')).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: 'common.back' });
    fireEvent.click(backBtn);
    expect(await screen.findByText('onboarding.what_title')).toBeInTheDocument();
  });

  it('shows 5 step indicator dots and allows navigation via them', async () => {
    setup();
    // 5 dots: 4 info steps + 1 verify step
    const indicators = screen.getAllByRole('button', { name: /onboarding\.go_to_step/i });
    expect(indicators).toHaveLength(5);

    // Click dot index 2 (coercion step)
    fireEvent.click(indicators[2]);
    expect(await screen.findByText('onboarding.coercion_title')).toBeInTheDocument();
  });

  it('displays the World ID verification step as the last step', async () => {
    setup();
    const indicators = screen.getAllByRole('button', { name: /onboarding\.go_to_step/i });
    // Last dot (index 4) = verify step
    fireEvent.click(indicators[4]);
    expect(await screen.findByText('verify.title')).toBeInTheDocument();
    expect(await screen.findByText('verify.description')).toBeInTheDocument();
    const verifyBtn = await screen.findByRole('button', { name: /verify\.btn_verify/i });
    expect(verifyBtn).toBeInTheDocument();
  });
});
