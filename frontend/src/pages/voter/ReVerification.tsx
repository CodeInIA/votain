import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck, AlertTriangle } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/useToast';
import { requestWorldIdProof } from '../../lib/worldId';
import { recoverWithNewPasskey } from '../../lib/semaphore';

/**
 * Identity recovery: the way back in after losing every passkey that could
 * unlock your voting identity.
 *
 * Authorised by a fresh World ID proof rather than by the session, because this
 * rebinds the identity the voter votes with: a stolen session must not be enough
 * to take someone's identity over. World ID derives the same nullifier for the
 * same human, so only that human can authorise their own rotation.
 */
export default function ReVerification() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [connectorUri, setConnectorUri] = useState<string | null>(null);

  const handleRecover = async (): Promise<void> => {
    setBusy(true);
    try {
      const proof = await requestWorldIdProof({ onConnectorUri: setConnectorUri });
      setConnectorUri(null);
      if (!proof) {
        toast({ title: t('reverify.cancelled'), variant: 'info' });
        return;
      }

      // Creates a passkey on THIS device, mints a fresh identity and asks the
      // issuer to rotate the on-chain commitment onto it.
      await recoverWithNewPasskey(proof);

      toast({
        title: t('reverify.recovered'),
        description: t('reverify.recovered_desc'),
        variant: 'success',
      });
      navigate('/voter/elections');
    } catch (error: unknown) {
      toast({
        title: t('reverify.failed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
      setConnectorUri(null);
    }
  };

  return (
    <PageLayout role="voter" showNav>
      <div className="max-w-md mx-auto pt-10 pb-24 flex flex-col items-center text-center">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-warning/20 blur-[40px] rounded-full" />
          <div className="relative w-20 h-20 rounded-full bg-warning/10 border border-warning/20 flex items-center justify-center">
            <ShieldAlert className="w-10 h-10 text-warning" strokeWidth={1.5} />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">{t('reverify.title')}</h1>
        <p className="text-sm text-on-surface-variant mb-8 leading-relaxed">{t('reverify.desc')}</p>

        <Card className="p-5 mb-4 w-full text-left">
          <h2 className="text-sm font-semibold text-on-surface mb-3">{t('reverify.why_title')}</h2>
          <ul className="space-y-2 text-sm text-on-surface-variant">
            {[1, 2, 3].map(i => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                {t(`reverify.reason${i}`)}
              </li>
            ))}
          </ul>
        </Card>

        {/* The cost of recovering is permanent and worth stating before the
            voter commits, not after: the chain cannot tell whether they already
            voted somewhere, so it has to refuse them everywhere they enrolled. */}
        <Card className="p-4 mb-8 w-full text-left bg-warning/5 border-warning/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-warning">{t('reverify.cost_title')}</p>
              <ul className="mt-1.5 space-y-1 text-xs text-on-surface-variant">
                <li>{t('reverify.cost_elections')}</li>
                <li>{t('reverify.cost_receipts')}</li>
              </ul>
            </div>
          </div>
        </Card>

        {connectorUri && (
          <Card className="p-5 mb-6 w-full">
            <p className="text-sm text-on-surface-variant mb-3">{t('verify.qr_desc')}</p>
            <a
              href={connectorUri}
              className="text-xs text-primary break-all hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              {connectorUri}
            </a>
          </Card>
        )}

        <div className="flex flex-col gap-3 w-full">
          <Button
            variant="gradient"
            size="lg"
            className="w-full rounded-full h-14 gap-2"
            disabled={busy}
            onClick={() => void handleRecover()}
          >
            {busy ? (
              <Spinner className="w-5 h-5" />
            ) : (
              <img src="/world-id-logo.svg" alt="World ID" className="w-5 h-5" />
            )}
            {busy ? t('reverify.recovering') : t('reverify.verify_btn')}
          </Button>
          <Button variant="ghost" className="w-full rounded-full" onClick={() => navigate(-1)}>
            {t('common.back')}
          </Button>
        </div>

        <div className="mt-10 flex items-center gap-2 text-xs text-on-surface-meta">
          <ShieldCheck className="w-4 h-4" />
          {t('reverify.one_identity_note')}
        </div>
      </div>
    </PageLayout>
  );
}
