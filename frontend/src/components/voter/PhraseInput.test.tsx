/**
 * Twelve boxes that still behave like one field.
 *
 * The grid is there so somebody reading word nine off a piece of paper can find
 * the box that says nine. What it must not cost is the common case: most people
 * copied the phrase into a password manager and paste it straight back, and a
 * grid that makes them paste twelve times would be worse than the textarea it
 * replaced.
 *
 * i18next is mocked globally to return the key, so labels read as keys.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';

import { PhraseInput } from './PhraseInput';

const FRASE = 'habit nacho koala panda gecko quilt jelly bagel fable igloo daisy acorn';

/** Controlled the way the screen controls it: one string, in and out. */
function Anfitrion({ inicial = '' }: { inicial?: string }) {
  const [value, setValue] = useState(inicial);
  return (
    <>
      <PhraseInput value={value} onChange={setValue} />
      <output data-testid="valor">{value}</output>
    </>
  );
}

const cajas = () => screen.getAllByRole('textbox') as HTMLInputElement[];
const valor = () => screen.getByTestId('valor').textContent;

/** A paste event carrying text, the way a browser delivers one. */
function pegar(caja: HTMLElement, texto: string) {
  const datos = { getData: () => texto };
  fireEvent.paste(caja, { clipboardData: datos });
}

describe('typing the phrase back in', () => {
  it('draws one box per word', () => {
    render(<Anfitrion />);
    expect(cajas()).toHaveLength(12);
  });

  it('spreads a pasted phrase across every box', () => {
    render(<Anfitrion />);

    pegar(cajas()[0], FRASE);

    expect(cajas().map(c => c.value)).toEqual(FRASE.split(' '));
    expect(valor()).toBe(FRASE);
  });

  it('takes a phrase pasted with line breaks or double spaces', () => {
    render(<Anfitrion />);

    // Straight out of a text file, one word per line.
    pegar(cajas()[0], FRASE.split(' ').join('\n'));

    expect(valor()).toBe(FRASE);
  });

  it('pastes into the boxes from where it lands, not always the first', () => {
    render(<Anfitrion />);

    pegar(cajas()[4], 'gecko quilt jelly');

    const puestas = cajas().map(c => c.value);
    expect(puestas[4]).toBe('gecko');
    expect(puestas[5]).toBe('quilt');
    expect(puestas[6]).toBe('jelly');
    expect(puestas[0]).toBe('');
  });

  it('drops anything past the twelfth rather than losing the twelve', () => {
    render(<Anfitrion />);

    pegar(cajas()[0], FRASE + ' spare');

    expect(cajas().map(c => c.value)).toEqual(FRASE.split(' '));
  });

  it('lets a single word be pasted into a box like ordinary typing', () => {
    render(<Anfitrion />);

    // Not intercepted: one word is a normal edit, and preventing it would stop
    // somebody fixing a single box from their clipboard.
    const evento = fireEvent.paste(cajas()[3], { clipboardData: { getData: () => 'panda' } });
    expect(evento).toBe(true);
  });

  it('moves on when a word is finished with a space', () => {
    render(<Anfitrion />);

    fireEvent.change(cajas()[0], { target: { value: 'habit ' } });

    expect(cajas()[0].value).toBe('habit');
    expect(document.activeElement).toBe(cajas()[1]);
  });

  it('lowercases what is typed, because the words are', () => {
    render(<Anfitrion />);

    fireEvent.change(cajas()[0], { target: { value: 'HABIT' } });

    expect(valor()?.startsWith('habit')).toBe(true);
  });

  it('walks back when backspace is pressed in an empty box', () => {
    render(<Anfitrion inicial="habit nacho" />);

    cajas()[2].focus();
    fireEvent.keyDown(cajas()[2], { key: 'Backspace' });

    expect(document.activeElement).toBe(cajas()[1]);
  });

  it('keeps a half-filled grid down to the words it holds', () => {
    render(<Anfitrion />);

    fireEvent.change(cajas()[0], { target: { value: 'habit' } });
    fireEvent.change(cajas()[2], { target: { value: 'koala' } });

    // The gap is an empty box, not a word: the screen normalises before sealing, and
    // this is the string it gets.
    expect(valor()?.split(' ').filter(Boolean)).toEqual(['habit', 'koala']);
  });


  it('empties every box at once, because twelve at a time is not a thing to ask', () => {
    render(<Anfitrion inicial={FRASE} />);

    fireEvent.click(screen.getByText('recover.clear'));

    expect(cajas().every(c => c.value === '')).toBe(true);
    expect(valor()?.trim()).toBe('');
    // Straight back to the first box, which is where they are going next.
    expect(document.activeElement).toBe(cajas()[0]);
  });

  it('does not offer to clear a grid that is already empty', () => {
    render(<Anfitrion />);
    expect(screen.queryByText('recover.clear')).toBeNull();

    fireEvent.change(cajas()[0], { target: { value: 'habit' } });
    expect(screen.getByText('recover.clear')).toBeInTheDocument();
  });

  it('marks the box holding a word that is not on the list', () => {
    render(<PhraseInput value="habit zzzz" onChange={vi.fn()} invalid={['zzzz']} />);

    const marcadas = (screen.getAllByRole('textbox') as HTMLInputElement[])
      .filter(c => c.getAttribute('aria-invalid') === 'true');
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0].value).toBe('zzzz');
  });
});
