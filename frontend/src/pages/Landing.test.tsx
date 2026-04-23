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
    const logos = screen.getAllByAltText('Votain Logo');
    expect(logos.length).toBeGreaterThan(0);
    expect(logos[0].getAttribute('src')).toBe('/votain-logo.webp');

    const wordmark = screen.getByAltText('Votain Wordmark');
    expect(wordmark).toBeInTheDocument();
    expect(wordmark.getAttribute('src')).toBe('/votain-wordmark.svg');

    // Since i18next is mapped to return the raw keys, we can safely test if the component asks for the right text
    expect(screen.getByText(/landing\.subtitle_1/i)).toBeInTheDocument();
    expect(screen.getByText(/landing\.subtitle_2/i)).toBeInTheDocument();
    expect(screen.getByText(/landing\.hero_desc/)).toBeInTheDocument();
  });

  it('renders both main paths (Voter & Organizer)', () => {
    setup();
    // Voter Path (Web3 Auth - World ID CTA)
    const voterButton = screen.getByRole('button', { name: /landing.voter_cta/i });
    expect(voterButton).toBeInTheDocument();

    // Organizer Path (Web3 Auth - Passkeys link)
    expect(screen.getByText('landing.are_you_organizer')).toBeInTheDocument();
    expect(screen.getByText('landing.create_election_link')).toBeInTheDocument();
    
    const orgLink = screen.getByRole('link', { name: /landing.are_you_organizer/i });
    expect(orgLink).toBeInTheDocument();
    expect(orgLink.getAttribute('href')).toBe('/organizer/auth');
  });

  it('renders secondary actions with correct routing logic', () => {
    setup();
    
    // Test the "Browse Elections" Button (now a button navigating to /discover)
    const discoverButton = screen.getByRole('button', { name: /landing.browse/i });
    expect(discoverButton).toBeInTheDocument();

    // Test the "How it works" Link
    const howItWorksLink = screen.getByRole('link', { name: /landing.how_it_works/i });
    expect(howItWorksLink).toBeInTheDocument();
    expect(howItWorksLink.getAttribute('href')).toBe('/how-it-works');

    // Test the Login Button in the Header
    const loginButton = screen.getByRole('button', { name: /landing.login/i });
    expect(loginButton).toBeInTheDocument();
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

