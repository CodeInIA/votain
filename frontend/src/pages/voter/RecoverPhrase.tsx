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
import { adoptRecoveryPhrase, inspectIdentity } from '../../lib/semaphore';

export default function RecoverPhrase() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
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

  const submit = async () => {
    setBusy(true);
    try {
      const { kept } = await adoptRecoveryPhrase(input);
      // Declining the passkey is an answer, and the screen has to say what it
      // cost: nothing was written here, so the next visit starts from the words
      // again. Announcing that as a plain success is how somebody ends up
      // surprised on the device they were being careful about.
      if (kept === "session") {
        toast({
          title: t('recover.restored_session'),
          description: t('recover.restored_session_desc'),
          variant: 'warning',
        });
      } else {
        toast({ title: t('recover.restored'), variant: 'success' });
      }
      // The guard above this route guarantees the session, so the elections
      // are reachable. It was not always so: public, this screen could adopt a
      // phrase for somebody with no session and then bounce them off the guard
      // to the landing page, identity taken on and person nowhere.
      navigate('/voter/elections', { replace: true });
    } catch (e) {
      toast({
        title: t('recover.failed'),
        description: e instanceof Error ? e.message : String(e),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
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

        {/* The only way out of this screen, for somebody on the wrong device or
            without their words. Until it was here, leaving meant closing the tab
            and abandoning the session for whoever opened it next. */}
        <SignOutActions role="voter" />
      </div>
    </PageLayout>
  );
}
