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
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

  const used = new Set(Object.values(placed));
  const nextBlank = asked.find(i => !placed[i]);
  const completo = asked.every(i => placed[i]);

  const place = (word: string) => {
    if (used.has(word) || nextBlank === undefined) return;
    setWrong(false);
    setPlaced(p => ({ ...p, [nextBlank]: word }));
  };

  const remove = (position: number) => {
    setWrong(false);
    setPlaced(p => {
      const next = { ...p };
      delete next[position];
      return next;
    });
  };

  /**
   * DRAGGING, WITH POINTER EVENTS AND NOT HTML5 DRAG AND DROP.
   *
   * The native API does not fire on touch at all, and this screen is mostly
   * read on a phone, so it would have been a desktop-only feature dressed up
   * as an improvement. Pointer events cover mouse, touch and pen in one path.
   *
   * TAPPING STILL WORKS, and that is not a leftover. It is the keyboard and
   * screen reader route, it is what somebody does who cannot drag accurately,
   * and it is faster when the blanks are filled in order anyway. A drag is
   * anything that moves past the threshold; below it, the press is a tap and
   * the word goes to the first empty blank, exactly as before.
   */
  const [drag, setDrag] = useState<{ word: string; x: number; y: number } | null>(null);
  const [blankUnder, setBlankUnder] = useState<number | null>(null);
  /** Where the press began, to tell a drag from a tap without re-rendering. */
  const from = useRef<{ x: number; y: number; word: string } | null>(null);
  /** Set by a finished drag, so the click that follows it does nothing. */
  const droppedJustNow = useRef(false);
  const THRESHOLD = 8;

  /** The blank under a point, or nothing. Read from the DOM because the
   *  pointer is captured by the chip and no other element sees the move. */
  const blankAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-blank]');
    const value = el?.getAttribute('data-blank');
    return value === null || value === undefined ? null : Number(value);
  };

  const dropInto = (position: number, word: string) => {
    setWrong(false);
    setPlaced(p => {
      const next = { ...p };
      // Dropping on a full blank replaces it, and the word it held goes back
      // to the tray. Refusing the drop would be correct and infuriating.
      for (const [k, v] of Object.entries(next)) {
        if (v === word) delete next[Number(k)];
      }
      next[position] = word;
      return next;
    });
  };

  const onPointerDownWord = (e: React.PointerEvent<HTMLElement>, word: string) => {
    from.current = { x: e.clientX, y: e.clientY, word };
    // OPTIONAL, and not out of superstition. Pointer capture keeps the moves
    // coming when the finger leaves the chip, which is most of a drag, but it
    // is an enhancement: without it the gesture still works while the pointer
    // stays over the chip. jsdom does not implement it, so calling it
    // unconditionally threw inside the handler. Both tests still passed, and
    // the suite exited non-zero on the unhandled error, which is the worst
    // shape a failure can take.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMoveWord = (e: React.PointerEvent<HTMLElement>) => {
    const start = from.current;
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y) > THRESHOLD;
    if (!moved && !drag) return;
    setDrag({ word: start.word, x: e.clientX, y: e.clientY });
    setBlankUnder(blankAt(e.clientX, e.clientY));
  };

  const onPointerUpWord = (e: React.PointerEvent<HTMLElement>) => {
    const start = from.current;
    from.current = null;
    if (!start) return;
    const wasDragging = Boolean(drag);
    const target = blankAt(e.clientX, e.clientY);
    setDrag(null);
    setBlankUnder(null);
    if (!wasDragging) return; // A press, not a drag: the click handler has it.
    if (target !== null) dropInto(target, start.word);
    // A drag ends with a click on the chip it started from, and that click
    // would place the word a second time, in the wrong blank. This is the flag
    // the click reads to stand down.
    droppedJustNow.current = true;
  };

  const check = () => {
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
          const isBlank = asked.includes(i);
          const inside = placed[i];
          return (
            <li key={i} className="flex items-baseline gap-2 text-sm">
              <span className="text-on-surface-meta tabular-nums w-5 text-right">{i + 1}</span>
              {!isBlank ? (
                <span className="font-mono text-on-surface">{word}</span>
              ) : inside ? (
                <button
                  type="button"
                  data-blank={i}
                  onClick={() => remove(i)}
                  aria-label={t('new_identity.check_remove', { word: inside, position: i + 1 })}
                  className={cn(
                    'font-mono rounded-md px-2 -mx-1 cursor-pointer transition-colors',
                    blankUnder === i
                      ? 'bg-primary/30 text-on-surface'
                      : 'bg-primary/15 text-on-surface hover:bg-primary/25',
                  )}
                >
                  {inside}
                </button>
              ) : (
                <span
                  data-blank={i}
                  aria-label={t('new_identity.check_blank', { position: i + 1 })}
                  className={cn(
                    'h-5 flex-1 rounded-md border border-dashed transition-colors',
                    blankUnder === i
                      ? 'border-primary bg-primary/20'
                      : wrong ? 'border-error/50' : 'border-white/25',
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
        {tray.map(word => {
          const spent = used.has(word);
          return (
            <Button
              key={word}
              variant="default"
              disabled={spent}
              /* THE CLICK IS THE ACCESSIBLE PATH, not a leftover. Enter and
                 Space on a focused chip fire a click and no pointer event at
                 all, so routing placement through `pointerup` would leave a
                 keyboard user with a screen that does nothing. Dragging is the
                 addition; pressing is still how this works. */
              onClick={() => {
                if (droppedJustNow.current) { droppedJustNow.current = false; return; }
                place(word);
              }}
              onPointerDown={e => !spent && onPointerDownWord(e, word)}
              onPointerMove={onPointerMoveWord}
              onPointerUp={onPointerUpWord}
              onPointerCancel={() => { from.current = null; setDrag(null); setBlankUnder(null); }}
              /* `touch-none` or the browser scrolls the page instead of
                 letting the word move, which is the whole gesture. */
              className={cn(
                'rounded-full px-4 font-mono touch-none select-none',
                spent && 'opacity-40',
                drag?.word === word && 'opacity-30',
              )}
            >
              {word}
            </Button>
          );
        })}
      </div>

      {/* The word under the finger.
          THROUGH A PORTAL, and that is the whole reason it lands where the
          finger is. `position: fixed` resolves against the nearest ancestor
          with a transform, a filter or a backdrop-filter rather than against
          the viewport, and this card is translucent, so the first attempt
          drew the word a couple of hundred pixels away from the chip it came
          from. Rendered on `body` there is no such ancestor left.

          Pointer-transparent, so it never becomes the element
          `elementFromPoint` reports and swallows its own drop. Centred on the
          pointer rather than trailing it, because a chip that lags behind the
          finger reads as a dropped one. */}
      {drag && typeof document !== 'undefined' && createPortal(
        <div
          aria-hidden
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-1/2 rounded-full px-4 py-2
                     font-mono text-sm bg-primary/30 text-on-surface border border-primary/50 shadow-lg"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.word}
        </div>,
        document.body,
      )}

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
        onClick={check}
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
