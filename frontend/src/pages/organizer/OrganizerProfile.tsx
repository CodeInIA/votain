import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { KeyRound, Trash2, LogOut, User, Wallet, Info, FileText, Shield } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { LanguageSelector } from '../../components/ui/LanguageSelector';
import { useToast } from '../../components/ui/useToast';
import { useAuth } from '../../contexts/AuthContext';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { getPasskeyInfo, clearPrfCredential } from '../../lib/passkeyPrf';
import { getOrganizerName, setOrganizerName } from '../../lib/organizer';

export default function OrganizerProfile() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { organizerSignOut } = useAuth();
  const wallet = useOrganizerWallet();

  const [displayName, setDisplayName] = useState(getOrganizerName);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);
  // The single passkey actually registered on this device (null if none).
  const [passkey, setPasskey] = useState(() => getPasskeyInfo());
  const [deleteModal, setDeleteModal] = useState(false);
  const [signOutModal, setSignOutModal] = useState(false);

  const saveName = () => {
    const next = nameInput.trim() || displayName;
    setOrganizerName(next);
    setDisplayName(next);
    setEditingName(false);
  };

  /** Removing the passkey ends the session — it *is* the login credential. */
  const removePasskey = () => {
    clearPrfCredential();
    setPasskey(null);
    setDeleteModal(false);
    organizerSignOut();
    toast({ title: t('profile.passkey_removed'), variant: 'info' });
    setTimeout(() => navigate('/organizer/auth', { replace: true }), 600);
  };

  const signOut = () => {
    setSignOutModal(false);
    organizerSignOut();
    toast({ title: t('profile.signed_out'), variant: 'info' });
    setTimeout(() => navigate('/', { replace: true }), 500);
  };

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-xl mx-auto pt-4 pb-24">
        <BackButton className="mb-5" />

        <h1 className="text-2xl font-black tracking-tight text-white mb-6">{t('profile.title')}</h1>

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
              <Button variant="gradient" className="rounded-2xl px-4" onClick={saveName}>
                {t('common.save')}
              </Button>
              <Button variant="ghost" className="rounded-2xl px-4" onClick={() => { setEditingName(false); setNameInput(displayName); }}>
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

        {/* Passkey — the real credential registered on this device */}
        <Card className="p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2 mb-4">
            <KeyRound className="w-4 h-4 text-primary" />
            {t('profile.passkeys')}
          </h2>

          {passkey ? (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-high/40">
              <KeyRound className="w-4 h-4 text-on-surface-meta shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-on-surface">{t('profile.this_device')}</p>
                <p className="text-xs text-on-surface-meta font-mono truncate">
                  {passkey.id.slice(0, 16)}…
                </p>
                <p className="text-xs text-on-surface-meta mt-0.5">
                  {t('profile.last_used')} {passkey.lastUsedAt.toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteModal(true)}
                className="text-error hover:text-error/70 transition-colors p-1 cursor-pointer"
                aria-label={t('profile.delete_passkey_title')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <p className="text-sm text-on-surface-meta">{t('profile.no_passkey')}</p>
          )}
        </Card>

        {/* Linked wallet — used only to sign transactions */}
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
        <Card className="p-5 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-on-surface">{t('landing.footer.language')}</p>
            <LanguageSelector align="right" />
          </div>
        </Card>

        {/* Legal links — mobile only (desktop sees them in the footer) */}
        <Card className="p-2 mb-4 md:hidden">
          <Link to="/how-it-works" className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors text-sm text-on-surface-variant hover:text-on-surface">
            <Info className="w-4 h-4 shrink-0" />
            {t('nav.how_it_works')}
          </Link>
          <a href="#" className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors text-sm text-on-surface-variant hover:text-on-surface">
            <FileText className="w-4 h-4 shrink-0" />
            {t('landing.footer.terms')}
          </a>
          <a href="#" className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors text-sm text-on-surface-variant hover:text-on-surface">
            <Shield className="w-4 h-4 shrink-0" />
            {t('landing.footer.privacy')}
          </a>
        </Card>

        {/* Sign out */}
        <Card className="p-5">
          <Button
            variant="default"
            className="w-full rounded-2xl gap-2 border-error/30 text-error hover:bg-error/10"
            onClick={() => setSignOutModal(true)}
          >
            <LogOut className="w-4 h-4" />
            {t('profile.sign_out')}
          </Button>
        </Card>

        {/* Delete passkey modal */}
        <Modal
          open={deleteModal}
          onClose={() => setDeleteModal(false)}
          title={t('profile.delete_passkey_title')}
          description={t('profile.delete_passkey_desc')}
        >
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setDeleteModal(false)}>{t('common.cancel')}</Button>
            <Button
              variant="default"
              className="flex-1 border-error/30 text-error hover:bg-error/10"
              onClick={removePasskey}
            >
              {t('profile.delete_passkey_confirm')}
            </Button>
          </div>
        </Modal>

        {/* Sign out modal */}
        <Modal
          open={signOutModal}
          onClose={() => setSignOutModal(false)}
          title={t('profile.sign_out_title')}
          description={t('profile.sign_out_desc')}
        >
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setSignOutModal(false)}>{t('common.cancel')}</Button>
            <Button
              variant="default"
              className="flex-1 border-error/30 text-error hover:bg-error/10"
              onClick={signOut}
            >
              {t('profile.sign_out_confirm')}
            </Button>
          </div>
        </Modal>
      </div>
    </PageLayout>
  );
}
