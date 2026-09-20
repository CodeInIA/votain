/**
 * The twelve words, typed back in, one box per word.
 *
 * WHAT IT REPLACED. A single textarea with the twelve words as a sentence. It
 * worked, and it asked somebody reading off a piece of paper to keep their own
 * count: nothing on screen said which word they were on, a word dropped in the
 * middle was invisible, and "0 of 12 words" underneath was the only feedback,
 * arriving after the mistake rather than during it.
 *
 * THE SAME SHAPE THEY WERE GIVEN. Setup hands the phrase over as a numbered
 * grid, so recovery asks for it back in the same numbered grid. Somebody
 * copying word nine from paper looks for the box that says nine.
 *
 * PASTING STILL HAS TO WORK, and it is the common case: most people copied the
 * phrase into a password manager and will paste it straight back. A paste
 * carrying more than one word spreads across the boxes from wherever it lands,
 * so pasting all twelve into the first box fills the grid, and pasting three
 * into box five fills five, six and seven. Splitting on any whitespace also
 * means a phrase pasted from a text file, one word per line, arrives correctly.
 *
 * THE VALUE STAYS A STRING. The screen around this validates, normalises and
 * seals a phrase, not an array, and `normalizePhrase` already collapses
 * whitespace and drops empties, so a half-filled grid joins to exactly the
 * words that are in it.
 */
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Eraser } from 'lucide-react';

import { cn } from '../../lib/utils';

/** A recovery phrase is twelve words. See `lib/recoveryPhrase`. */
const WORDS = 12;

export function PhraseInput({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Words this list does not contain, so the box holding one can say so. */
  invalid?: readonly string[];
}) {
  const { t } = useTranslation();
  const cajas = useRef<Array<HTMLInputElement | null>>([]);

  /**
   * Derived from the value rather than held beside it.
   *
   * Two sources of truth for the same twelve words is how a grid ends up
   * disagreeing with what gets sealed.
   */
  const words = useMemo(() => {
    const partes = value.split(' ');
    return Array.from({ length: WORDS }, (_, i) => partes[i] ?? '');
  }, [value]);

  const escribir = (siguiente: string[]) => onChange(siguiente.join(' '));

  const enfocar = (i: number) => {
    const caja = cajas.current[Math.max(0, Math.min(WORDS - 1, i))];
    caja?.focus();
    caja?.select();
  };

  const cambiar = (i: number, texto: string) => {
    // A space typed at the end of a word is somebody moving on, not part of it.
    const saltar = /\s$/.test(texto);
    const limpio = texto.trim().toLowerCase();
    const siguiente = [...words];
    siguiente[i] = limpio;
    escribir(siguiente);
    if (saltar && limpio && i < WORDS - 1) enfocar(i + 1);
  };

  const pegar = (i: number, evento: React.ClipboardEvent<HTMLInputElement>) => {
    const pegado = evento.clipboardData.getData('text');
    const trozos = pegado.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // One word pasted into one box is just typing; let the browser do it.
    if (trozos.length < 2) return;
    evento.preventDefault();

    const siguiente = [...words];
    trozos.forEach((palabra, n) => {
      if (i + n < WORDS) siguiente[i + n] = palabra;
    });
    escribir(siguiente);
    enfocar(i + trozos.length);
  };

  /**
   * Emptying twelve boxes one at a time is not a thing to ask of anybody, and
   * it is the ordinary move here: somebody pastes the wrong phrase, or gets
   * halfway through by hand and loses their place.
   *
   * Only when there is something to clear. Offered over an empty grid it is
   * furniture that does nothing, and it would sit in the tab order on the way
   * to the first box.
   */
  const limpiar = () => {
    onChange('');
    enfocar(0);
  };

  const teclear = (i: number, evento: React.KeyboardEvent<HTMLInputElement>) => {
    const caja = evento.currentTarget;
    if ((evento.key === ' ' || evento.key === 'Enter') && caja.value.trim()) {
      evento.preventDefault();
      if (i < WORDS - 1) enfocar(i + 1);
      return;
    }
    // Backspace at the start of an empty box walks back, the way a set of
    // one-character code boxes does, so a mistake two words ago is reachable
    // without going for the mouse.
    if (evento.key === 'Backspace' && !caja.value && i > 0) {
      evento.preventDefault();
      enfocar(i - 1);
      return;
    }
    if (evento.key === 'ArrowLeft' && caja.selectionStart === 0 && i > 0) {
      evento.preventDefault();
      enfocar(i - 1);
    }
    if (evento.key === 'ArrowRight' && caja.selectionStart === caja.value.length && i < WORDS - 1) {
      evento.preventDefault();
      enfocar(i + 1);
    }
  };

  const algoEscrito = words.some(Boolean);

  return (
    <>
      <div className="flex justify-end h-7 -mt-1 mb-1">
        {algoEscrito && (
          <button
            type="button"
            onClick={limpiar}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs cursor-pointer',
              'text-on-surface-meta hover:text-on-surface hover:bg-white/5 transition-colors',
            )}
          >
            <Eraser className="w-3.5 h-3.5" />
            {t('recover.clear')}
          </button>
        )}
      </div>

    {/* The panel steps back now that the boxes carry their own edges: two
        surfaces of the same weight, one inside the other, read as neither. */}
    <ol className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {words.map((word, i) => {
        const mala = !!word && invalid?.includes(word);
        return (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span className="text-on-surface-meta tabular-nums w-5 text-right shrink-0">
              {i + 1}
            </span>
            <input
              ref={el => { cajas.current[i] = el; }}
              value={word}
              onChange={e => cambiar(i, e.target.value)}
              onPaste={e => pegar(i, e)}
              onKeyDown={e => teclear(i, e)}
              aria-label={t('recover.word_label', { position: i + 1 })}
              aria-invalid={mala || undefined}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                /* A SUNKEN FIELD, EMPTY OR NOT, in the language `ui/Input` already
                   speaks. Transparent until focused, these read as twelve numbers
                   floating on a panel: nothing said where to type, how much room a
                   word had, or that there were twelve places waiting rather than
                   one list being displayed. */
                'min-w-0 flex-1 font-mono text-on-surface rounded-lg px-2.5 py-1.5',
                'bg-surface-lowest/60 border border-outline-variant/20',
                'outline-none transition-all duration-200',
                'hover:border-outline-variant/40',
                'focus:border-primary/60 focus:bg-surface-lowest/80',
                'focus:shadow-[0_0_0_3px_rgba(79,142,247,0.15)]',
                // A word that is not on the list is worth saying at the box that
                // holds it, rather than only in a sentence under the grid.
                mala && 'border-error/60 text-error focus:border-error/80',
              )}
            />
          </li>
        );
      })}
    </ol>
    </>
  );
}
