import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { KeyRound, Wallet, ChevronRight, ChevronLeft, AlertTriangle, UserPlus } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { Stepper } from '../../components/ui/Stepper';
import { useToast } from '../../components/ui/useToast';
import { useAuth } from '../../contexts/AuthContext';
import { useOrganizerWallet, getRememberedOrganizerAddress } from '../../hooks/useOrganizerWallet';
import {
  authenticatePasskey,
  hasPlatformAuthenticator,
  hasPrfCredential,
  NoPasskeyFoundError,
  type PasskeyIntent,
} from '../../lib/passkeyPrf';

/** A phone or tablet, where a wallet extension cannot exist. */
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export default function OrganizerAuth() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { setOrganizerLoggedIn } = useAuth();
  const wallet = useOrganizerWallet();
  const [step, setStep] = useState(0);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [busy, setBusy] = useState(false);
  // null while we ask the browser; the check is async and must not block render.
  const [platformAuth, setPlatformAuth] = useState<boolean | null>(null);
  // Set when the authenticator offered nothing, which turns the create path
  // from an alternative into the answer.
  const [nothingOffered, setNothingOffered] = useState(false);

  /**
   * What this browser already knows, read once so the screen cannot change
   * shape under the person mid-flow.
   *
   * Both are per-browser caches, not accounts. A returning organizer on a
   * second machine has neither, and gets the same screen a new one does, minus
   * the assumption that they are new.
   */
  const [known] = useState(() => ({
    passkey: hasPrfCredential(),
    wallet: Boolean(getRememberedOrganizerAddress()),
  }));

  // Two steps only when a wallet still has to be linked. It always showed two,
  // so a returning organizer watched a progress bar for a step they never take.
  const needsWalletStep = !known.wallet;

  // Two different questions, and they were being answered by one flag. The
  // passkey cache decides which BUTTONS to show, since it says whether this
  // browser can assert a credential straight away. The remembered wallet is
  // what says this person has organized here before, and the voter passkey
  // shares the same cache, so greeting on it alone would welcome back somebody
  // who has only ever voted.

  // The passkey IS the organizer's authentication, with no fallback path, so a
  // device without a screen lock configured simply cannot get in. Detecting that
  // up front turns a dead end into an instruction.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const available = await hasPlatformAuthenticator();
      if (!cancelled) setPlatformAuth(available);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const STEPS = [{ label: t('org_auth.step_passkey') }, { label: t('org_auth.step_wallet') }];

  /**
   * Shows the error NAME as well as its message.
   *
   * A WebAuthn failure arrives as a DOMException whose message is often empty
   * and never specific, while the name is the whole diagnosis:
   * `NotAllowedError` is a cancellation or a missing screen lock,
   * `NotSupportedError` an authenticator that cannot do what was asked,
   * `InvalidStateError` a credential this device already holds. Reporting
   * "something went wrong" for all three leaves the person, and whoever they
   * ask for help, with nothing to go on.
   */
  const fail = (e: unknown) => {
    const detail =
      e instanceof Error ? [e.name, e.message].filter(Boolean).join(": ") : String(e);
    toast({ title: t('errors.generic_title'), description: detail, variant: 'error' });
  };

  /**
   * Step 1: real WebAuthn passkey. Authentication NEVER falls back to a
   * simulated pass: if the authenticator is unavailable or the user cancels,
   * the step does not advance.
   *
   * `intent` decides what an empty local cache means. "existing" asks the
   * authenticator what it holds, which is how a synced passkey or one on the
   * organizer's phone answers; "first" mints one. Guessing between them is the
   * thing that must not happen: the tally keys of every election this organizer
   * created are re-derived from the passkey's PRF output, so a silently minted
   * second credential makes those results impossible to decrypt.
   *
   * Returning organizers sign in with the passkey ALONE: the wallet they linked
   * on first login is remembered, and is only summoned again when a transaction
   * actually needs signing. That is the whole point of a passkey.
   */
  const handlePasskey = async (intent: PasskeyIntent) => {
    setBusy(true);
    try {
      await authenticatePasskey(intent);
      if (getRememberedOrganizerAddress()) {
        finishLogin(); // returning organizer: no wallet prompt needed
        return;
      }
      setStep(1); // first time on this browser: link a wallet
    } catch (e) {
      if (e instanceof NoPasskeyFoundError) {
        setNothingOffered(true);
        toast({
          title: t('org_auth.no_passkey_found'),
          description: t('org_auth.no_passkey_found_help'),
          variant: 'info',
        });
        return;
      }
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
   * Step 2: real wallet connection. Independent of whether contracts are
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
      if (!address) return; // user rejected: stay on this step
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
            <h1 className="text-xl font-bold text-white">
              {t(known.wallet ? 'org_auth.title_back' : 'org_auth.title')}
            </h1>
            <p className="text-sm text-on-surface-variant mt-1">
              {t(known.wallet ? 'org_auth.subtitle_back' : 'org_auth.subtitle')}
            </p>
          </div>

          {needsWalletStep && <Stepper steps={STEPS} current={step} className="mb-8" />}

          {step === 0 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-on-surface-variant text-center">
                {t(known.wallet ? 'org_auth.passkey_desc_back' : 'org_auth.passkey_desc')}
              </p>

              {platformAuth === false && (
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-warning/10 border border-warning/20">
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-warning">{t('org_auth.no_authenticator')}</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      {t('org_auth.no_authenticator_help')}
                    </p>
                  </div>
                </div>
              )}

              <p className="text-xs text-on-surface-meta text-center leading-relaxed">
                {t('org_auth.passkey_provider_hint')}
              </p>

              {/* One button when this browser already holds the credential, two
                  when it does not. The second case is a real question and not a
                  formality: "I have one elsewhere" reaches a synced passkey or
                  the organizer's phone, "this is my first" mints one, and the
                  wrong guess costs them the keys to their own results. */}
              {known.passkey ? (
                <Button
                  variant="gradient"
                  size="lg"
                  className="w-full rounded-full h-14 gap-2"
                  disabled={busy}
                  onClick={() => void handlePasskey('existing')}
                >
                  <KeyRound className="w-5 h-5" />
                  {t('org_auth.continue_passkey')}
                </Button>
              ) : (
                <>
                  <Button
                    variant={nothingOffered ? 'default' : 'gradient'}
                    size="lg"
                    className="w-full rounded-full h-14 gap-2"
                    disabled={busy}
                    onClick={() => void handlePasskey('existing')}
                  >
                    <KeyRound className="w-5 h-5" />
                    {t('org_auth.use_existing')}
                  </Button>
                  <Button
                    variant={nothingOffered ? 'gradient' : 'ghost'}
                    size="lg"
                    className="w-full rounded-full h-12 gap-2"
                    disabled={busy}
                    onClick={() => void handlePasskey('first')}
                  >
                    <UserPlus className="w-4 h-4" />
                    {t('org_auth.create_first')}
                  </Button>
                  <p className="text-xs text-on-surface-meta text-center">
                    {t('org_auth.which_one_help')}
                  </p>
                </>
              )}
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

              {/* A phone has no injected provider, and there is nothing to
                  detect: a wallet app exposes one only inside its OWN browser.
                  Saying so is the whole of what can honestly be offered here.
                  Reaching MetaMask without leaving this page needs
                  WalletConnect, which this build does not carry. */}
              {!wallet.hasWallet && isMobile && (
                <p className="text-xs text-on-surface-meta text-center leading-relaxed">
                  {t('org_auth.no_wallet_mobile')}
                </p>
              )}
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
