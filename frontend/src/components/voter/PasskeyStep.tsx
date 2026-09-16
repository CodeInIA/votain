import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

interface Props {
  /** A passkey enrolment is in flight. */
  busy: boolean;
  /** The authenticator could not do PRF, so there is nothing to seal under. */
  noPrf: boolean;
  onLink: () => void;
  /** Opens the caller's confirmation, rather than skipping outright. */
  onSkip: () => void;
}

/**
 * "Link a passkey", the last thing asked of a voter before they are set up.
 *
 * SHARED BY THE TWO WAYS OF GETTING AN IDENTITY, which is the point. A new
 * voter mints a phrase and is asked this; a returning voter types their phrase
 * and, until now, was not asked at all: `adoptRecoveryPhrase` summoned the
 * authenticator itself, so finishing the last word produced a dialog with no
 * warning and no explanation of what it was for. Recovery ends on this step
 * now, so both paths end the same way and say the same thing.
 *
 * WHY THE PASSKEY IS THE PRIMARY ACTION and skipping is quiet: optional
 * security gets skipped, and a voter without one keeps their phrase on the
 * device in the clear, which is strictly worse. Skipping must still exist,
 * because Windows Hello genuinely cannot do this and somebody there has to be
 * able to vote.
 */
export function PasskeyStep({ busy, noPrf, onLink, onSkip }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-primary-dim shrink-0 mt-0.5" strokeWidth={1.5} />
        <div className="min-w-0">
          <h2 className="text-base font-bold text-on-surface">
            {t('new_identity.passkey_title')}
          </h2>
          <p className="text-sm text-on-surface-variant leading-relaxed mt-1">
            {t('new_identity.passkey_desc')}
          </p>
        </div>
      </div>

      {noPrf && (
        <div className="flex items-start gap-3 p-3 mt-4 rounded-2xl bg-warning/10 border border-warning/20">
          <ShieldAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-warning">
              {t('new_identity.no_prf_title')}
            </p>
            <p className="text-xs text-on-surface-meta leading-relaxed mt-0.5">
              {t('new_identity.no_prf_desc')}
            </p>
          </div>
        </div>
      )}

      <Button
        variant="gradient"
        size="lg"
        className="w-full rounded-full h-12 mt-5 gap-2"
        disabled={busy}
        onClick={onLink}
      >
        {busy && <Spinner className="w-4 h-4" />}
        {t(busy ? 'new_identity.passkey_working' : 'new_identity.passkey_action')}
      </Button>

      {/* Quiet and second, on purpose: see the note above. It must exist, and
          it must not compete. */}
      <button
        type="button"
        disabled={busy}
        onClick={onSkip}
        className="w-full mt-4 text-xs text-on-surface-meta underline underline-offset-4 hover:text-on-surface cursor-pointer disabled:opacity-50"
      >
        {t('new_identity.skip')}
      </button>
      <p className="text-[11px] text-on-surface-meta leading-relaxed mt-1 text-center">
        {t('new_identity.skip_desc')}
      </p>
    </>
  );
}
