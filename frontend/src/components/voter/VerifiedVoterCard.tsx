import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Copy, Check } from 'lucide-react';
import { Card } from '../ui/Card';
import { cn } from '../../lib/utils';
import { readOnDevice } from '../../lib/deviceSeal';

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
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-6 h-6 text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-on-surface">{t('nav.verified_voter')}</p>
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
