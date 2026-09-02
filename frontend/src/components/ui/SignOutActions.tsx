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
 * takes the remembered wallet and display name. Neither touches the Paillier
 * tally keys, since those decrypt elections that are already on chain.
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
import { homeRouteFor } from '../../lib/activeRole';

type Target = 'voter' | 'organizer' | 'both';

export function SignOutActions({ role }: { role: 'voter' | 'organizer' }) {
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

    // Where to land depends on what is left. Sending someone to the landing
    // page while they still hold a session would read as having signed them out
    // of that one too.
    const left = target === 'voter' ? 'organizer' : target === 'organizer' ? 'voter' : null;
    const to = left && holdsBoth ? homeRouteFor(left) : '/';
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
          {t('profile.sign_out')}
        </Button>
      )}

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending && holdsBoth ? label(pending) : t('profile.sign_out_title')}
        description={pending ? t(`profile.sign_out_${pending}_desc`) : ''}
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
            {t('profile.sign_out_confirm')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
