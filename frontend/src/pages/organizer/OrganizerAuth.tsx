/**
 * Organizer sign-in: the wallet, and nothing else.
 *
 * It used to be a passkey first and a wallet second, and the order was wrong in
 * a way that only showed up on a second device. An organizer cannot act at all
 * without the wallet: it owns their elections on chain, every lifecycle call is
 * a transaction from it, and a deterministic signature from it derives the key
 * their results are decrypted with. A passkey on top of that authenticated
 * nothing the wallet did not already authenticate, and it could fail on its
 * own: Chrome and Firefox on Windows refuse to evaluate the PRF extension on an
 * assertion, so a credential created on one machine opened nothing on the next.
 *
 * So there is one step here. The passkey survives as an OPTIONAL hardening of
 * the tally key, offered from the profile, where it buys something a login gate
 * never could: a stolen wallet that still cannot read the ballots.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Wallet, ChevronRight, ChevronLeft, AlertTriangle } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/useToast';
import { useAuth } from '../../contexts/AuthContext';
import { useOrganizerWallet, getRememberedOrganizerAddress } from '../../hooks/useOrganizerWallet';
import { clearSignedOutMark } from '../../lib/activeRole';
import { chainInfo } from '../../lib/deployments';

/** A phone or tablet, where a wallet extension cannot exist. */
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export default function OrganizerAuth() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { setOrganizerLoggedIn } = useAuth();
  const wallet = useOrganizerWallet();
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [busy, setBusy] = useState(false);


  /**
   * Whether this browser has seen this organizer before, read once so the
   * screen cannot change shape under them mid-flow.
   *
   * A per-browser cache, not an account: a returning organizer on a second
   * machine has none and gets the same screen a new one does, minus the
   * assumption that they are new. Their elections are found by address, so
   * nothing is lost by being greeted as a stranger.
   */
  const [known] = useState(() => Boolean(getRememberedOrganizerAddress()));

  // Arriving here is the whole point of the mark a sign-out leaves, so it goes
  // now. Without this, walking back through a history of organizer screens
  // would bounce to this page once per entry instead of leaving for the
  // landing in one press.
  useEffect(() => clearSignedOutMark(), []);

  /**
   * Shows the error NAME as well as its message, since a wallet provider throws
   * plenty of errors whose message is empty and whose name is the diagnosis.
   */
  const fail = (e: unknown) => {
    const detail =
      e instanceof Error ? [e.name, e.message].filter(Boolean).join(': ') : String(e);
    toast({ title: t('errors.generic_title'), description: detail, variant: 'error' });
  };

  const finishLogin = useCallback(() => {
    setOrganizerLoggedIn(true);
    navigate('/organizer/dashboard');
  }, [navigate, setOrganizerLoggedIn]);

  /**
   * FINISHES A SIGN-IN THE WALLET ALREADY APPROVED.
   *
   * On a phone, connecting means leaving: the wallet app takes the screen, and
   * the system is free to discard the backgrounded tab. The organizer approves,
   * comes back, and lands on a fresh copy of this page with `handleWallet`'s
   * promise long gone — so they are asked to connect a wallet that is, at that
   * moment, connected. Several of them concluded the approval had not worked
   * and did it again.
   *
   * Nothing was actually lost. WalletConnect persists the session, and
   * `useOrganizerWallet` now restores it on mount, so an address appearing here
   * without anybody pressing anything means exactly one thing: this browser has
   * a live session it did not know about a moment ago. There is no second
   * factor to ask for — the wallet IS the organizer's identity, which is the
   * premise of this whole screen — so there is nothing left to do but go in.
   *
   * ONLY OVER WALLETCONNECT, WHICH IS THE CASE THAT BREAKS. An extension
   * injects itself into every document, so a reload costs the organizer one
   * prompt-free press and nothing was ever lost there. Letting this fire for
   * an injected wallet would break something else instead: signing out clears
   * this app's own flags but cannot un-authorise MetaMask, so the sign-in
   * screen would recognise the still-authorised account and go straight back
   * in — leaving no way to reach the screen at all. Measured in a browser with
   * an authorised provider, which is how that was caught.
   *
   * WHILE `busy` IS FALSE, so this cannot fire underneath `handleWallet` and
   * navigate out from beneath its own error handling. And the wrong network is
   * still the wrong network: it is shown, not skipped past.
   */
  useEffect(() => {
    if (busy || !wallet.usesWalletConnect || !wallet.live || !wallet.address || wrongNetwork) return;
    let cancelled = false;
    void (async () => {
      if (await wallet.isWrongNetwork()) {
        if (!cancelled) setWrongNetwork(true);
        return;
      }
      if (!cancelled) finishLogin();
    })();
    return () => { cancelled = true; };
    // `wallet` is rebuilt every render; the address is the thing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address, wallet.live, wallet.usesWalletConnect, busy, wrongNetwork, finishLogin]);

  /**
   * Connect, check the chain, done. Independent of whether contracts are
   * deployed: an EOA is required to sign anything as an organizer, and being on
   * the wrong chain is worth catching here rather than at the first transaction.
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
      if (!address) return; // user rejected: stay here
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
      // Deliberately NOT clearing `wrongNetwork` here. It would re-render this
      // screen with the connect button back before the navigation commits, and
      // the dashboard is a lazy chunk, so that frame is on screen long enough
      // to read: press "switch network", watch "connect wallet" flash past.
      // Nobody is going to look at this screen again, so leave it as it is and
      // let it unmount.
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
          // The wrong-network state is not a history entry, it is this screen
          // wearing a different face, so going "back" from it means taking that
          // face off. Without this the arrow left the sign-in screen entirely,
          // which is not where anyone was a moment ago.
          onClick={() => (wrongNetwork ? setWrongNetwork(false) : navigate(-1))}
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
              <Wallet className="w-8 h-8 text-primary" strokeWidth={1.5} />
            </div>
            <h1 className="text-xl font-bold text-white">
              {t(known ? 'org_auth.title_back' : 'org_auth.title')}
            </h1>
            <p className="text-sm text-on-surface-variant mt-1">
              {t(known ? 'org_auth.subtitle_back' : 'org_auth.subtitle')}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {wrongNetwork && (
              <div className="flex items-start gap-3 p-3 rounded-2xl bg-warning/10 border border-warning/20">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-warning">{t('org_auth.wrong_network')}</p>
                  <p className="text-xs text-on-surface-meta mt-0.5">{t('org_auth.wrong_network_desc', { network: chainInfo.name })}</p>
                </div>
              </div>
            )}

            <p className="text-sm text-on-surface-variant text-center">
              {t(known ? 'org_auth.wallet_desc_back' : 'org_auth.wallet_desc')}
            </p>

            {/* Only when there is nothing at all to connect with: no injected
                provider AND no WalletConnect project id. `useOrganizerWallet`
                falls back to WalletConnect on its own, so a phone normally does
                have a way in, and `hasWallet` says so. This message is for the
                build where that id was never configured. */}
            {!wallet.hasWallet && isMobile && (
              <p className="text-xs text-on-surface-meta text-center leading-relaxed">
                {t('org_auth.no_wallet_mobile')}
              </p>
            )}

            {wrongNetwork ? (
              <Button variant="gradient" size="lg" className="w-full rounded-full h-14 gap-2" disabled={busy} onClick={handleSwitchNetwork}>
                {t('org_auth.switch_network', { network: chainInfo.name })}
                <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button variant="gradient" size="lg" className="w-full rounded-full h-14 gap-2" disabled={busy} onClick={handleWallet}>
                <Wallet className="w-5 h-5" />
                {t('org_auth.connect_wallet')}
              </Button>
            )}

            <p className="text-xs text-on-surface-meta text-center leading-relaxed">
              {t('org_auth.wallet_is_identity')}
            </p>
          </div>
        </motion.div>
      </div>
    </PageLayout>
  );
}
