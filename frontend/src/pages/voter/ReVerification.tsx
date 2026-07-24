import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useToast } from '../../components/ui/useToast';

export default function ReVerification() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  // Demo "last verified" date, snapshot once so render stays pure.
  const [lastVerified] = useState(() => new Date(Date.now() - 30 * 86_400_000).toLocaleDateString());

  const handleVerify = () => {
    toast({ title: t('reverify.pending'), description: t('common.integration_pending'), variant: 'info' });
  };

  return (
    <PageLayout role="voter" showNav>
      <div className="max-w-md mx-auto pt-10 pb-24 flex flex-col items-center text-center">
        {/* Icon */}
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-warning/20 blur-[40px] rounded-full" />
          <div className="relative w-20 h-20 rounded-full bg-warning/10 border border-warning/20 flex items-center justify-center">
            <ShieldAlert className="w-10 h-10 text-warning" strokeWidth={1.5} />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">{t('reverify.title')}</h1>
        <p className="text-sm text-on-surface-variant mb-8 leading-relaxed">{t('reverify.desc')}</p>

        {/* Reason card */}
        <Card className="p-5 mb-8 w-full text-left">
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

        {/* Actions */}
        <div className="flex flex-col gap-3 w-full">
          <Button
            variant="gradient"
            size="lg"
            className="w-full rounded-full h-14 gap-2"
            onClick={handleVerify}
          >
            <img src="/world-id-logo.svg" alt="World ID" className="w-5 h-5" />
            {t('reverify.verify_btn')}
          </Button>
          <Button variant="ghost" className="w-full rounded-full" onClick={() => navigate(-1)}>
            {t('common.back')}
          </Button>
        </div>

        {/* Already verified state (demo) */}
        <div className="mt-10 flex items-center gap-2 text-xs text-success">
          <ShieldCheck className="w-4 h-4" />
          {t('reverify.last_verified', { date: lastVerified })}
        </div>
      </div>
    </PageLayout>
  );
}
