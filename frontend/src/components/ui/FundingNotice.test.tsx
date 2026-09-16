import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FundingNotice } from './FundingNotice';
import { VOTE_COST_FALLBACK } from '../../lib/gasNeeds';
import type { Election } from '../../data/seed';

// The sentences themselves are checked elsewhere (every locale has them); what
// matters here is WHICH one is shown, so the key is enough.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The cost is measured from the chain in the app, and stated here: what these
// tests are about is which sentence appears, not what a ballot costs today.
vi.mock('../../hooks/useVoteCost', () => ({
  useVoteCost: () => ({ matic: 0.03, measured: false, samples: 0 }),
}));

const election = (over: Partial<Election> = {}): Election =>
  ({
    id: '0xe1',
    contractAddress: '0xe1',
    title: 'An election',
    description: '',
    phase: 'enrolling',
    organizer: 'Someone',
    organizerAddress: '0xorg',
    enrollStart: new Date(),
    enrollEnd: new Date(),
    voteStart: new Date(),
    voteEnd: new Date(),
    candidates: [],
    eligibility: [],
    totalEnrolled: 10,
    castVotes: 0,
    votingType: 'simple_plurality',
    privacyQuorum: 0,
    ...over,
  }) as Election;

describe('FundingNotice', () => {
  it('says nothing when the ballots are comfortably covered', () => {
    // A line confirming that everything is fine, on every election, trains
    // people to stop reading the one that says it is not.
    const { container } = render(
      <FundingNotice election={election()} reserved={10} organizerFree={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('stops the voter when nothing can pay for a ballot', () => {
    render(<FundingNotice election={election()} reserved={0} organizerFree={0} />);
    expect(screen.getByText('funding.unfunded_title')).toBeInTheDocument();
    // And says whose problem it is, rather than leaving the voter to read it as
    // "you are not allowed to vote".
    expect(screen.getByText('funding.unfunded_body')).toBeInTheDocument();
  });

  it('warns, without stopping anyone, when there is enough for some but not all', () => {
    render(
      <FundingNotice
        election={election({ totalEnrolled: 100, distinctVoters: 0 })}
        reserved={VOTE_COST_FALLBACK * 3}
        organizerFree={0}
      />,
    );
    expect(screen.getByText('funding.short')).toBeInTheDocument();
    expect(screen.queryByText('funding.unfunded_title')).not.toBeInTheDocument();
  });

  it('counts the free balance as able to pay, but never as a promise', () => {
    // Nothing reserved, and the organizer could withdraw this at any moment, so
    // a ballot can be cast right now and the screen still does not call it
    // guaranteed. What it must not do is refuse a vote that would go through.
    render(<FundingNotice election={election()} reserved={0} organizerFree={10} />);
    expect(screen.queryByText('funding.unfunded_title')).not.toBeInTheDocument();
  });
});
