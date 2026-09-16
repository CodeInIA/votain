import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { rememberReturnTo } from '../../lib/returnTo';

export function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <header className="relative z-20 w-full px-5 py-4 sm:px-8 flex items-center justify-between backdrop-blur-lg border-b border-white/5 bg-background/40">
      <Button 
        variant="ghost"
        onClick={() => navigate('/')}
        className="flex items-center gap-3 hover:bg-transparent hover:opacity-80 transition-opacity px-0 focus-visible:ring-0 cursor-pointer"
      >
        <img alt="Votain Logo" className="w-12 h-12 object-contain shrink-0" src="/votain-logo.webp" />
        <img alt="Votain Wordmark" className="h-5 sm:h-6 object-contain shrink-0 translate-y-0.5" src="/votain-wordmark.svg" />
      </Button>
      
      {/* Voter Login Area */}
      <div className="flex items-center">
        <Button 
          variant="default" 
          // Remembers the page first, so signing in from here comes back
          // to it. The election's own "verify to vote" did this already and
          // this button did not, which meant the same sign in ended in two
          // different places depending on which control started it.
          onClick={() => {
            rememberReturnTo(location.pathname + location.search);
            navigate('/voter/signin');
          }}
          className="flex items-center gap-2 rounded-full border-white/10 hover:bg-white/10 px-7 h-10 text-sm font-medium bg-transparent"
        >
          {t('landing.login', 'Log in')}
        </Button>
      </div>
    </header>
  );
}
