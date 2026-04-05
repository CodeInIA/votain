import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from './Landing';

describe('Landing Page Structure & Navigation', () => {
  const setup = () => render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>
  );

  it('renders the main protocol branding and titles via i18n keys', () => {
    setup();
    const logo = screen.getByAltText('Votain Logo');
    expect(logo).toBeInTheDocument();
    expect(logo.getAttribute('src')).toBe('/votain-logo.png');

    // Since i18next is mapped to return the raw keys, we can safely test if the component asks for the right text
    expect(screen.getByText('landing.title')).toBeInTheDocument();
    expect(screen.getByText('landing.subtitle')).toBeInTheDocument();
  });

  it('renders both strictly defined user paths (Voter & Organizer)', () => {
    setup();
    // Voter Path (Web3 Auth - World ID)
    const voterButton = screen.getByRole('button', { name: /I want to vote/i });
    expect(voterButton).toBeInTheDocument();
    expect(screen.getByText('landing.voter_title')).toBeInTheDocument();
    expect(screen.getByText('landing.voter_desc')).toBeInTheDocument();

    // Organizer Path (Web3 Auth - Passkeys)
    const orgButton = screen.getByRole('button', { name: /I am an organizer/i });
    expect(orgButton).toBeInTheDocument();
    expect(screen.getByText('landing.org_title')).toBeInTheDocument();
    expect(screen.getByText('landing.org_desc')).toBeInTheDocument();
  });

  it('renders secondary ecosystem links with correct internal routing', () => {
    setup();
    
    // Test the "Browse Elections" Link
    const discoverLink = screen.getByRole('link', { name: 'landing.browse' });
    expect(discoverLink).toBeInTheDocument();
    expect(discoverLink.getAttribute('href')).toBe('/discover');

    // Test the "How it works" Link
    const howItWorksLink = screen.getByRole('link', { name: 'landing.how_it_works' });
    expect(howItWorksLink).toBeInTheDocument();
    expect(howItWorksLink.getAttribute('href')).toBe('/how-it-works');
  });

  it('renders the generic footer correctly containing protocol agreements', () => {
    setup();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toBeInTheDocument();
    
    // Check specific translation keys requested by the view
    expect(screen.getByText('landing.footer.protocol')).toBeInTheDocument();
    expect(screen.getByText('landing.footer.copyright')).toBeInTheDocument();
    
    // Checks that typical anchor links exist for agreements
    const terms = screen.getByRole('link', { name: 'landing.footer.terms' });
    const privacy = screen.getByRole('link', { name: 'landing.footer.privacy' });
    const language = screen.getByRole('link', { name: 'landing.footer.language' });
    
    expect(terms).toBeVisible();
    expect(privacy).toBeVisible();
    expect(language).toBeVisible();
  });
});

