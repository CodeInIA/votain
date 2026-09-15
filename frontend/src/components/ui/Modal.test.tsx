/**
 * The padding of a modal that draws its own heading.
 *
 * The top padding used to live only in the header block, which renders when a
 * `title` or `description` is passed. A modal that instead draws its own
 * heading in `children` got `px-6 pb-6` and nothing on top, so its content sat
 * flush against the top edge while the bottom kept its margin. The recovery
 * phrase notice is exactly that shape, and it is the one modal a voter cannot
 * dismiss, so it is also the one they look at longest.
 *
 * Pinned here because nothing else catches it: it type-checks, it renders, it
 * passes every other test, and it is only visible to someone looking at the
 * screen.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Modal } from './Modal';

describe('Modal padding', () => {
  it('pads the top when the modal draws its own heading', () => {
    render(
      <Modal open onClose={() => {}}>
        <p>own heading</p>
      </Modal>,
    );

    const body = screen.getByText('own heading').parentElement;
    expect(body?.className).toContain('pt-6');
  });

  it('does not pad it twice when a header is already there', () => {
    render(
      <Modal open onClose={() => {}} title="Confirm">
        <p>with header</p>
      </Modal>,
    );

    const body = screen.getByText('with header').parentElement;
    expect(body?.className).not.toContain('pt-6');
  });
});
