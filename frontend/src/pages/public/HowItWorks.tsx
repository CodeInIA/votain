import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Fingerprint, ShieldCheck, Vote, BarChart3, ChevronRight } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { BlockchainBadge, IPFSBadge } from '../../components/ui/BlockchainBadge';
import { useAuth } from '../../contexts/AuthContext';
import { usePageMeta } from '../../seo/usePageMeta';

const STEPS = [
  { icon: Fingerprint, color: 'text-secondary',  bg: 'bg-secondary/10',  titleKey: 'how.step1_title', descKey: 'how.step1_desc' },
  { icon: Vote,        color: 'text-primary',     bg: 'bg-primary/10',    titleKey: 'how.step2_title', descKey: 'how.step2_desc' },
  { icon: ShieldCheck, color: 'text-tertiary',    bg: 'bg-tertiary/10',   titleKey: 'how.step3_title', descKey: 'how.step3_desc' },
  { icon: BarChart3,   color: 'text-success',     bg: 'bg-success/10',    titleKey: 'how.step4_title', descKey: 'how.step4_desc' },
] as const;

export default function HowItWorks() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  usePageMeta({ title: t('how.title'), description: t('how.subtitle') });
  const { voterLoggedIn } = useAuth();

  return (
    <PageLayout role="public" showNav showFooter>
      <div className="max-w-4xl mx-auto pt-10 pb-16">
        {/* Hero */}
        <div className="text-center mb-14">
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white mb-3">
            {t('how.title')}
          </h1>
          <p className="text-on-surface-variant text-sm sm:text-base max-w-lg mx-auto leading-relaxed">
            {t('how.subtitle')}
          </p>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-14">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <div
                key={i}
                className="relative p-6 rounded-3xl border border-white/5 bg-surface-low/30 backdrop-blur-xl"
              >
                <div className={`w-12 h-12 rounded-2xl ${step.bg} flex items-center justify-center mb-4`}>
                  <Icon className={`w-6 h-6 ${step.color}`} strokeWidth={1.5} />
                </div>
                <span className="absolute top-5 right-5 text-xs font-bold text-on-surface-meta/40">
                  0{i + 1}
                </span>
                <h3 className="text-base font-bold text-white mb-2">{t(step.titleKey)}</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed">{t(step.descKey)}</p>
              </div>
            );
          })}
        </div>

        {/* Trust indicators */}
        <div className="flex flex-col items-center gap-6 text-center mb-12">
          <p className="text-sm text-on-surface-meta uppercase tracking-widest font-semibold">
            {t('how.built_on')}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <BlockchainBadge href="https://polygon.technology/polygon-pos" />
            <IPFSBadge href="https://ipfs.tech" />
          </div>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button
            variant="gradient"
            size="lg"
            className="rounded-full px-8 gap-2"
            onClick={() => navigate('/discover')}
          >
            {t('how.cta_discover')}
            <ChevronRight className="w-4 h-4" />
          </Button>
          {/* An invitation to register, offered to someone already registered,
              reads as the page not knowing who it is talking to. Signed-in
              voters get the same swap the landing page makes.

              Organizers ARE invited, which they were not while the navigation
              could only wear one role: both bars resolved organizer first, so
              accepting the invitation handed them a voter session the app then
              hid. `RoleSwitch` is what changed that, and this is the visible
              consequence of it. */}
          {!voterLoggedIn && (
            <Button
              variant="ghost"
              size="lg"
              className="rounded-full px-8"
              onClick={() => navigate('/voter/onboarding')}
            >
              {t('how.cta_register')}
            </Button>
          )}
          {voterLoggedIn && (
            <Button
              variant="ghost"
              size="lg"
              className="rounded-full px-8"
              onClick={() => navigate('/voter/elections')}
            >
              {t('landing.my_elections')}
            </Button>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
