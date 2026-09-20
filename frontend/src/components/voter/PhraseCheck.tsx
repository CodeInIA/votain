/**
 * Proving the words were written down, by asking for three of them back.
 *
 * WHAT IT REPLACED. A modal that asked "have you saved them?" with a button
 * saying yes. Anybody trying to get past it pressed yes, and pressing yes is
 * exactly what somebody does who copied the words and never pasted them
 * anywhere: the question tested intent, and intent is not what fails here.
 * This asks for something that cannot be answered without the words in front
 * of you, which is the same reason a wallet asks it.
 *
 * THREE, NOT TWELVE. Twelve is a transcription exercise and people paste it
 * back from the clipboard they just filled, which proves nothing at all. Three
 * positions drawn at random are enough that guessing is not worth trying and
 * few enough to do from a piece of paper without resentment.
 *
 * NO DECOYS. The three words offered ARE the three missing ones, shuffled, so
 * the task is to put them in the right places. Adding wrong words would test
 * recognition of a wordlist this app publishes anyway; placing them tests the
 * only thing that matters, which is having the order.
 *
 * GOING BACK IS OFFERED, NOT HIDDEN. Somebody who fails is far likelier to be
 * a person who did save the words and misread a number than an impostor, and a
 * gate that strands the honest case teaches people to screenshot the phrase.
 * The words are still on the previous step; pretending otherwise would only
 * make this look stricter than it is.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CircleCheck, ShieldQuestion } from 'lucide-react';

import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

/** How many of the twelve are asked for. */
const ASKED = 3;

/** A shuffle that does not favour any position. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function PhraseCheck({
  phrase,
  onPass,
  onBack,
}: {
  phrase: string;
  onPass: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const words = useMemo(() => phrase.split(' '), [phrase]);

  /**
   * Drawn once and kept.
   *
   * In a `useMemo` over the phrase rather than recomputed: re-picking the
   * positions on any re-render would move the blanks under somebody's finger
   * mid-answer, and re-shuffling the tray would do it while they were reading.
   */
  const asked = useMemo(
    () => shuffled(words.map((_, i) => i)).slice(0, ASKED).sort((a, b) => a - b),
    [words],
  );
  const tray = useMemo(() => shuffled(asked.map(i => words[i])), [asked, words]);

  /** Position in the phrase -> the word dropped there, or nothing yet. */
  const [placed, setPlaced] = useState<Record<number, string>>({});
  const [wrong, setWrong] = useState(false);

  const usadas = new Set(Object.values(placed));
  const siguienteHueco = asked.find(i => !placed[i]);
  const completo = asked.every(i => placed[i]);

  const colocar = (palabra: string) => {
    if (usadas.has(palabra) || siguienteHueco === undefined) return;
    setWrong(false);
    setPlaced(p => ({ ...p, [siguienteHueco]: palabra }));
  };

  const quitar = (posicion: number) => {
    setWrong(false);
    setPlaced(p => {
      const siguiente = { ...p };
      delete siguiente[posicion];
      return siguiente;
    });
  };

  const comprobar = () => {
    // Every asked position has to hold the word that belongs there. Checking
    // the set rather than the order would pass three right words in the wrong
    // places, which is precisely the mistake this is here to catch.
    if (asked.every(i => placed[i] === words[i])) {
      onPass();
      return;
    }
    setWrong(true);
    setPlaced({});
  };

  return (
    <>
      <div className="flex items-start gap-3">
        <ShieldQuestion className="w-5 h-5 text-primary-dim shrink-0 mt-0.5" strokeWidth={1.5} />
        <div className="min-w-0">
          <h2 className="text-base font-bold text-on-surface">{t('new_identity.check_title')}</h2>
          <p className="text-sm text-on-surface-variant leading-relaxed mt-1">
            {t('new_identity.check_desc', { n: ASKED })}
          </p>
        </div>
      </div>

      {/* The whole phrase, with the asked positions hollowed out, so the blanks
          are read in the place they belong rather than as three loose puzzles. */}
      <ol className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 mt-4 rounded-2xl bg-white/5 border border-white/10">
        {words.map((word, i) => {
          const esHueco = asked.includes(i);
          const dentro = placed[i];
          return (
            <li key={i} className="flex items-baseline gap-2 text-sm">
              <span className="text-on-surface-meta tabular-nums w-5 text-right">{i + 1}</span>
              {!esHueco ? (
                <span className="font-mono text-on-surface">{word}</span>
              ) : dentro ? (
                <button
                  type="button"
                  onClick={() => quitar(i)}
                  aria-label={t('new_identity.check_remove', { word: dentro, position: i + 1 })}
                  className={cn(
                    'font-mono rounded-md px-2 -mx-1 cursor-pointer transition-colors',
                    'bg-primary/15 text-on-surface hover:bg-primary/25',
                  )}
                >
                  {dentro}
                </button>
              ) : (
                <span
                  aria-label={t('new_identity.check_blank', { position: i + 1 })}
                  className={cn(
                    'h-5 flex-1 rounded-md border border-dashed',
                    wrong ? 'border-error/50' : 'border-white/25',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* The tray. A used word stays visible but spent, so the three never
          reflow under a finger that is reaching for one of them. */}
      <div className="flex flex-wrap justify-center gap-2 mt-4">
        {tray.map(palabra => {
          const gastada = usadas.has(palabra);
          return (
            <Button
              key={palabra}
              variant="default"
              disabled={gastada}
              onClick={() => colocar(palabra)}
              className={cn('rounded-full px-4 font-mono', gastada && 'opacity-40')}
            >
              {palabra}
            </Button>
          );
        })}
      </div>

      {wrong && (
        <p role="alert" className="text-xs text-error leading-relaxed mt-4 text-center">
          {t('new_identity.check_wrong')}
        </p>
      )}

      <Button
        variant="gradient"
        size="lg"
        className="w-full rounded-full h-12 mt-5 gap-2"
        disabled={!completo}
        onClick={comprobar}
      >
        <CircleCheck className="w-4 h-4" />
        {t('new_identity.check_confirm')}
      </Button>

      <Button
        variant="ghost"
        className="w-full rounded-full h-11 mt-2 gap-2 text-sm text-on-surface-meta"
        onClick={onBack}
      >
        <ArrowLeft className="w-4 h-4" />
        {t('new_identity.check_back')}
      </Button>
    </>
  );
}
