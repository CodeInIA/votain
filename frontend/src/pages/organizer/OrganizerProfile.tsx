import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Wallet } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { OtherRoleCard } from '../../components/ui/OtherRoleCard';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { SignOutActions } from '../../components/ui/SignOutActions';
import { SiteLinksCard } from '../../components/layout/SiteLinksCard';
import { LanguageSelector } from '../../components/ui/LanguageSelector';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { MyDomains } from '../../components/organizer/MyDomains';
import { getOrganizerName, setOrganizerName } from '../../lib/organizer';
import { roleAccent } from '../../lib/activeRole';

export default function OrganizerProfile() {
  const { t } = useTranslation();
  const wallet = useOrganizerWallet();

  const [displayName, setDisplayName] = useState(getOrganizerName);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);

  const saveName = () => {
    const next = nameInput.trim() || displayName;
    setOrganizerName(next);
    setDisplayName(next);
    setEditingName(false);
  };

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-xl mx-auto pt-6 pb-24">
        {/* No back arrow. Every other page carrying one is somewhere you drill
            INTO from a list: an election, its results, the create wizard. This
            is reached from the avatar in the header, exactly like the voter
            profile beside it, which never had one. */}
        <h1 className="text-2xl font-black tracking-tight text-white mb-6 flex items-start gap-2">
          <User className={`w-5 h-5 shrink-0 mt-1.5 ${roleAccent('organizer')}`} />
          {t('profile.title')}
        </h1>

        {/* Display name */}
        <Card className="p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            {t('profile.display_name')}
          </h2>
          {editingName ? (
            <div className="flex gap-3">
              <div className="flex-1">
                <Input
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveName()}
                  autoFocus
                />
              </div>
              <Button variant="gradient" className="rounded-2xl px-4 h-11" onClick={saveName}>
                {t('common.save')}
              </Button>
              <Button variant="ghost" className="rounded-2xl px-4 h-11" onClick={() => { setEditingName(false); setNameInput(displayName); }}>
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-on-surface font-medium">{displayName}</p>
              <Button variant="ghost" className="rounded-2xl text-sm px-4" onClick={() => { setEditingName(true); setNameInput(displayName); }}>
                {t('common.edit')}
              </Button>
            </div>
          )}
        </Card>

        {/* Verified domains: the organizer's public identity, checkable by anyone */}
        <MyDomains
          address={wallet.address}
          getSigner={() => wallet.getSigner()}
          withWalletApp={wallet.withWalletApp}
        />

        {/* The wallet: the organizer's identity, not an accessory to it */}
        <Card className="p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4 text-primary" />
            {t('profile.linked_wallet')}
          </h2>
          {wallet.address ? (
            <>
              <p className="text-xs text-on-surface font-mono break-all">{wallet.address}</p>
              <p className="text-xs text-on-surface-meta mt-2">{t('profile.wallet_note')}</p>
            </>
          ) : (
            <p className="text-sm text-on-surface-meta">{t('profile.no_wallet_linked')}</p>
          )}
        </Card>

        {/* Language */}
        {/* Same offer as the voter profile makes, the other way round.
            An organizer is a person who may also want to vote, and until the
            header could switch roles there was nowhere to say so. */}
        <OtherRoleCard role="voter" />

        <Card className="p-5 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-on-surface">{t('landing.footer.language')}</p>
            <LanguageSelector align="right" />
          </div>
        </Card>

        {/* Legal links, mobile only (desktop sees them in the footer) */}
        {/* The footer's links, for the screens where the footer is hidden. */}
        <SiteLinksCard />

        {/* Sign out, of this role or of both when both are held. */}
        <Card className="p-5">
          <SignOutActions role="organizer" />
        </Card>

      </div>
    </PageLayout>
  );
}
