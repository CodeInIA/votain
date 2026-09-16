import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { BackButton } from './BackButton';

/**
 * Going back, and what that costs when it is not really going back.
 *
 * The organizer's election page navigated to `/organizer/dashboard` instead of
 * stepping back, because it can also be reached from a direct link and from
 * the members list. That is right for the link and wrong for everybody else:
 * the dashboard keeps its filters in the query string, so arriving at the bare
 * path threw them away, and an organizer who filtered, opened an election and
 * came back found the list as it had been before they filtered it.
 *
 * i18next is mocked globally to return the key.
 */

const navigations: Array<string | number> = [];

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => (to: string | number) => navigations.push(to),
  };
});

beforeEach(() => {
  navigations.length = 0;
});

describe('BackButton', () => {
  it('steps back when this app put the previous page there', () => {
    render(
      <MemoryRouter initialEntries={['/first', '/second']} initialIndex={1}>
        <BackButton fallback="/organizer/dashboard" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button'));

    // Back restores the whole URL, query string and all, which is the only way
    // the filters survive the trip.
    expect(navigations).toEqual([-1]);
  });

  it('takes the fallback when there is nothing behind this page', () => {
    // A direct link or a reload: the entry the session arrived on. Stepping
    // back from here leaves the app.
    render(
      <MemoryRouter initialEntries={['/organizer/election/0x1']}>
        <BackButton fallback="/organizer/dashboard" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(navigations).toEqual(['/organizer/dashboard']);
  });

  it('still just steps back when no fallback was named', () => {
    render(
      <MemoryRouter initialEntries={['/election/0x1']}>
        <BackButton />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(navigations).toEqual([-1]);
  });

  it('lets a caller override the whole thing', () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter initialEntries={['/anywhere']}>
        <BackButton onClick={onClick} fallback="/organizer/dashboard" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(navigations).toEqual([]);
  });
});
