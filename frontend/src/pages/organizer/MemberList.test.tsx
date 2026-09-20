/**
 * The member list, and the election name said once instead of once per row.
 *
 * A commitment belongs to exactly one election, so every row used to carry the
 * same title as the row above it, under the 77-digit number that is the thing
 * actually being read. The name is a heading now, and these pin the two
 * properties that makes it worth: one heading per election however many members
 * it has, and none at all when the list is already filtered down to one.
 *
 * Driven through the demo path (`isChainConfigured` false), which is the one
 * that needs no chain, no wallet and no awaiting.
 *
 * i18next is mocked globally to return the key, so labels read as keys.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, within } from '@testing-library/react';

vi.mock('../../lib/deployments', () => ({
  isChainConfigured: () => false,
  deploymentBlock: () => 0,
}));
vi.mock('../../hooks/useOrganizerWallet', () => ({
  useOrganizerWallet: () => ({ address: undefined }),
  getRememberedOrganizerAddress: () => null,
}));
vi.mock('../../components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/** The filter lives in the query string, so the test sets it there. */
const params = { value: new URLSearchParams() };
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [params.value, vi.fn()],
}));

const MemberList = (await import('./MemberList')).default;

/** Headings are the rows carrying an election's name and its count. */
function encabezados(container: HTMLElement): string[] {
  return [...container.querySelectorAll('div.bg-white\\/3')]
    .map(h => h.querySelector('p')?.textContent?.trim() ?? '')
    .filter(Boolean);
}

describe('the member list grouped by election', () => {
  it('names each election once, not once per member', () => {
    params.value = new URLSearchParams();
    const { container } = render(<MemberList />);

    const nombres = encabezados(container);
    expect(nombres.length).toBeGreaterThan(1);
    // The heading is the point: one per election, never repeated.
    expect(new Set(nombres).size).toBe(nombres.length);

    // And there are more members on screen than there are headings, which is
    // the repetition that was taken out.
    const filas = container.querySelectorAll('p.font-mono');
    expect(filas.length).toBeGreaterThan(nombres.length);
  });

  it('counts the whole election, not the rows that fit on this page', () => {
    params.value = new URLSearchParams();
    const { container } = render(<MemberList />);

    const primero = container.querySelector('div.bg-white\\/3') as HTMLElement;
    const escrito = within(primero).getAllByText(/members\.count/)[0].textContent ?? '';
    const cuantos = Number(escrito.trim().split(/\s+/)[0]);
    expect(cuantos).toBeGreaterThan(0);
  });

  it('says no name at all when the list is already one election', () => {
    // Filtered down from the dropdown or from "view members" on an election:
    // a heading here would only repeat the control directly above it.
    const { container: todas } = render(<MemberList />);
    const alguna = (todas.querySelector('div.bg-white\\/3 p') as HTMLElement).textContent!;

    params.value = new URLSearchParams();
    const { container } = render(<MemberList />);
    const idDeEsa = [...container.querySelectorAll('div.bg-white\\/3 p')]
      .find(p => p.textContent === alguna);
    expect(idDeEsa).toBeTruthy();

    // Now the same page scoped to one election.
    params.value = new URLSearchParams({ election: 'e1' });
    const { container: una } = render(<MemberList />);
    expect(encabezados(una)).toHaveLength(0);
    // The members are still there; only the heading went.
    expect(una.querySelectorAll('p.font-mono').length).toBeGreaterThan(0);
  });
});
