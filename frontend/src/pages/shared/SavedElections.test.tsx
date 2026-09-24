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
import { render, screen, fireEvent } from '@testing-library/react';

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
vi.mock('../../hooks/useElectionPages', () => ({
  useElectionPages: (options: unknown) => paginas(options),
}));
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
  guardadas.mockReturnValue({ ids: [], isSaved: () => false, toggle: vi.fn() });
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


  /**
   * Unsaving from this list used to delete the row, so the one screen where the
   * mistake costs something was the one that hid the evidence.
   */
  describe('taking one off the list', () => {
    const UNA = { id: '0xabc', phase: 'ACTIVE', title: 'x', createdAt: 1 };

    it('keeps the row and offers the way back', () => {
      // Held from earlier in the visit, and no longer saved: the shape of a
      // bookmark that was just pressed.
      guardadas.mockReturnValue({ ids: [], isSaved: () => false, toggle: vi.fn() });
      paginas.mockReturnValue({ all: [UNA], loading: false, error: null, refresh: vi.fn() });

      render(<SavedElections role="voter" />);

      // The strip is unfolded and reachable; the card is the folded half.
      expect(screen.getByText('saved.undo').closest('[inert]')).toBeNull();
      expect(screen.getAllByText(UNA.title).length).toBeGreaterThan(0);
    });

    it('puts it back when the way back is pressed', () => {
      const toggle = vi.fn();
      guardadas.mockReturnValue({ ids: [], isSaved: () => false, toggle });
      paginas.mockReturnValue({ all: [UNA], loading: false, error: null, refresh: vi.fn() });

      render(<SavedElections role="voter" />);
      fireEvent.click(screen.getByText('saved.undo'));

      expect(toggle).toHaveBeenCalledWith('0xabc');
    });

    it('holds on to what the visit started with, which is what keeps the row', () => {
      // The rendering tests above take their list ready-made, so they cannot
      // see the filter that decides whether the row survives at all. This asks
      // the filter itself, which is the half that actually fixes the bug.
      const pedirFiltro = () =>
        (paginas.mock.calls.at(-1)![0] as { keep: (e: { id: string }) => boolean }).keep;

      guardadas.mockReturnValue({ ids: ['0xabc'], isSaved: () => true, toggle: vi.fn() });
      paginas.mockReturnValue({ all: [UNA], loading: false, error: null, refresh: vi.fn() });
      const { rerender } = render(<SavedElections role="voter" />);
      expect(pedirFiltro()({ id: '0xabc' })).toBe(true);

      // Pressed: no longer saved, and nothing remembers it but this screen.
      guardadas.mockReturnValue({ ids: [], isSaved: () => false, toggle: vi.fn() });
      rerender(<SavedElections role="voter" />);

      expect(pedirFiltro()({ id: '0xabc' })).toBe(true);
      // And one it never held is still none of its business.
      expect(pedirFiltro()({ id: '0xotra' })).toBe(false);
    });

    it('keeps the folded half out of reach of the keyboard', () => {
      // Both halves stay in the document so the fold has something to measure,
      // so "not shown" has to mean more than "not seen": an undo nobody can
      // see must not be somewhere a tab key can land.
      guardadas.mockReturnValue({ ids: ['0xabc'], isSaved: () => true, toggle: vi.fn() });
      paginas.mockReturnValue({ all: [UNA], loading: false, error: null, refresh: vi.fn() });

      const { rerender } = render(<SavedElections role="voter" />);
      expect(screen.getByText('saved.undo').closest('[inert]')).not.toBeNull();
      expect(screen.getByText('0xabc').closest('[inert]')).toBeNull();

      // Removed: the two swap places.
      guardadas.mockReturnValue({ ids: [], isSaved: () => false, toggle: vi.fn() });
      rerender(<SavedElections role="voter" />);

      expect(screen.getByText('saved.undo').closest('[inert]')).toBeNull();
      expect(screen.getByText('0xabc').closest('[inert]')).not.toBeNull();
    });
  });

  it('reports a failure rather than an empty list', () => {
    guardadas.mockReturnValue({ ids: ['0xabc'], isSaved: () => true });
    paginas.mockReturnValue({ all: [], loading: false, error: new Error('no'), refresh: vi.fn() });

    render(<SavedElections role="voter" />);

    expect(screen.getByText('list-error')).toBeInTheDocument();
  });
});
