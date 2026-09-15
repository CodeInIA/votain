/**
 * What happens to the voting identity, explained before anything asks for it.
 *
 * This step exists because the authenticator dialog used to appear as a side
 * effect of signing in: World ID answered, and a fingerprint prompt arrived on
 * top of a flow the voter thought had just finished, with nothing said about
 * what it was for. Dismissing it was then a fright rather than a decision, and
 * what it cost them was never explained either.
 *
 * The state is decided by reading the vault, which prompts nobody, so each case
 * can be named honestly before a button is pressed. See `inspectIdentity`.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, ShieldCheck, Sparkles } from 'lucide-react';

import type { IdentityState } from '../../lib/semaphore';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';

const ICONS: Record<IdentityState, typeof KeyRound> = {
  'has-passkey': ShieldCheck,
  'phrase-only': KeyRound,
  new: Sparkles,
  unknown: KeyRound,
};

/** The i18n key stem for each state, since keys cannot carry a hyphen here. */
const KEYS: Record<IdentityState, string> = {
  'has-passkey': 'has_passkey',
  'phrase-only': 'phrase_only',
  new: 'new',
  unknown: 'unknown',
};

export function IdentityStepCard({
  state,
  onContinue,
}: {
  state: IdentityState;
  onContinue: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const Icon = ICONS[state];
  const key = KEYS[state];

  const go = async () => {
    setBusy(true);
    try {
      await onContinue();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6 w-full max-w-sm">
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 text-primary-dim shrink-0 mt-0.5" strokeWidth={1.5} />
        <div className="min-w-0">
          <h2 className="text-base font-bold text-on-surface">
            {t(`identity_step.${key}_title`)}
          </h2>
          <p className="text-sm text-on-surface-variant leading-relaxed mt-1">
            {t(`identity_step.${key}_desc`)}
          </p>
        </div>
      </div>

      <Button
        variant="gradient"
        size="lg"
        className="w-full rounded-full h-12 mt-5 gap-2"
        disabled={busy}
        onClick={() => void go()}
      >
        {busy && <Spinner className="w-4 h-4" />}
        {t(`identity_step.${key}_action`)}
      </Button>
    </Card>
  );
}
