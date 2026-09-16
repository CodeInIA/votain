/**
 * Getting an identity back from the twelve words.
 *
 * This is the path that makes the design hold on every platform. A passkey
 * recovers the identity where the authenticator can evaluate PRF, and that is
 * not everywhere: Chrome and Firefox on Windows return the secret when a
 * credential is created and refuse to evaluate it on an assertion, so a voter
 * there has no passkey route back at all. Typing the phrase always works,
 * because the identity is a pure function of it.
 *
 * The words are checked as they are typed rather than on submit. A phrase with
 * one wrong word does not fail: it derives a DIFFERENT, perfectly valid
 * identity, which enrols nowhere and matches no election the voter joined. The
 * error it would produce arrives much later and names none of this, so the
 * moment to catch it is here.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { KeyRound, AlertTriangle } from 'lucide-react';

import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Textarea } from '../../components/ui/Input';
import { SignOutActions } from '../../components/ui/SignOutActions';
import { useToast } from '../../components/ui/useToast';
import { isValidPhrase, normalizePhrase, unknownWords } from '../../lib/recoveryPhrase';
import { Modal } from '../../components/ui/Modal';
import { PasskeyStep } from '../../components/voter/PasskeyStep';
import { PasskeyCancelledError } from '../../lib/passkeyPrf';
import {
  adoptRecoveryPhrase,
  inspectIdentity,
  keepRecoveredPhraseOnDevice,
  PhraseNotRegisteredError,
  sealRecoveredPhrase,
} from '../../lib/semaphore';
import type { Identity } from '@semaphore-protocol/identity';

export default function RecoverPhrase() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  /** Set once the phrase has been accepted, which is what moves to step two. */
  const [recovered, setRecovered] = useState<Identity | null>(null);
  const [noPrf, setNoPrf] = useState(false);
  const [askingSkip, setAskingSkip] = useState(false);
  /**
   * Whether this human has ever sealed their phrase under a passkey.
   *
   * The way back to the identity step is only a way back for them. Offered to
   * everyone, it sent a voter who has never linked one (and, on Windows, may
   * never be able to) to a screen that would summon an authenticator dialog
   * with nothing behind it, and then return them here none the wiser.
   *
   * Read from the vault, which is the only place that knows: `has-passkey`
   * means at least one entry, written by an authenticator that proved it could
   * read the secret back. Anything else, including a vault we could not reach,
   * keeps the link hidden rather than promising a door that may not open.
   */
  const [hasPasskey, setHasPasskey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void inspectIdentity().then(state => {
      if (!cancelled) setHasPasskey(state === 'has-passkey');
    });
    return () => { cancelled = true; };
  }, []);

  const typed = normalizePhrase(input);
  const wordCount = typed ? typed.split(' ').length : 0;
  const unknown = useMemo(() => unknownWords(input), [input]);
  const ready = isValidPhrase(input);

  /**
   * The guard above this route guarantees the session, so the elections are
   * reachable. It was not always so: public, this screen could adopt a phrase
   * for somebody with no session and then bounce them off the guard to the
   * landing page, identity taken on and person nowhere.
   */
  const done = () => navigate('/voter/elections', { replace: true });

  /**
   * Step one: take on the identity, and nothing else.
   *
   * Where the words end up is step two now. It used to happen inside this
   * call, which meant typing the last word of a recovery phrase summoned an
   * authenticator dialog with no warning and no explanation of what it was
   * holding.
   */
  const submit = async () => {
    setBusy(true);
    try {
      const { identity } = await adoptRecoveryPhrase(input);
      setRecovered(identity);
    } catch (e) {
      // A phrase that rebuilds nobody is not a failure to recover, it is a
      // typo, and the two need different words: one sends the reader back to
      // what they typed, the other tells them to try again later.
      const wrongPhrase = e instanceof PhraseNotRegisteredError;
      toast({
        title: t(wrongPhrase ? 'recover.not_registered' : 'recover.failed'),
        description: wrongPhrase
          ? t('recover.not_registered_desc')
          : e instanceof Error ? e.message : String(e),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  /** Step two, the same one a new voter finishes on. */
  const linkPasskey = async () => {
    if (!recovered) return;
    setBusy(true);
    setNoPrf(false);
    try {
      const kept = await sealRecoveredPhrase(input, recovered);
      if (kept === 'sealed') {
        toast({ title: t('recover.restored'), variant: 'success' });
        done();
        return;
      }
      // Nothing to seal under. The words are on the device instead, and the
      // screen says so rather than calling it a success.
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

  /**
   * Step two, declined: the words stay on this device, in the clear.
   *
   * The message used to say the opposite, that nothing had been kept and a
   * reload would ask again. That was true when declining meant a cancelled
   * passkey prompt and no write at all; declining is now a choice that writes
   * the phrase here, and a toast describing the old behaviour is worse than
   * none, because it tells somebody their words are not on a device they are.
   */
  const keepOnDevice = async () => {
    await keepRecoveredPhraseOnDevice(input);
    setAskingSkip(false);
    toast({
      title: t('recover.kept_on_device'),
      description: t('recover.kept_on_device_desc'),
      variant: 'warning',
    });
    done();
  };

  return (
    /* No nav and no footer, like the identity step this screen is the other
       half of. Both are moments BETWEEN being verified and being able to vote,
       and a shell offering the elections, the profile and the history invites
       somebody to wander off with an identity that is not resolved yet.
       There is no BACK either: the step behind is World ID, which has already
       answered. Leaving means signing out, and that is offered at the bottom. */
    <PageLayout role="voter" showNav={false} showFooter={false}>
      <div className="min-h-dvh flex flex-col items-center justify-center gap-6 p-4">
        <div className="w-full max-w-lg">
          <div className="flex items-start gap-3 mb-5 mt-2">
            <KeyRound className="w-5 h-5 text-primary-dim shrink-0 mt-1" />
            <div>
              <h1 className="text-xl font-bold text-on-surface">{t('recover.title')}</h1>
              <p className="text-sm text-on-surface-variant mt-1">{t('recover.intro')}</p>
            </div>
          </div>

          {/* The way back, for somebody who came here after a dismissed prompt
              and then remembered they do have a passkey within reach. The step
              re-reads the vault, so it shows whatever is true by then. Shown only
              to a voter who actually has one: see `hasPasskey` above. */}
          {hasPasskey && (
            <p className="text-center text-xs text-on-surface-meta mb-4">
              <button
                type="button"
                onClick={() => navigate('/voter/identity')}
                className="underline underline-offset-4 hover:text-on-surface cursor-pointer"
              >
                {t('recover.have_passkey')}
              </button>
            </p>
          )}

          {recovered ? (
            /* STEP TWO, and the reason this screen has steps at all. The
               passkey used to be enrolled inside `adoptRecoveryPhrase`, so
               the last word of a phrase summoned an authenticator dialog with
               no warning. It is the same step a new voter finishes on, and
               the same component, so the two paths cannot describe it
               differently. */
            <Card className="p-5">
              <p className="text-xs text-on-surface-meta mb-3">
                {t('new_identity.step_of', { current: 2, total: 2 })}
              </p>
              <PasskeyStep
                busy={busy}
                noPrf={noPrf}
                onLink={() => void linkPasskey()}
                onSkip={() => setAskingSkip(true)}
              />
            </Card>
          ) : (
          <Card className="p-5">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={t('recover.placeholder')}
              rows={4}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />

            <p className="text-xs text-on-surface-meta mt-2">
              {t('recover.word_count', { typed: wordCount })}
            </p>

            {unknown.length > 0 && (
              <div className="flex items-start gap-2 mt-3 p-3 rounded-2xl bg-warning/10 border border-warning/20">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-on-surface-variant">
                  {t('recover.unknown_words', { words: unknown.join(', ') })}
                </p>
              </div>
            )}

            <Button
              variant="gradient"
              className="w-full rounded-full h-12 mt-4"
              disabled={!ready || busy}
              onClick={() => void submit()}
            >
              {busy ? t('recover.restoring') : t('recover.restore')}
            </Button>
          </Card>
          )}

          <p className="text-xs text-on-surface-meta mt-4 leading-relaxed text-center">
            {t('recover.help')}
          </p>

          {/* The last door, and it has to be on this page.
              Someone who has lost the words as well arrives here, from the World
              ID screen or from their own profile, and until this link existed the
              page was a dead end for exactly the person with the worst problem.
              It is quiet on purpose: re-verifying rotates the on-chain commitment
              and costs every election they had already joined, so it must not
              compete with typing the phrase, which costs nothing. */}
          <p className="text-xs text-on-surface-meta mt-6 leading-relaxed text-center">
            {t('recover.lost_phrase')}{' '}
            <Link
              to="/voter/re-verify"
              className="text-primary-dim font-semibold underline underline-offset-4 hover:text-primary"
            >
              {t('reverify.title')}
            </Link>
          </p>
        </div>

        {/* Asked before the words are left readable on this device, which is
            the outcome nobody would pick on purpose and the one a tired
            person picks by pressing the quiet link. */}
        <Modal
          open={askingSkip}
          showClose={false}
          onClose={() => setAskingSkip(false)}
          title={t('new_identity.skip_confirm_title')}
          description={t('new_identity.skip_confirm_desc')}
        >
          {/* The same two buttons the onboarding confirmation offers, in the
              same order and with the same words: linking is the answer being
              pushed, and it is second because that is where the thumb lands. */}
          <div className="flex flex-col gap-2 mt-2">
            <Button
              variant="default"
              className="w-full rounded-full h-11"
              disabled={busy}
              onClick={() => void keepOnDevice()}
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

        {/* The only way out of this screen, for somebody on the wrong device or
            without their words. Until it was here, leaving meant closing the tab
            and abandoning the session for whoever opened it next. */}
        <SignOutActions role="voter" />
      </div>
    </PageLayout>
  );
}
