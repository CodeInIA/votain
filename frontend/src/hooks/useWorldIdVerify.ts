import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IDKit, orbLegacy, type IDKitResult } from '@worldcoin/idkit-core';
import { useAuth } from '../contexts/AuthContext';
import { getOrCreateIdentity } from '../lib/semaphore';

export function useWorldIdVerify() {
  const [isLoadingQr, setIsLoadingQr] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [connectorURI, setConnectorURI] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { setVoterLoggedIn } = useAuth();

  const handleVerify = async (proof: IDKitResult): Promise<void> => {
    try {
      // Derive (or reuse) the voter's Semaphore identity from their passkey so
      // the issuer can register its commitment on-chain alongside the World ID
      // verification. May prompt the passkey — we're already in a user gesture.
      const identity = await getOrCreateIdentity();

      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/verify-human`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...proof, identityCommitment: identity.commitment.toString() }),
      });

      if (!res.ok) {
        const errorData: unknown = await res.json();
        console.error('Backend verification failed:', errorData);
        throw new Error('Backend verification failed');
      }

      const data = await res.json() as { nullifier?: string };
      if (data.nullifier) localStorage.setItem('voter_nullifier', data.nullifier);

      setVoterLoggedIn(true);
      setConnectorURI(null);
      setIsVerifying(false);
      setIsSuccess(true);
      setTimeout(() => navigate('/voter/elections'), 1500);
    } catch (error: unknown) {
      console.error('Verification failed:', error);
      setQrError(t('verify.error_backend'));
      setIsVerifying(false);
      setConnectorURI(null);
    }
  };

  const handleOpenWorldId = async (): Promise<void> => {
    setQrError(null);
    setIsLoadingQr(true);
    try {
      const worldIdAction = import.meta.env.VITE_WORLD_ID_ACTION ?? 'vote-registration';
      const worldIdAppId = import.meta.env.VITE_WORLD_ID_APP_ID;
      const worldIdRpId = import.meta.env.VITE_WORLD_ID_RP_ID;

      const rpSigRes = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/rp-signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: worldIdAction }),
      });

      if (!rpSigRes.ok) throw new Error('Failed to fetch rp-signature');
      const rpSig = await rpSigRes.json() as {
        sig: string; nonce: string; created_at: number; expires_at: number;
      };

      const request = await IDKit.request({
        app_id: worldIdAppId,
        action: worldIdAction,
        rp_context: {
          rp_id: worldIdRpId,
          nonce: rpSig.nonce,
          created_at: rpSig.created_at,
          expires_at: rpSig.expires_at,
          signature: rpSig.sig,
        },
        allow_legacy_proofs: true,
        environment: 'production',
      }).preset(orbLegacy({}));

      setIsLoadingQr(false);
      setConnectorURI(request.connectorURI);
      setIsVerifying(true);

      const completion = await request.pollUntilCompletion();
      if (!completion.success) {
        setQrError(t('verify.error_generic'));
        setIsVerifying(false);
        setConnectorURI(null);
        return;
      }
      await handleVerify(completion.result);
    } catch (e: unknown) {
      console.error('World ID flow failed:', e);
      setQrError(t('verify.error_generic'));
      setIsLoadingQr(false);
      setIsVerifying(false);
      setConnectorURI(null);
    }
  };

  const handleCancelQr = (): void => {
    setConnectorURI(null);
    setIsVerifying(false);
    setIsLoadingQr(false);
    setQrError(null);
  };

  return {
    isLoadingQr,
    isVerifying,
    isSuccess,
    connectorURI,
    qrError,
    handleOpenWorldId,
    handleCancelQr,
  };
}
