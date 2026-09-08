/**
 * The organizer's way in, offered from the voter screens.
 *
 * The header's Log in button means "voter", which is right for almost everyone
 * who taps it and leaves an organizer arriving from Discover with no door at
 * all. Subtle rather than a second button of equal weight, because two buttons
 * would claim two equal audiences and they are not.
 *
 * A component and not two copies of a paragraph: the World ID step exists twice,
 * once in `WorldIdVerify` and once inside the onboarding flow, and the link was
 * added to only one of them. Anything written twice drifts, and this had already
 * started to.
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';

export function OrganizerEntryHint({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <p className={cn('text-center text-xs text-on-surface-meta', className)}>
      {t('landing.are_you_organizer')}{' '}
      <Link
        to="/organizer/auth"
        className="text-primary-dim font-semibold underline underline-offset-4 hover:text-primary"
      >
        {t('org_auth.enter_here')}
      </Link>
    </p>
  );
}
