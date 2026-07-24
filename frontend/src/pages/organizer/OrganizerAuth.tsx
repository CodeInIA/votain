import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { KeyRound, Wallet, ChevronRight, ChevronLeft, AlertTriangle } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { Stepper } from '../../components/ui/Stepper';
import { useToast } from '../../components/ui/useToast';
import { useAuth } from '../../contexts/AuthContext';
import { useOrganizerWallet, getRememberedOrganizerAddress } from '../../hooks/useOrganizerWallet';
import { authenticatePasskey } from '../../lib/passkeyPrf';

export default function OrganizerAuth() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { setOrganizerLoggedIn } = useAuth();
  const wallet = useOrganizerWallet();
  const [step, setStep] = useState(0);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [busy, setBusy] = useState(false);

  const STEPS = [
    { label: t('org_auth.step_passkey') },
    { label: t('org_auth.step_wallet') },
  ];

  const fail = (e: unknown) =>
    toast({
      title: t('errors.generic_title'),
      description: e instanceof Error ? e.message : String(e),
      variant: 'error',
    });

  /**
   * Step 1 — real WebAuthn passkey. Registers one on first use, asserts it
   * afterwards. Authentication NEVER falls back to a simulated pass: if the
   * authenticator is unavailable or the user cancels, the step does not advance.
   *
   * Returning organizers sign in with the passkey ALONE: the wallet they linked
   * on first login is remembered, and is only summoned again when a transaction
   * actually needs signing. That is the whole point of a passkey.
   */
  const handlePasskey = async () => {
    setBusy(true);
    try {
      await authenticatePasskey();
      if (getRememberedOrganizerAddress()) {
        finishLogin();       // returning organizer — no wallet prompt needed
        return;
      }
      setStep(1);            // first time on this device — link a wallet
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const finishLogin = () => {
    setOrganizerLoggedIn(true);
    navigate('/organizer/dashboard');
  };

  /**
   * Step 2 — real wallet connection. Independent of whether contracts are
   * deployed: an EOA is required to sign anything as an organizer.
   */
  const handleWallet = async () => {
    if (!wallet.hasWallet) {
      toast({
        title: t('org_auth.no_wallet_title'),
        description: t('org_auth.no_wallet_desc'),
        variant: 'error',
      });
      return;
    }
    setBusy(true);
    try {
      const address = await wallet.connect();
      if (!address) return; // user rejected — stay on this step
      if (await wallet.isWrongNetwork()) {
        setWrongNetwork(true);
        return;
      }
      finishLogin();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchNetwork = async () => {
    setBusy(true);
    try {
      await wallet.switchToAmoy();
      if (await wallet.isWrongNetwork()) {
        toast({ title: t('org_auth.wrong_network'), variant: 'error' });
        return;
      }
      setWrongNetwork(false);
      finishLogin();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageLayout role="public" showNav={false} showFooter={false}>
      <div className="relative min-h-dvh flex flex-col items-center justify-center p-4">
        <Button
          onClick={() => navigate(-1)}
          variant="ghost"
          className="absolute top-4 left-4 sm:top-6 sm:left-6 z-50 w-12 h-12 p-0 flex items-center justify-center rounded-full bg-surface-low/30 hover:bg-surface-low/50 backdrop-blur-xl border border-white/5 text-white shadow-lg"
          aria-label={t('common.back')}
        >
          <ChevronLeft className="w-6 h-6" />
        </Button>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm bg-surface-low/30 backdrop-blur-3xl rounded-4xl p-8 border border-white/5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]"
        >
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <KeyRound className="w-8 h-8 text-primary" strokeWidth={1.5} />
            </div>
            <h1 className="text-xl font-bold text-white">{t('org_auth.title')}</h1>
            <p className="text-sm text-on-surface-variant mt-1">{t('org_auth.subtitle')}</p>
          </div>

          <Stepper steps={STEPS} current={step} className="mb-8" />

          {step === 0 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-on-surface-variant text-center">{t('org_auth.passkey_desc')}</p>
              <Button variant="gradient" size="lg" className="w-full rounded-full h-14 gap-2" disabled={busy} onClick={handlePasskey}>
                <KeyRound className="w-5 h-5" />
                {t('org_auth.create_passkey')}
              </Button>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              {wrongNetwork && (
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-warning/10 border border-warning/20">
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-warning">{t('org_auth.wrong_network')}</p>
                    <p className="text-xs text-on-surface-meta mt-0.5">{t('org_auth.wrong_network_desc')}</p>
                  </div>
                </div>
              )}
              <p className="text-sm text-on-surface-variant text-center">{t('org_auth.wallet_desc')}</p>
              {wrongNetwork ? (
                <Button variant="gradient" size="lg" className="w-full rounded-full h-14 gap-2" disabled={busy} onClick={handleSwitchNetwork}>
                  {t('org_auth.switch_network')}
                  <ChevronRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button variant="default" size="lg" className="w-full rounded-full h-14 gap-2 border-white/10" disabled={busy} onClick={handleWallet}>
                  <Wallet className="w-5 h-5" />
                  {t('org_auth.connect_wallet')}
                </Button>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </PageLayout>
  );
}
