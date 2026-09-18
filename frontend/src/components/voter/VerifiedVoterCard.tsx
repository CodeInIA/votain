import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Copy, Check } from 'lucide-react';
import { Card } from '../ui/Card';
import { CommitmentFingerprint } from '../ui/CommitmentFingerprint';
import { cn } from '../../lib/utils';
import { readOnDevice } from '../../lib/deviceSeal';
import { avatarSeed } from '../../lib/semaphore';

/**
 * Who this voter is to the platform, and what that number is.
 *
 * WHAT IT SHOWS. The World ID nullifier: the identifier World ID derives from
 * this human FOR THIS APPLICATION. It is the same every time they come back,
 * which is what stops one person registering twice; it is different in every
 * other application, so it does not follow them out of here; and it says
 * nothing about who they are. It is also not their voting identity, and since
 * enrolments are derived per election, no ballot and no roll can be traced back
 * to it.
 *
 * WHY IT SAYS SO. It used to be twenty characters and an ellipsis under the
 * words "verified voter", with no label and nothing to press: enough to look
 * like an identifier, not enough to be one. A voter could neither tell what it
 * was nor do anything with it.
 *
 * IT ALSO CARRIES THE PATTERN, when this device has one. A profile opens with
 * a picture of you, and the picture belongs beside the identifier it is drawn
 * from rather than three cards down next to its own switch: standing here it
 * explains where it comes from without a line of text. It is NOT the icon
 * preference and does not read it — that switch decides what the top bar wears,
 * and this is the profile showing you yourself.
 *
 * When the phrase has not been unlocked on this device there is no pattern, and
 * the card says nothing about that: it wears the shield it always wore. An
 * absent decoration is not news, and the voter who sees it is the one who has
 * just arrived without their identity and has better things to read.
 *
 * WHOLE ON A WIDE SCREEN, cut on a phone. Sixty-six monospace characters fit
 * across this card on a desktop and take three lines of a phone, so the phone
 * gets an ellipsis and a press to open it. The cut is CSS, not a `slice`: the
 * whole value is always in the page, which is what the copy button sends and
 * what a screen reader reads out, and only its display is shortened.
 */
export function VerifiedVoterCard() {
  const { t } = useTranslation();

  /**
   * Loaded rather than read during render, because it is sealed on this device
   * and opening it means asking the browser to decrypt. Null until it arrives,
   * and null forever for anybody who has never verified.
   */
  const [nullifier, setNullifier] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readOnDevice('nullifier').then(value => {
      if (!cancelled) setNullifier(value);
    });
    return () => { cancelled = true; };
  }, []);

  /**
   * Read at render rather than held: it is written outside React, by the unlock
   * that may well be what brought this screen here.
   */
  const patron = avatarSeed();

  const [showFull, setShowFull] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!nullifier) return;
    void navigator.clipboard.writeText(nullifier);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className="p-5 mb-4">
      {/* `items-center`. Pinned to the top it sat level with the title while
          three lines ran on below it, which is what read as off centre.

          NOT stretched to the card's height: `self-stretch` with `aspect-square`
          feeds back on itself here, because the square's width narrows the text
          column, the text grows taller, and the square follows it. It settled at
          302 pixels. A fixed size, centred against the block, is the stable way
          to say the same thing. */}
      <div className="flex items-center gap-4">
        {patron ? (
          <CommitmentFingerprint value={patron} className="w-14 h-14 shrink-0" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-7 h-7 text-green-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-on-surface flex items-center gap-1.5">
            {t('nav.verified_voter')}
            {/* Verified is a state, not an ornament, so it follows the words
                rather than disappearing with the disc it used to fill. */}
            {patron && <ShieldCheck className="w-4 h-4 text-green-400 shrink-0" />}
          </p>
          {nullifier && (
            <>
              <p className="text-xs text-on-surface-meta mt-1 leading-snug">
                {t('profile.nullifier_hint')}
              </p>
              <div className="flex items-start gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowFull(open => !open)}
                  aria-expanded={showFull}
                  aria-label={t('profile.nullifier_show')}
                  className={cn(
                    'min-w-0 text-left font-mono text-xs text-on-surface-variant',
                    'cursor-pointer hover:text-on-surface transition-colors',
                    // `sm:break-all` regardless: there is room for all of it on
                    // a wide screen, so nobody there has to press anything.
                    showFull ? 'break-all' : 'truncate sm:break-all',
                  )}
                >
                  {nullifier}
                </button>
                <button
                  type="button"
                  onClick={copy}
                  aria-label={t('common.copy')}
                  className="shrink-0 p-2 -m-2 text-on-surface-meta hover:text-on-surface transition-colors cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
