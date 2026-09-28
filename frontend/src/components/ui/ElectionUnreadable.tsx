import { useTranslation } from 'react-i18next';
import { PageLayout } from '../layout/PageLayout';
import { Button } from './Button';

interface ElectionUnreadableProps {
  role: 'voter' | 'organizer' | 'public';
  onRetry: () => void;
  onBack: () => void;
}

/**
 * The chain did not answer for this election.
 *
 * Its own screen rather than the "not found" one every election page fell back
 * to: a dropped connection is not a missing election, and saying it was sent a
 * voter away from one that exists, or left them on a blank page.
 */
export function ElectionUnreadable({ role, onRetry, onBack }: ElectionUnreadableProps) {
  const { t } = useTranslation();
  return (
    <PageLayout role={role} showNav>
      <div role="alert" className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4 max-w-md mx-auto">
        <p className="text-on-surface">{t('errors.election_unreadable')}</p>
        <div className="flex gap-2">
          <Button onClick={onRetry}>{t('common.retry')}</Button>
          <Button variant="ghost" onClick={onBack}>{t('common.back')}</Button>
        </div>
      </div>
    </PageLayout>
  );
}
