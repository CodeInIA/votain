/**
 * Setting up a voter who is not in the registry yet, in two steps.
 *
 * WHY A SCREEN AND NOT A MODAL. The phrase used to be minted deep inside
 * `getOrCreateIdentity` and published to a modal mounted near the router, which
 * held it in a module variable and rendered it once. One reload at the wrong
 * instant (a phone evicting a backgrounded tab during a WebAuthn ceremony that
 * goes out to a QR code and another device, a dev server restarting) and the
 * only moment a voter ever sees their words was skipped in silence, with the
 * local copy already removed by the seal. It happened in testing and nothing in
 * the logs said so.
 *
 * WHY THE PHRASE COMES FIRST. The identity is a pure function of the twelve
 * words; the passkey only holds an encrypted copy of them. Asking for a
 * fingerprint before showing the words had the voter approving a dialog with no
 * idea what it was holding, and printed their only way back afterwards, as a
 * receipt for something already done to them.
 *
 * WHY THE PASSKEY IS STILL THE PRIMARY ACTION. Optional security gets skipped.
 * A voter with no passkey keeps their phrase on this device in the clear, which
 * is strictly worse, so step two leads with linking one and keeps "continue
 * without" quiet and deliberate. It has to exist all the same: Windows Hello
 * genuinely cannot do this, and somebody there must still be able to vote.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

import { PhraseCard } from './PhraseCard';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/useToast';
import { PasskeyCancelledError } from '../../lib/passkeyPrf';
import {
  beginNewIdentity,
  completeWithPasskey,
  completeWithoutPasskey,
} from '../../lib/semaphore';
import type { Identity } from '@semaphore-protocol/identity';

type Step = 'phrase' | 'passkey';

export function NewVoterSetup({
  onDone,
  /**
   * An identity that already exists, for recovery.
   *
   * Rotating gives a voter a brand new phrase and leaves them in exactly the
   * state a first-time voter is in: registered, no passkey, words that have to
   * be written down. That is the same two steps, so it is the same component
   * rather than a second screen free to drift into a weaker version of this
   * one. Passed in because the rotation minted it: calling `beginNewIdentity`
   * again would be harmless (it reuses what is stored) but it would hide where
   * the identity came from.
   */
  minted,
}: {
  onDone: () => void;
  minted?: { phrase: string; identity: Identity };
}) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [own, setOwn] = useState<{ phrase: string; identity: Identity } | null>(minted ?? null);
  const [step, setStep] = useState<Step>('phrase');
  const [asking, setAsking] = useState(false);
  /**
   * Asked before the phrase is left as the only copy.
   *
   * The link is one tap under a big button somebody may be trying to get past,
   * and what it does is not undoable by accident: from then on the words sit on
   * this device in the clear and are the whole identity. The confirmation also
   * carries the half that makes the choice reasonable, which the link alone
   * could not say: the door stays open from the profile.
   */
  const [askingSkip, setAskingSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * The authenticator made a credential and cannot use it to decrypt.
   *
   * Its own state rather than a toast: it is not a transient message but the
   * reason the screen now looks different, and it has to survive long enough
   * for somebody to read that their phone is worth trying.
   */
  const [noPrf, setNoPrf] = useState(false);

  useEffect(() => {
    if (minted) return;
    let cancelled = false;
    void beginNewIdentity().then(m => { if (!cancelled) setOwn(m); });
    return () => { cancelled = true; };
  }, [minted]);

  if (!own) return <Spinner />;

  const withPasskey = async () => {
    setBusy(true);
    setNoPrf(false);
    try {
      const result = await completeWithPasskey(own.phrase, own.identity);
      if (result.kept === 'sealed') {
        toast({ title: t('new_identity.sealed'), variant: 'success' });
        onDone();
        return;
      }
      // Registered either way, so nothing is lost: what is missing is the
      // encrypted copy, and the screen says which of the two happened.
      if (result.vaultWriteFailed) {
        toast({
          title: t('recovery.unregistered_title'),
          description: t('recovery.unregistered_desc'),
          variant: 'warning',
        });
        onDone();
        return;
      }
      setNoPrf(true);
    } catch (error: unknown) {
      // Dismissing the prompt is a decision, not a limit. Nothing was kept and
      // they stay here, because the retry is the whole point of saying so.
      if (error instanceof PasskeyCancelledError) {
        toast({ title: t('errors.passkey_cancelled'), variant: 'info' });
        return;
      }
      console.error('Could not link a passkey:', error);
      toast({
        title: t('errors.generic_title'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const withoutPasskey = async () => {
    setBusy(true);
    try {
      await completeWithoutPasskey(own.phrase, own.identity);
      onDone();
    } catch (error: unknown) {
      console.error('Could not register without a passkey:', error);
      toast({
        title: t('errors.generic_title'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="p-6 w-full max-w-md">
        <p className="text-xs text-on-surface-meta mb-3">
          {t('new_identity.step_of', { current: step === 'phrase' ? 1 : 2, total: 2 })}
        </p>

        {step === 'phrase' ? (
          <PhraseCard
            phrase={own.phrase}
            confirmLabel="new_identity.continue"
            onConfirm={() => setAsking(true)}
          />
        ) : (
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
              onClick={() => void withPasskey()}
            >
              {busy && <Spinner className="w-4 h-4" />}
              {t(busy ? 'new_identity.passkey_working' : 'new_identity.passkey_action')}
            </Button>

            {/* Quiet and second, on purpose: see the note at the top of this
                file. It must exist, and it must not compete. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => setAskingSkip(true)}
              className="w-full mt-4 text-xs text-on-surface-meta underline underline-offset-4 hover:text-on-surface cursor-pointer disabled:opacity-50"
            >
              {t('new_identity.skip')}
            </button>
            <p className="text-[11px] text-on-surface-meta leading-relaxed mt-1 text-center">
              {t('new_identity.skip_desc')}
            </p>
          </>
        )}
      </Card>

      <Modal
        open={askingSkip}
        showClose={false}
        onClose={() => setAskingSkip(false)}
        title={t('new_identity.skip_confirm_title')}
        description={t('new_identity.skip_confirm_desc')}
      >
        <div className="flex flex-col gap-2 mt-2">
          <Button
            variant="default"
            className="w-full rounded-full h-11"
            disabled={busy}
            onClick={() => { setAskingSkip(false); void withoutPasskey(); }}
          >
            {t('new_identity.skip')}
          </Button>
          <Button
            variant="gradient"
            className="w-full rounded-full h-11"
            onClick={() => setAskingSkip(false)}
          >
            {t('new_identity.passkey_action')}
          </Button>
        </div>
      </Modal>

      {/* The gate between the two steps. Copying is a gesture people make
          without reading; being asked in words is the moment somebody realises
          they pressed copy and never pasted it anywhere. */}
      <Modal open={asking} showClose={false} onClose={() => setAsking(false)}>
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-semibold text-on-surface">
                {t('new_identity.confirm_title')}
              </h2>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                {t('new_identity.confirm_desc')}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              variant="gradient"
              className="w-full rounded-full h-11"
              onClick={() => { setAsking(false); setStep('passkey'); }}
            >
              {t('new_identity.confirm_yes')}
            </Button>
            <Button
              variant="ghost"
              className="w-full rounded-full h-11"
              onClick={() => setAsking(false)}
            >
              {t('new_identity.confirm_no')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
