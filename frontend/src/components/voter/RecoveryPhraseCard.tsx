/**
 * The voter's recovery phrase, on demand.
 *
 * Without this there was no second chance to read the words. They are shown
 * once, at enrolment, in a modal that cannot be dismissed without confirming,
 * and anyone who confirmed too quickly had no way back to them: not a lost
 * phrase yet, but a phrase nobody could check they had copied correctly, which
 * becomes the same thing on the day it is needed.
 *
 * Hidden until asked for, and never rendered into the page before then, so a
 * profile left open on a screen does not display somebody's voting secret. On a
 * device where the phrase lives in the vault this costs an authenticator
 * prompt, which is the right price for reading it out.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Copy, Check, KeyRound, AlertTriangle } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/useToast';
import { revealRecoveryPhrase } from '../../lib/semaphore';
import { roleAccent } from '../../lib/activeRole';
import { cn } from '../../lib/utils';

export function RecoveryPhraseCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reveal = async () => {
    setBusy(true);
    try {
      const words = await revealRecoveryPhrase();
      if (!words) {
        toast({
          title: t('recovery.unavailable'),
          description: t('recovery.unavailable_help'),
          variant: 'warning',
        });
        return;
      }
      setPhrase(words);
    } catch (error: unknown) {
      toast({
        title: t('recovery.unavailable'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!phrase) return;
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A clipboard the browser refuses is not worth an error: the words are on
      // screen and can be written down, which is the better habit anyway.
      toast({ title: t('recovery.copy_failed'), variant: 'warning' });
    }
  };

  return (
    <Card className="p-5 mb-4">
      <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2 mb-1">
        {/* The voter's accent, not the organizer's: this card sat in the voter
            profile wearing #4F8EF7, which is the other role's colour. */}
        <KeyRound className={cn('w-4 h-4 shrink-0', roleAccent('voter'))} />
        {t('recovery.show_title')}
      </h2>
      <p className="text-xs text-on-surface-meta leading-relaxed mb-4">
        {t('recovery.show_desc')}
      </p>

      {phrase ? (
        <>
          <p className="font-mono text-sm text-on-surface leading-relaxed wrap-break-word rounded-2xl bg-surface-high/40 p-4 select-all">
            {phrase}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <Button variant="default" className="rounded-full gap-2 flex-1" onClick={() => void copy()}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? t('recovery.copied') : t('recovery.copy')}
            </Button>
            <Button variant="ghost" className="rounded-full gap-2 flex-1" onClick={() => setPhrase(null)}>
              <EyeOff className="w-4 h-4" />
              {t('recovery.hide')}
            </Button>
          </div>
          <div className="flex items-start gap-2 mt-3 p-3 rounded-2xl bg-warning/10 border border-warning/20">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-on-surface-variant">{t('recovery.warning')}</p>
          </div>
        </>
      ) : (
        <Button
          variant="default"
          className="rounded-full gap-2"
          disabled={busy}
          onClick={() => void reveal()}
        >
          {busy ? <Spinner className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {busy ? t('recovery.revealing') : t('recovery.reveal')}
        </Button>
      )}
    </Card>
  );
}
