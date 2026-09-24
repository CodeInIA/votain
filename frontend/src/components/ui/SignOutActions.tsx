/**
 * Ending one session, or both.
 *
 * With a single session this is the button it always was. Once a person holds
 * both, "sign out" stops having one meaning: an organizer who is also a voter
 * and wants to hand the laptop over is asking a different question from one who
 * has simply finished organizing. Each role gets its own exit, and the joint one
 * stays for the case where the answer really is everything.
 *
 * Each exit clears its OWN browser data and leaves the other session untouched,
 * which is the whole reason the two are separable: `voterSignOut` takes the
 * voting identity and this device's vote records with it, `organizerSignOut`
 * takes the remembered wallet and display name. Neither touches the stored
 * tally keys, since those count elections that are already on chain.
 *
 * Shared by both profiles so the wording and the confirmation cannot drift, and
 * so neither page has to work out where to send someone whose other session is
 * still live.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';
import { useToast } from './useToast';
import { useAuth } from '../../contexts/AuthContext';
import { homeRouteFor, noteSignedOutOf, signInRouteFor } from '../../lib/activeRole';

type Target = 'voter' | 'organizer' | 'both';

export function SignOutActions({
  role,
  /**
   * There is no session to end yet, only an attempt to abandon.
   *
   * On the setup screen NOTHING has been registered: the commitment reaches
   * PlatformRegistry when the flow finishes, so calling this "sign out" named
   * something that had not happened and implied losing a standing the voter
   * does not have. What it really does there is throw away a phrase minted on
   * this device and end the World ID session, which is cancelling a sign-up.
   *
   * The work is identical either way; only the words change, and the words are
   * what somebody decides on.
   */
  incomplete = false,
}: {
  role: 'voter' | 'organizer';
  incomplete?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { voterLoggedIn, organizerLoggedIn, voterSignOut, organizerSignOut } = useAuth();
  const [pending, setPending] = useState<Target | null>(null);

  const holdsBoth = voterLoggedIn && organizerLoggedIn;

  const run = (target: Target) => {
    if (target !== 'organizer') voterSignOut();
    if (target !== 'voter') organizerSignOut();
    setPending(null);
    toast({ title: t('profile.signed_out'), variant: 'info' });

    // Where to land depends on what is left. Someone who still holds the other
    // session goes to ITS home, since sending them to a sign-in screen would
    // read as having signed them out of that one too. Someone with nothing left
    // goes to the sign-in screen of the role they just closed.
    const left = target === 'voter' ? 'organizer' : target === 'organizer' ? 'voter' : null;
    const keepsOther = Boolean(left) && holdsBoth;
    const closed = target === 'both' ? 'voter' : target;

    // The guard will redirect first and this screen will unmount with the
    // navigation below still pending, so the intent is left where the guard
    // reads it. The navigate stays for the case where nothing guards this
    // screen, and both agree on the destination either way.
    if (!keepsOther) noteSignedOutOf(closed);

    const to = keepsOther ? homeRouteFor(left!) : signInRouteFor(closed);
    setTimeout(() => navigate(to, { replace: true }), 500);
  };

  const label = (target: Target) =>
    target === 'both' ? t('profile.sign_out_both') : t(`profile.sign_out_${target}`);

  return (
    <div className="flex flex-col gap-2">
      {holdsBoth ? (
        <>
          {/* The role being left is named on the button, because with two
              sessions open the icon alone cannot say which one this ends. */}
          <Button
            variant="default"
            className="w-full rounded-2xl gap-2"
            onClick={() => setPending('voter')}
          >
            <LogOut className="w-4 h-4" />
            {label('voter')}
          </Button>
          <Button
            variant="default"
            className="w-full rounded-2xl gap-2"
            onClick={() => setPending('organizer')}
          >
            <LogOut className="w-4 h-4" />
            {label('organizer')}
          </Button>
          <Button
            variant="default"
            className="w-full rounded-2xl gap-2 border-error/30 text-error hover:bg-error/10"
            onClick={() => setPending('both')}
          >
            <LogOut className="w-4 h-4" />
            {label('both')}
          </Button>
        </>
      ) : (
        <Button
          variant="default"
          className="w-full rounded-2xl gap-2 border-error/30 text-error hover:bg-error/10"
          onClick={() => setPending(role)}
        >
          <LogOut className="w-4 h-4" />
          {t(incomplete ? 'profile.cancel_signup' : 'profile.sign_out')}
        </Button>
      )}

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={
          incomplete
            ? t('profile.cancel_signup_title')
            : pending && holdsBoth
              ? label(pending)
              : t('profile.sign_out_title')
        }
        /* The title was already conditioned on holding both and the description
           was not, so a voter who has never organized anything was told their
           "organizer session is untouched": a sentence about something they do
           not have. The single-session wording also says the part that actually
           costs something, which the old one left out entirely: `clearIdentity`
           removes the recovery phrase from this browser. */
        description={
          incomplete
            ? t('profile.cancel_signup_desc')
            : pending
            ? holdsBoth
              ? t(`profile.sign_out_${pending}_desc`)
              : t(`profile.sign_out_${pending === 'both' ? 'voter' : pending}_only_desc`)
            : ''
        }
      >
        <div className="flex gap-3 mt-2">
          <Button variant="ghost" className="flex-1" onClick={() => setPending(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="default"
            className="flex-1 border-error/30 text-error hover:bg-error/10"
            onClick={() => pending && run(pending)}
          >
            {t(incomplete ? 'profile.cancel_signup' : 'profile.sign_out_confirm')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
