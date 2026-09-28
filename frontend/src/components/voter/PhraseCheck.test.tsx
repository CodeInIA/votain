/**
 * The step that asks for three of the twelve words back.
 *
 * It replaced a modal whose only question was "have you saved them?", answered
 * by pressing yes. These pin the properties that make the replacement worth
 * anything: that the ORDER is checked and not just the set, that a wrong answer
 * does not let anybody through, and that the way back to the words exists.
 *
 * i18next is mocked globally to return the key, so the assertions read as keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const PHRASE = 'habit nacho koala panda gecko quilt jelly bagel fable igloo daisy acorn';
const WORDS = PHRASE.split(' ');

const { PhraseCheck } = await import('./PhraseCheck');

/** The blanks, read off the rendered list rather than guessed at. */
function blanks(container: HTMLElement): number[] {
  return [...container.querySelectorAll('li')]
    .map((li, i) => (li.querySelector('span[class*="border-dashed"]') ? i : -1))
    .filter(i => i >= 0);
}

/** The tray buttons, which are the only ones carrying a word of the phrase. */
function tray(): HTMLElement[] {
  return screen.getAllByRole('button').filter(b => WORDS.includes(b.textContent?.trim() ?? ''));
}

beforeEach(() => vi.restoreAllMocks());

describe('asking for three words back', () => {
  it('blanks three positions and offers exactly those three words', () => {
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={() => {}} onBack={() => {}} />);

    const asked = blanks(container);
    expect(asked).toHaveLength(3);

    const offered = tray().map(b => b.textContent!.trim()).sort();
    expect(offered).toEqual(asked.map(i => WORDS[i]).sort());
  });

  it('lets them through when every word is in its own place', () => {
    const onPass = vi.fn();
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={onPass} onBack={() => {}} />);

    // Filling happens left to right, so pressing the words in the order the
    // blanks appear is what a correct answer looks like.
    for (const i of blanks(container)) {
      fireEvent.click(tray().find(b => b.textContent!.trim() === WORDS[i])!);
    }
    fireEvent.click(screen.getByText('new_identity.check_confirm'));

    expect(onPass).toHaveBeenCalledOnce();
  });

  it('refuses three right words in the wrong places', () => {
    const onPass = vi.fn();
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={onPass} onBack={() => {}} />);

    // The same three words, deliberately rotated by one. Checking membership
    // instead of position would wave this through, which is the whole point.
    const asked = blanks(container);
    const alReves = [asked[1], asked[2], asked[0]];
    for (const i of alReves) {
      fireEvent.click(tray().find(b => b.textContent!.trim() === WORDS[i])!);
    }
    fireEvent.click(screen.getByText('new_identity.check_confirm'));

    expect(onPass).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('new_identity.check_wrong');
  });

  it('cannot be confirmed until all three are placed', () => {
    const onPass = vi.fn();
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={onPass} onBack={() => {}} />);

    const boton = screen.getByText('new_identity.check_confirm').closest('button')!;
    expect(boton).toBeDisabled();

    fireEvent.click(tray().find(b => b.textContent!.trim() === WORDS[blanks(container)[0]])!);
    expect(boton).toBeDisabled();
  });

  it('clears the board after a wrong answer instead of leaving it half filled', () => {
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={() => {}} onBack={() => {}} />);

    const asked = blanks(container);
    for (const i of [asked[1], asked[2], asked[0]]) {
      fireEvent.click(tray().find(b => b.textContent!.trim() === WORDS[i])!);
    }
    fireEvent.click(screen.getByText('new_identity.check_confirm'));

    expect(blanks(container)).toHaveLength(3);
    expect(tray().every(b => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('gives a placed word back when it is pressed', () => {
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={() => {}} onBack={() => {}} />);

    const primero = blanks(container)[0];
    fireEvent.click(tray().find(b => b.textContent!.trim() === WORDS[primero])!);
    expect(blanks(container)).toHaveLength(2);

    // The word now sits in the list; pressing it there returns it to the tray.
    const puesta = within(container.querySelectorAll('li')[primero]).getByRole('button');
    fireEvent.click(puesta);
    expect(blanks(container)).toHaveLength(3);
  });

  it('offers the way back to the words', () => {
    const onBack = vi.fn();
    render(<PhraseCheck phrase={PHRASE} onPass={() => {}} onBack={onBack} />);

    fireEvent.click(screen.getByText('new_identity.check_back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('drops a word into the blank it was dragged to, not the first one', () => {
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={() => {}} onBack={() => {}} />);

    const asked = blanks(container);
    // The LAST blank, so landing there cannot be confused with the
    // fill-in-order behaviour a press would have given.
    const target = asked[asked.length - 1];
    const chip = tray().find(b => b.textContent!.trim() === WORDS[target])!;
    const slot = container.querySelectorAll('li')[target].querySelector('[data-blank]')!;

    // `elementFromPoint` is what the component uses to find the drop target,
    // and jsdom has no layout, so it always returns null. Pointing it at the
    // slot is what makes the gesture testable at all.
    const original = document.elementFromPoint;
    document.elementFromPoint = () => slot as Element;
    try {
      fireEvent.pointerDown(chip, { clientX: 0, clientY: 0, pointerId: 1 });
      // Past the eight pixel threshold, or this counts as a press.
      fireEvent.pointerMove(chip, { clientX: 80, clientY: 60, pointerId: 1 });
      fireEvent.pointerUp(chip, { clientX: 80, clientY: 60, pointerId: 1 });
    } finally {
      document.elementFromPoint = original;
    }

    const li = container.querySelectorAll('li')[target];
    expect(within(li as HTMLElement).getByRole('button').textContent).toContain(WORDS[target]);
  });

  it('a drag does not also place the word through the click that follows it', () => {
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={() => {}} onBack={() => {}} />);

    const asked = blanks(container);
    const target = asked[asked.length - 1];
    const chip = tray().find(b => b.textContent!.trim() === WORDS[target])!;
    const slot = container.querySelectorAll('li')[target].querySelector('[data-blank]')!;

    const original = document.elementFromPoint;
    document.elementFromPoint = () => slot as Element;
    try {
      fireEvent.pointerDown(chip, { clientX: 0, clientY: 0, pointerId: 1 });
      fireEvent.pointerMove(chip, { clientX: 80, clientY: 60, pointerId: 1 });
      fireEvent.pointerUp(chip, { clientX: 80, clientY: 60, pointerId: 1 });
    } finally {
      document.elementFromPoint = original;
    }
    // The browser sends this after every drag, and acting on it would fill a
    // second blank with the same word.
    fireEvent.click(chip);

    const filled = [...container.querySelectorAll('li')]
      .filter(li => li.querySelector('button'));
    expect(filled).toHaveLength(1);
  });
});
