/**
 * The identity step, on its own guarded route.
 *
 * Reached only after World ID has answered, which is what authorises reading
 * the vault at all. Behind the voter guard for the same reason `/voter/recover`
 * is: without a session there is nothing here to inspect and nothing to attach
 * an identity to.
 *
 * A separate screen rather than a state inside the verification, because the
 * two are separate questions. World ID asks who the human is; this asks what
 * happens to the anonymous identity they vote with, and it says so before
 * anything summons an authenticator.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { IdentityStepCard } from '../../components/voter/IdentityStep';
import { NewVoterSetup } from '../../components/voter/NewVoterSetup';
import { PageLayout } from '../../components/layout/PageLayout';
import { SignOutActions } from '../../components/ui/SignOutActions';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/useToast';
import { PasskeyCancelledError } from '../../lib/passkeyPrf';
import {
  getOrCreateIdentity,
  IdentityLockedError,
  IdentityNotSetUpError,
  inspectIdentity,
  isIdentityLoaded,
  type IdentityState,
} from '../../lib/semaphore';

export default function IdentityStepPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<IdentityState | null>(null);
  /**
   * Run the first-time setup rather than the one-button card.
   *
   * Two ways in, and they are not redundant. `inspectIdentity` naming this a
   * new voter is the ordinary one; the other is a `getOrCreateIdentity` that
   * got as far as looking and found nothing to resolve, which happens when the
   * vault could not be read at inspection time and the state was `unknown`.
   * Both mean the same thing to the person: there is nothing to unlock yet.
   */
  const [setUp, setSetUp] = useState(false);

  useEffect(() => {
    // Already resolved this session: nothing to ask, nothing to explain.
    if (isIdentityLoaded()) {
      navigate('/voter/elections', { replace: true });
      return;
    }
    let cancelled = false;
    void inspectIdentity().then(s => {
      if (cancelled) return;
      setState(s);
      if (s === 'new') setSetUp(true);
    });
    return () => { cancelled = true; };
  }, [navigate]);

  const go = async () => {
    // Nothing here can open it, and the vault already said so: asking would
    // spend a fingerprint to be told what we know.
    if (state === 'phrase-only') {
      navigate('/voter/recover', { replace: true });
      return;
    }
    try {
      await getOrCreateIdentity();
      navigate('/voter/elections', { replace: true });
    } catch (error: unknown) {
      // Verified, and this device cannot open the identity World ID just proved
      // belongs to this human. Not a failure: the session is real, so they go to
      // the one screen that can finish the job.
      // Two ways not to get in, and they are not the same. A dismissed prompt
      // is a decision and nothing was created; a locked identity means this
      // device holds no key that opens what already exists. Both stay here,
      // and only one of them needs saying out loud.
      if (error instanceof PasskeyCancelledError) {
        toast({ title: t('errors.passkey_cancelled'), variant: 'info' });
        return;
      }
      // Nothing to say that the screen is not already saying: the way out for
      // somebody who cannot reach their passkey is below, and was before they
      // pressed anything.
      if (error instanceof IdentityLockedError) return;
      // Nothing to resolve: this human has never set an identity up. Nothing
      // mints one behind their back any more, so the answer is to run the setup.
      if (error instanceof IdentityNotSetUpError) {
        setSetUp(true);
        return;
      }
      console.error('Could not resolve the identity:', error);
      toast({
        title: t('errors.generic_title'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'error',
      });
    }
  };

  return (
    <PageLayout role="voter" showNav={false} showFooter={false}>
      <div className="min-h-dvh flex flex-col items-center justify-center gap-6 p-4">
        {setUp
          ? <NewVoterSetup onDone={() => navigate('/voter/elections', { replace: true })} />
          : state ? <IdentityStepCard state={state} onContinue={go} /> : <Spinner />}

        {/* VISIBLE FROM THE START, and it used to appear only after an attempt
            had failed. Somebody sitting at a computer that has never held their
            passkey already knows it; making them summon an authenticator dialog
            and dismiss it, just to be told there is another way, is a toll for
            information they arrived with.
            Quiet and second all the same: the passkey is still the way in for
            anybody who has one.
            Not shown for `phrase-only`, where the card's own button already
            goes here and a second link to the same place would only make the
            screen look like it offered two different things. */}
        {!setUp && state !== null && state !== 'new' && state !== 'phrase-only' && (
          <button
            type="button"
            onClick={() => navigate('/voter/recover')}
            className="text-xs text-on-surface-meta underline underline-offset-4 hover:text-on-surface cursor-pointer"
          >
            {t('identity_step.no_passkey_access')}
          </button>
        )}

        {/* The way out, and there has to be one. There is no BACK from here:
            the step behind is World ID, which has already answered, so an arrow
            would only offer to verify again. Somebody on the wrong device who
            has lost their words needs to LEAVE, and until this was here the
            only way to do that was closing the tab, which left the session
            behind for whoever opened it next. */}
        {(state || setUp) && <SignOutActions role="voter" incomplete={setUp} />}
      </div>
    </PageLayout>
  );
}
