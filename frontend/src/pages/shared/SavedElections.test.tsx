/**
 * What the saved list shows while it has nothing to show.
 *
 * Reported from the running app: opening it with nothing saved flashed a
 * spinner exactly where the bookmark was about to be. Measured, it was three
 * flashes of about ten milliseconds, because `useElectionPages` derives
 * `loading` from "no elections yet and not finished", and the saved scope
 * reaches "known" one effect before it reaches "finished".
 *
 * The distinction these pin is between an empty answer and an unknown one.
 * `savedElectionIds` reads this device's own storage synchronously, so no
 * addresses means nothing is in flight and there is nothing to wait for.
 *
 * The layout and the list furniture are stubbed: what is under test is one
 * branch, and mounting a nav bar to reach it would only give the test more
 * ways to fail for reasons that are not this.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const paginas = vi.fn();
const guardadas = vi.fn();

vi.mock('../../components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../components/ui/ElectionCard', () => ({
  ElectionCard: ({ election }: { election: { id: string } }) => <div>{election.id}</div>,
}));
vi.mock('../../components/ui/ElectionFilters', () => ({ ElectionFilters: () => null }));
vi.mock('../../components/ui/LoadMore', () => ({ LoadMore: () => null }));
vi.mock('../../components/ui/ListError', () => ({ ListError: () => <div>list-error</div> }));
vi.mock('../../components/ui/Spinner', () => ({
  Spinner: () => <div data-testid="spinner">spinner</div>,
}));
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('../../hooks/useElectionPages', () => ({ useElectionPages: () => paginas() }));
vi.mock('../../hooks/useSavedElections', () => ({ useSavedElections: () => guardadas() }));
vi.mock('../../hooks/useElectionFilterParams', () => ({
  useElectionFilterParams: () => [{ phase: undefined, query: '', sort: 'newest' }, vi.fn()],
}));
vi.mock('../../lib/savedElections', () => ({ syncSavedElections: () => Promise.resolve() }));

const SavedElections = (await import('./SavedElections')).default;

/** The hook's answer while it is still resolving a scope. */
const cargando = { all: [], loading: true, error: null, refresh: vi.fn() };

beforeEach(() => {
  paginas.mockReset();
  guardadas.mockReset();
  guardadas.mockReturnValue({ ids: [], isSaved: () => false });
});

describe('the saved list', () => {
  it('says it is empty instead of spinning when nothing was ever saved', () => {
    paginas.mockReturnValue(cargando);

    render(<SavedElections role="voter" />);

    // The hook still reports loading; the screen knows better, because the
    // addresses it would be loading do not exist.
    expect(screen.queryByTestId('spinner')).toBeNull();
    expect(screen.getByText('saved.empty')).toBeInTheDocument();
  });

  it('still spins while the elections it does have are being read', () => {
    guardadas.mockReturnValue({ ids: ['0xabc'], isSaved: () => true });
    paginas.mockReturnValue(cargando);

    render(<SavedElections role="voter" />);

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('shows what it read, once it has read it', () => {
    guardadas.mockReturnValue({ ids: ['0xabc'], isSaved: () => true });
    paginas.mockReturnValue({
      all: [{ id: '0xabc', phase: 'ACTIVE', title: 'x', createdAt: 1 }],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<SavedElections role="voter" />);

    expect(screen.queryByTestId('spinner')).toBeNull();
    expect(screen.getByText('0xabc')).toBeInTheDocument();
  });

  it('reports a failure rather than an empty list', () => {
    guardadas.mockReturnValue({ ids: ['0xabc'], isSaved: () => true });
    paginas.mockReturnValue({ all: [], loading: false, error: new Error('no'), refresh: vi.fn() });

    render(<SavedElections role="voter" />);

    expect(screen.getByText('list-error')).toBeInTheDocument();
  });
});
