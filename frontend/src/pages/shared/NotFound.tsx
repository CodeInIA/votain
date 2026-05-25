import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';

export default function NotFound() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <PageLayout role="public" showNav>
      <div className="flex flex-col items-center justify-center min-h-[80vh] text-center gap-4">
        <span className="text-6xl">🔍</span>
        <h1 className="text-3xl font-black text-white">{t('errors.not_found')}</h1>
        <p className="text-on-surface-variant text-sm max-w-xs">{t('errors.not_found_desc')}</p>
        <Button variant="gradient" className="rounded-full mt-2" onClick={() => navigate('/')}>
          {t('errors.go_home')}
        </Button>
      </div>
    </PageLayout>
  );
}
