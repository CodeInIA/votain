import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ExpandableText } from './ExpandableText';

/**
 * The toggle has to appear exactly when something is hidden and not otherwise,
 * so these drive the one thing that decides it: whether the clamped paragraph
 * is taller than its own box.
 *
 * jsdom lays nothing out, so `scrollHeight` and `clientHeight` are both zero and
 * every paragraph would look like it fits. They are stubbed per test to stand in
 * for the two cases a browser produces.
 */

function stubHeights(scroll: number, client: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => scroll,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => client,
  });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  // @ts-expect-error restoring the jsdom defaults
  delete HTMLElement.prototype.scrollHeight;
  // @ts-expect-error restoring the jsdom defaults
  delete HTMLElement.prototype.clientHeight;
});

describe('ExpandableText', () => {
  it('offers no toggle for text that already fits', () => {
    // Otherwise the control would promise something more to read and, on being
    // pressed, show the same words again.
    stubHeights(40, 40);
    render(<ExpandableText text="Short enough." />);
    expect(screen.queryByText('common.show_more')).not.toBeInTheDocument();
  });

  it('offers one when the text is taller than its clamp', () => {
    stubHeights(400, 80);
    render(<ExpandableText text={'word '.repeat(500)} />);
    expect(screen.getByText('common.show_more')).toBeInTheDocument();
  });

  it('ignores a hair of overflow from sub-pixel line heights', () => {
    // A paragraph that fits exactly can report a scrollHeight a fraction taller
    // than its box, which would put a useless toggle under half the cards.
    stubHeights(81, 80);
    render(<ExpandableText text="Just fits." />);
    expect(screen.queryByText('common.show_more')).not.toBeInTheDocument();
  });

  it('shows the whole text when opened, and offers the way back', () => {
    stubHeights(400, 80);
    render(<ExpandableText text={'word '.repeat(500)} />);

    fireEvent.click(screen.getByText('common.show_more'));

    expect(screen.getByText('common.show_less')).toBeInTheDocument();
    // No clamp left on the paragraph: the whole description is on the page.
    const paragraph = document.querySelector('p') as HTMLElement;
    expect(paragraph.style.webkitLineClamp).toBe('');
    expect(paragraph.style.overflow).toBe('');
  });

  it('keeps the collapse control even when nothing was overflowing', () => {
    // Once expanded, the measurement says it fits, since it no longer clamps.
    // Dropping the button on that basis would strand the reader in the state the
    // component exists to avoid.
    stubHeights(400, 80);
    render(<ExpandableText text={'word '.repeat(500)} />);
    fireEvent.click(screen.getByText('common.show_more'));

    stubHeights(400, 400);
    expect(screen.getByText('common.show_less')).toBeInTheDocument();
  });

  it('clamps to the number of lines it is given', () => {
    stubHeights(400, 80);
    render(<ExpandableText text={'word '.repeat(500)} lines={2} />);
    const paragraph = document.querySelector('p') as HTMLElement;
    expect(paragraph.style.webkitLineClamp).toBe('2');
  });
});
