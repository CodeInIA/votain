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

const PHRASE = 'harbor pewter pepper pine denim prairie meadow arrow crystal lagoon cinder anchor';
const WORDS = PHRASE.split(' ');

const { PhraseCheck } = await import('./PhraseCheck');

/** The blanks, read off the rendered list rather than guessed at. */
function huecos(container: HTMLElement): number[] {
  return [...container.querySelectorAll('li')]
    .map((li, i) => (li.querySelector('span[class*="border-dashed"]') ? i : -1))
    .filter(i => i >= 0);
}

/** The tray buttons, which are the only ones carrying a word of the phrase. */
function bandeja(): HTMLElement[] {
  return screen.getAllByRole('button').filter(b => WORDS.includes(b.textContent?.trim() ?? ''));
}

beforeEach(() => vi.restoreAllMocks());

describe('asking for three words back', () => {
  it('blanks three positions and offers exactly those three words', () => {
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={() => {}} onBack={() => {}} />);

    const pedidos = huecos(container);
    expect(pedidos).toHaveLength(3);

    const ofrecidas = bandeja().map(b => b.textContent!.trim()).sort();
    expect(ofrecidas).toEqual(pedidos.map(i => WORDS[i]).sort());
  });

  it('lets them through when every word is in its own place', () => {
    const onPass = vi.fn();
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={onPass} onBack={() => {}} />);

    // Filling happens left to right, so pressing the words in the order the
    // blanks appear is what a correct answer looks like.
    for (const i of huecos(container)) {
      fireEvent.click(bandeja().find(b => b.textContent!.trim() === WORDS[i])!);
    }
    fireEvent.click(screen.getByText('new_identity.check_confirm'));

    expect(onPass).toHaveBeenCalledOnce();
  });

  it('refuses three right words in the wrong places', () => {
    const onPass = vi.fn();
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={onPass} onBack={() => {}} />);

    // The same three words, deliberately rotated by one. Checking membership
    // instead of position would wave this through, which is the whole point.
    const pedidos = huecos(container);
    const alReves = [pedidos[1], pedidos[2], pedidos[0]];
    for (const i of alReves) {
      fireEvent.click(bandeja().find(b => b.textContent!.trim() === WORDS[i])!);
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

    fireEvent.click(bandeja().find(b => b.textContent!.trim() === WORDS[huecos(container)[0]])!);
    expect(boton).toBeDisabled();
  });

  it('clears the board after a wrong answer instead of leaving it half filled', () => {
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={() => {}} onBack={() => {}} />);

    const pedidos = huecos(container);
    for (const i of [pedidos[1], pedidos[2], pedidos[0]]) {
      fireEvent.click(bandeja().find(b => b.textContent!.trim() === WORDS[i])!);
    }
    fireEvent.click(screen.getByText('new_identity.check_confirm'));

    expect(huecos(container)).toHaveLength(3);
    expect(bandeja().every(b => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('gives a placed word back when it is pressed', () => {
    const { container } = render(<PhraseCheck phrase={PHRASE} onPass={() => {}} onBack={() => {}} />);

    const primero = huecos(container)[0];
    fireEvent.click(bandeja().find(b => b.textContent!.trim() === WORDS[primero])!);
    expect(huecos(container)).toHaveLength(2);

    // The word now sits in the list; pressing it there returns it to the tray.
    const puesta = within(container.querySelectorAll('li')[primero]).getByRole('button');
    fireEvent.click(puesta);
    expect(huecos(container)).toHaveLength(3);
  });

  it('offers the way back to the words', () => {
    const onBack = vi.fn();
    render(<PhraseCheck phrase={PHRASE} onPass={() => {}} onBack={onBack} />);

    fireEvent.click(screen.getByText('new_identity.check_back'));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
