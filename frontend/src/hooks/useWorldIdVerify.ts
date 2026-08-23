import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { type IDKitResult } from '@worldcoin/idkit-core';
import { useAuth } from '../contexts/AuthContext';
import { getOrCreateIdentity } from '../lib/semaphore';
import { requestWorldIdProof } from '../lib/worldId';

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
      // World ID first: the session cookie it sets is what authorises reading
      // the identity vault. Only then can we tell whether this voter already
      // has an identity (unlock it) or is brand new (mint one). Minting first
      // would hand a returning voter a second identity on every new device,
      // and a human with two identities can vote twice.
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/verify-human`, {
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
      if (data.nullifier) localStorage.setItem('voter_nullifier', data.nullifier);

      // Unlocks the existing identity with any of the voter's passkeys, or
      // creates it on first use. Prompts the authenticator; we are still inside
      // the user gesture that started the verification.
      await getOrCreateIdentity();

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
