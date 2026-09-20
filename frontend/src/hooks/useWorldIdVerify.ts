import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { type IDKitResult } from '@worldcoin/idkit-core';
import { useAuth } from '../contexts/AuthContext';
import { sealOnDevice } from '../lib/deviceSeal';

import {
  requestWorldIdProof,
  resumeWorldIdProof,
  waitForWorldIdProof,
  cancelWorldIdProof,
} from '../lib/worldId';
import { backendUrl } from '../lib/backend';

export function useWorldIdVerify() {
  const [isLoadingQr, setIsLoadingQr] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [connectorURI, setConnectorURI] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { setVoterLoggedIn } = useAuth();

  const handleVerify = useCallback(async (proof: IDKitResult): Promise<void> => {
    try {
      // World ID first: the session cookie it sets is what authorises reading
      // the identity vault. Only then can we tell whether this voter already
      // has an identity (unlock it) or is brand new (mint one). Minting first
      // would hand a returning voter a second identity on every new device,
      // and a human with two identities can vote twice.
      const res = await fetch(backendUrl('/api/verify-human'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(proof),
      });

      if (!res.ok) {
        const errorData: unknown = await res.json();
        console.error('Backend verification failed:', errorData);
        throw new Error('Backend verification failed');
      }

      const data = await res.json() as { nullifier?: string };
      if (data.nullifier) await sealOnDevice('nullifier', data.nullifier);

      // Verification ends here. What happens to the voting identity is a
      // separate question, asked on its own screen, so no authenticator dialog
      // arrives on top of a flow the voter thinks has just finished.
      setVoterLoggedIn(true);
      setConnectorURI(null);
      setIsVerifying(false);
      navigate('/voter/identity', { replace: true });
    } catch (error: unknown) {
      // Verified, but this device cannot open the identity that World ID just
      // proved belongs to this human: no passkey here can reach the vault, and
      // no phrase is stored either. That is not a failed verification and must
      // not be reported as one. The session is real, so the voter is signed in
      // and sent to the one place that can finish the job.

      console.error('Verification failed:', error);
      setQrError(t('verify.error_backend'));
      setIsVerifying(false);
      setConnectorURI(null);
    }
  }, [navigate, setVoterLoggedIn, t]);

  /**
   * PICKS UP A VERIFICATION THIS BROWSER NO LONGER REMEMBERS STARTING.
   *
   * The case this exists for is the ordinary one on a phone. Verifying means
   * leaving for World App, and the system is free to discard the backgrounded
   * tab; coming back is then a fresh page with empty state. Before the request
   * was moved to the server there was nothing to come back TO, so a voter who
   * had already proved who they are was shown the sign-in screen again — the
   * single worst moment to ask somebody to start over.
   *
   * Three outcomes, three behaviours: sign them in, put the QR back, or do
   * nothing at all. Doing nothing is the common case and has to stay invisible.
   *
   * COLLECTED ONCE, AND THE GUARD IS RELEASED IF THE ATTEMPT DID NOT LAND.
   * Both halves are load-bearing, and getting only the first cost an afternoon.
   *
   * Once is required because the server hands a proof over and forgets it: a
   * second pass would post a proof it no longer knows, and the voter would be
   * told their verification failed moments after it succeeded.
   *
   * Releasing it is required because of StrictMode, which mounts, unmounts and
   * remounts every effect in development. The cleanup aborted the fetch that
   * was still in flight, and the remount then found the guard already set and
   * returned immediately — so the resume never completed ONCE, let alone
   * twice. Measured in a browser: the server answered `waiting` and the page
   * went on showing the welcome slide. A guard that is never released turns
   * "at most once" into "never" the moment anything interrupts the first try.
   *
   * `latest` keeps the effect off `handleVerify`'s identity, which changes
   * whenever the auth context re-renders. Without it the effect tears itself
   * down mid-flight for the same reason, in production as well as in
   * development.
   */
  const latest = useRef(handleVerify);
  const traducir = useRef(t);
  useEffect(() => {
    latest.current = handleVerify;
    traducir.current = t;
  }, [handleVerify, t]);

  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;

    let landed = false;
    const abort = new AbortController();
    void (async () => {
      const pending = await resumeWorldIdProof();
      if (abort.signal.aborted || pending.kind === 'none') return;
      landed = true;

      if (pending.kind === 'proof') {
        setIsVerifying(true);
        await latest.current(pending.result);
        return;
      }

      // Still running: show what it was showing before, and rejoin the wait.
      setConnectorURI(pending.connectorURI);
      setIsVerifying(true);
      const result = await waitForWorldIdProof(abort.signal);
      if (abort.signal.aborted) return;
      if (!result) {
        setQrError(traducir.current('verify.error_generic'));
        setIsVerifying(false);
        setConnectorURI(null);
        return;
      }
      await latest.current(result);
    })();

    // Only stops this page waiting. The verification itself belongs to the
    // browser, not to this component, and survives being navigated away from
    // on purpose: that is the whole point of holding it on the server.
    return () => {
      abort.abort();
      if (!landed) resumed.current = false;
    };
    // MOUNT ONLY, and the empty list is the point rather than an oversight.
    // `t` and `handleVerify` are both rebuilt on most renders, so naming them
    // here makes the effect tear itself down and start again mid-flight — the
    // same self-inflicted abort as above, but in production too, where there
    // is no StrictMode to blame. Both are read through refs instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenWorldId = async (): Promise<void> => {
    setQrError(null);
    setIsLoadingQr(true);
    try {
      const result = await requestWorldIdProof({
        onConnectorUri: uri => {
          setIsLoadingQr(false);
          setConnectorURI(uri);
          setIsVerifying(true);
        },
      });

      if (!result) {
        setQrError(t('verify.error_generic'));
        setIsVerifying(false);
        setConnectorURI(null);
        return;
      }
      await handleVerify(result);
    } catch (e: unknown) {
      console.error('World ID flow failed:', e);
      setQrError(t('verify.error_generic'));
      setIsLoadingQr(false);
      setIsVerifying(false);
      setConnectorURI(null);
    }
  };

  const handleCancelQr = (): void => {
    // The server is told too. Pressing the button again would replace it
    // anyway, so this is not what makes a retry work; what it prevents is a
    // RESUME. Without it, this page reloaded a minute later would find the
    // abandoned verification still pending and put its QR straight back up,
    // having just been told to take it down.
    void cancelWorldIdProof();
    setConnectorURI(null);
    setIsVerifying(false);
    setIsLoadingQr(false);
    setQrError(null);
  };

  return {
    isLoadingQr,
    isVerifying,
    connectorURI,
    qrError,
    handleOpenWorldId,
    handleCancelQr,
  };
}
