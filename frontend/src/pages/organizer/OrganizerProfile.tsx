import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, KeyRound, Trash2, LogOut, User, Plus, Info, FileText, Shield } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { LanguageSelector } from '../../components/ui/LanguageSelector';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../contexts/AuthContext';

interface PasskeyEntry {
  id: string;
  name: string;
  createdAt: Date;
  lastUsed: Date;
}

const SEED_PASSKEYS: PasskeyEntry[] = [
  { id: 'pk1', name: 'MacBook Pro — Touch ID', createdAt: new Date(Date.now() - 30 * 86_400_000), lastUsed: new Date(Date.now() - 86_400_000) },
  { id: 'pk2', name: 'iPhone 15 Pro — Face ID', createdAt: new Date(Date.now() - 15 * 86_400_000), lastUsed: new Date() },
];

export default function OrganizerProfile() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { organizerSignOut } = useAuth();

  const [displayName, setDisplayName] = useState('VotainOrg');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);
  const [passkeys, setPasskeys] = useState<PasskeyEntry[]>(SEED_PASSKEYS);
  const [deleteModal, setDeleteModal] = useState<string | null>(null);
  const [signOutModal, setSignOutModal] = useState(false);

  const saveName = () => {
    setDisplayName(nameInput.trim() || displayName);
    setEditingName(false);
  };

  const removePasskey = (id: string) => {
    setPasskeys(p => p.filter(k => k.id !== id));
    setDeleteModal(null);
  };

  const addPasskey = () => {
    toast({ title: t('profile.add_passkey_pending'), description: t('common.integration_pending'), variant: 'info' });
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
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-on-surface-meta hover:text-on-surface mb-5 transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />{t('common.back')}
        </button>

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

        {/* Passkeys */}
        <Card className="p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" />
              {t('profile.passkeys')}
            </h2>
            <button
              type="button"
              onClick={addPasskey}
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('profile.add_passkey')}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {passkeys.map(pk => (
              <div key={pk.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-high/40">
                <KeyRound className="w-4 h-4 text-on-surface-meta shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-on-surface">{pk.name}</p>
                  <p className="text-xs text-on-surface-meta">
                    {t('profile.last_used')} {pk.lastUsed.toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteModal(pk.id)}
                  className="text-error hover:text-error/70 transition-colors p-1 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
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
          open={!!deleteModal}
          onClose={() => setDeleteModal(null)}
          title={t('profile.delete_passkey_title')}
          description={t('profile.delete_passkey_desc')}
        >
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setDeleteModal(null)}>{t('common.cancel')}</Button>
            <Button
              variant="default"
              className="flex-1 border-error/30 text-error hover:bg-error/10"
              onClick={() => deleteModal && removePasskey(deleteModal)}
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
