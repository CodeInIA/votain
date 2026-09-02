import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, SearchCheck, RefreshCw, Info, FileText, Shield } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { LanguageSelector } from '../../components/ui/LanguageSelector';
import { MyDevices } from '../../components/voter/MyDevices';
import { IdentityBackupCard } from '../../components/voter/IdentityBackupCard';
import { OtherRoleCard } from '../../components/ui/OtherRoleCard';
import { SignOutActions } from '../../components/ui/SignOutActions';

export default function VoterProfile() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const nullifier = localStorage.getItem('voter_nullifier');

  return (
    <PageLayout role="voter" showNav>
      <div className="max-w-xl mx-auto pt-6 pb-24">
        <h1 className="text-2xl font-black tracking-tight text-white mb-6">{t('profile.title')}</h1>

        {/* Verification status */}
        <Card className="p-5 mb-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6 text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-on-surface">{t('nav.verified_voter')}</p>
              {nullifier && (
                <p className="text-xs text-on-surface-meta font-mono truncate mt-0.5">
                  {nullifier.slice(0, 20)}…
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* Quick links */}
        <Card className="p-5 mb-4">
          <div className="flex flex-col gap-2">
            <Button
              variant="ghost"
              className="justify-start gap-3 px-3 py-3 h-auto rounded-xl hover:bg-white/5 text-sm text-on-surface-variant hover:text-on-surface"
              onClick={() => navigate('/verify-receipt')}
            >
              <SearchCheck className="w-4 h-4 shrink-0" />
              {t('verify_receipt.title')}
            </Button>
            <Button
              variant="ghost"
              className="justify-start gap-3 px-3 py-3 h-auto rounded-xl hover:bg-white/5 text-sm text-on-surface-variant hover:text-on-surface"
              onClick={() => navigate('/voter/re-verify')}
            >
              <RefreshCw className="w-4 h-4 shrink-0" />
              {t('reverify.title')}
            </Button>
          </div>
        </Card>

        {/* Passkeys that can unlock this voter's identity */}
        <MyDevices />

        {/* The voter's own copy of that identity, for the case where neither
            this server nor the chain is reachable. */}
        <IdentityBackupCard />

        {/* The other half of what this person may be. Both sessions can be
            held at once and the header switches between them, so the profile
            is where that gets said. */}
        <OtherRoleCard role="organizer" />

        {/* Language */}
        <Card className="p-5 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-on-surface">{t('landing.footer.language')}</p>
            <LanguageSelector align="right" />
          </div>
        </Card>

        {/* Legal links: mobile only (desktop sees them in the footer) */}
        <Card className="p-2 mb-4 md:hidden">
          <Link to="/how-it-works" className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors text-sm text-on-surface-variant hover:text-on-surface">
            <Info className="w-4 h-4 shrink-0" />
            {t('nav.how_it_works')}
          </Link>
          <Link to="/terms" className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors text-sm text-on-surface-variant hover:text-on-surface">
            <FileText className="w-4 h-4 shrink-0" />
            {t('landing.footer.terms')}
          </Link>
          <Link to="/privacy" className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors text-sm text-on-surface-variant hover:text-on-surface">
            <Shield className="w-4 h-4 shrink-0" />
            {t('landing.footer.privacy')}
          </Link>
        </Card>

        {/* Sign out, of this role or of both when both are held. */}
        <SignOutActions role="voter" />
      </div>
    </PageLayout>
  );
}
