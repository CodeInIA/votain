/**
 * The twelve words, and the gate that makes somebody deal with them.
 *
 * Shared by the two places a phrase is ever minted: a voter setting up for the
 * first time, and one recovering after losing every passkey. Both hand out the
 * only thing that rebuilds an identity, so both owe the same moment, and having
 * it in one component is what stops the second one quietly drifting into a
 * weaker version of the first.
 *
 * The confirm button stays disabled until the words have been copied or
 * downloaded. That is deliberate friction, not a formality: this is the only
 * thing that recovers the identity on another device, and somewhere without a
 * working passkey it is the only thing that recovers it at all.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download, KeyRound } from 'lucide-react';

import { Button } from '../ui/Button';

export function PhraseCard({
  phrase,
  onConfirm,
  confirmLabel,
}: {
  phrase: string;
  onConfirm: () => void;
  /** i18n key for the enabled button. The disabled one always says the same. */
  confirmLabel: string;
}) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const words = phrase.split(' ');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard still lets them read the words off
      // the screen, so this is not a failure worth interrupting anyone for.
    }
    setSaved(true);
  };

  const download = () => {
    const blob = new Blob([phrase + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'votain-recovery-phrase.txt';
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  return (
    <>
      <div className="flex items-start gap-3">
        <KeyRound className="w-5 h-5 text-primary-dim shrink-0 mt-0.5" strokeWidth={1.5} />
        <div className="min-w-0">
          <h2 className="text-base font-bold text-on-surface">{t('recovery.title')}</h2>
          <p className="text-sm text-on-surface-variant leading-relaxed mt-1">
            {t('recovery.intro')}
          </p>
        </div>
      </div>

      <ol className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 mt-4 rounded-2xl bg-white/5 border border-white/10">
        {words.map((word, i) => (
          <li key={i} className="flex items-baseline gap-2 text-sm">
            <span className="text-on-surface-meta tabular-nums w-5 text-right">{i + 1}</span>
            <span className="font-mono text-on-surface">{word}</span>
          </li>
        ))}
      </ol>

      <div className="flex gap-2 mt-4">
        <Button variant="default" className="flex-1 gap-2 rounded-full" onClick={() => void copy()}>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {t(copied ? 'recovery.copied' : 'recovery.copy')}
        </Button>
        <Button variant="default" className="flex-1 gap-2 rounded-full" onClick={download}>
          <Download className="w-4 h-4" />
          {t('recovery.download')}
        </Button>
      </div>

      <p className="text-xs text-on-surface-meta leading-relaxed mt-4">{t('recovery.warning')}</p>

      <Button
        variant="gradient"
        size="lg"
        className="w-full rounded-full h-12 mt-5"
        disabled={!saved}
        onClick={onConfirm}
      >
        {t(saved ? confirmLabel : 'recovery.save_first')}
      </Button>
    </>
  );
}
