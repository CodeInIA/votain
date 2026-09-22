/**
 * The election page, which had no test at all.
 *
 * That gap was not theoretical. A stray `)}` was left in this file, the whole
 * page failed to parse, and the suite reported 562 passing: nothing imported
 * it, so nothing noticed. The dev server refused to build and that is how it
 * was found, which is a slow and embarrassing way to learn.
 *
 * So the first thing here is the cheapest and the most valuable: the module
 * loads and renders. A syntax error, a bad import or a hook called outside a
 * component all fail at that line.
 *
 * The rest pin the two things this page says to a VOTER that were wrong. It
 * told them a transaction had been confirmed, when what they had done was join
 * an election. And it carried a banner announcing their gas balance was low,
 * on a page where their votes are paid for by somebody else.
 *
 * Everything below the page is stubbed. What is under test is this file, and
 * mounting a chain client, a nav bar and a bar chart to reach it would only
 * add ways to fail for reasons that are not this one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const election = vi.fn();
const auth = vi.fn();
const modalProps = vi.fn();

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: '0xabc' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

// Recorded rather than rendered: what matters is the `kind` it is handed,
// because that is what decides whether a voter reads "Enrolment confirmed" or
// "Transaction confirmed".
vi.mock('../components/ui/TransactionPendingModal', () => ({
  TransactionPendingModal: (props: Record<string, unknown>) => {
    modalProps(props);
    return null;
  },
}));

vi.mock('../components/ui/ElectionSummary', () => ({
  ElectionHeader: ({ election: e }: { election: { title: string } }) => <h1>{e.title}</h1>,
  ElectionSchedule: () => <div>schedule</div>,
  ElectionAbout: () => <div>about</div>,
}));

vi.mock('../components/ui/Badge', () => ({ Badge: () => null }));
vi.mock('../components/ui/BackButton', () => ({ BackButton: () => null }));
vi.mock('../components/ui/Button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));
vi.mock('../components/ui/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/ui/Spinner', () => ({ Spinner: () => <div>spinner</div> }));
vi.mock('../components/ui/RadioCard', () => ({ RadioGroup: () => null }));
vi.mock('../components/ui/EligibilityRow', () => ({ EligibilityRow: () => null }));
vi.mock('../components/ui/StatusNotice', () => ({ StatusNotice: () => null }));
vi.mock('../components/ui/BarChart', () => ({ ResultBarChart: () => null }));
vi.mock('../components/ui/FundingNotice', () => ({ FundingNotice: () => null }));
vi.mock('../components/ui/ViewAsSwitch', () => ({ ViewAsSwitch: () => null }));
vi.mock('../components/voter/EligibilityCheck', () => ({ EligibilityCheck: () => null }));

vi.mock('../hooks/useElections', () => ({ useElection: () => election() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth() }));
vi.mock('../hooks/useSavedElections', () => ({
  useSavedElections: () => ({ isSaved: () => false, toggle: vi.fn() }),
}));
vi.mock('../hooks/useOrganizerWallet', () => ({ useOrganizerWallet: () => ({ address: null }) }));
vi.mock('../hooks/useElectionFunding', () => ({
  useElectionFunding: () => ({ reserved: 0, balance: 0, loading: false }),
}));
vi.mock('../hooks/useVoteCost', () => ({ useVoteCost: () => ({ matic: 0.0001, loading: false }) }));
vi.mock('../hooks/useVoterIdentity', () => ({
  useVoterIdentity: () => ({ ready: false, unlock: vi.fn(), unlocking: false }),
}));
vi.mock('../hooks/usePolicyRequirements', () => ({ usePolicyRequirements: () => [] }));
vi.mock('../hooks/useRefreshOnReturn', () => ({ useRefreshOnReturn: () => {} }));
vi.mock('../hooks/useScheduleWatch', () => ({ useScheduleWatch: () => {} }));
vi.mock('../seo/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('../lib/semaphore', () => ({ getStoredCommitment: () => null }));
vi.mock('../lib/voting', () => ({ enrollInElection: vi.fn(), votingIdentity: vi.fn() }));
vi.mock('../lib/returnTo', () => ({ rememberReturnTo: vi.fn() }));

// `export default`, not a named export: importing it as one made the page
// itself the invalid element, which is a confusing way for React to say it.
const { default: ElectionPage } = await import('./ElectionPage');

/** The least an election needs to reach the page's own body. */
function unaEleccion(overrides: Record<string, unknown> = {}) {
  return {
    id: '0xabc',
    contractAddress: '0xabc',
    title: 'School Board - Between Windows',
    description: 'A seeded election.',
    organizer: 'Ramon y Cajal School Board',
    organizerAddress: '0xorg',
    phase: 'enrolling',
    candidates: [{ id: '1', name: 'Yes' }, { id: '2', name: 'No' }],
    totalEnrolled: 3,
    privacyQuorum: 0,
    isEnrolled: false,
    hasVoted: false,
    eligibilityPolicy: null,
    // Required, not optional: the page maps over it unguarded, which is how
    // this fixture found out.
    eligibility: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockReturnValue({
    voterLoggedIn: true,
    organizerLoggedIn: false,
    activeRole: 'voter',
    sessionChecked: true,
  });
  election.mockReturnValue({
    election: unaEleccion(),
    loading: false,
    live: false,
    refresh: vi.fn(),
  });
});

describe('the election page', () => {
  it('renders an election', () => {
    render(<ElectionPage />);
    expect(screen.getByText('School Board - Between Windows')).toBeTruthy();
  });

  it('waits rather than claiming the election is missing', () => {
    election.mockReturnValue({ election: undefined, loading: true, live: true, refresh: vi.fn() });
    render(<ElectionPage />);
    expect(screen.getByText('spinner')).toBeTruthy();
    expect(screen.queryByText('errors.not_found')).toBeNull();
  });

  it('says so when there is no such election', () => {
    election.mockReturnValue({ election: undefined, loading: false, live: true, refresh: vi.fn() });
    render(<ElectionPage />);
    expect(screen.getByText('errors.not_found')).toBeTruthy();
  });

  /**
   * The voter is joining an election, not sending a transaction. Voting leaves
   * this page for `ZkProofGeneration`, so this modal is only ever the
   * enrolment and the `kind` is not conditional: if it ever reads `generic`
   * again, somebody who just enrolled is told a transaction was confirmed.
   */
  it('names the enrolment when it confirms one', () => {
    render(<ElectionPage />);
    expect(modalProps).toHaveBeenCalled();
    expect(modalProps.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'enrolment' });
  });

  /**
   * There used to be a banner here reading "your gas balance is low, top up to
   * vote". A voter holds no balance, because the organizer's reserve pays every
   * ballot through the relay, and the profile it offered to send them to has no
   * such action. It was unreachable as well, gated on a flag hard-wired to
   * false, so the untruth was never even seen.
   */
  it('never tells a voter about gas', () => {
    render(<ElectionPage />);
    const texto = document.body.textContent ?? '';
    expect(texto).not.toContain('gas_low_banner');
    expect(texto).not.toContain('election.top_up');
  });
});
