import type { ReactNode } from 'react';
import { TopNav } from './TopNav';
import { NavFitProvider, useNavFit } from './navFit';
import { BottomTabNav } from './BottomTabNav';
import { Footer } from './Footer';
import { DemoDataBanner } from './DemoDataBanner';
import { cn } from '../../lib/utils';

interface PageLayoutProps {
  children: ReactNode;
  role?: 'voter' | 'organizer' | 'public';
  showNav?: boolean;
  showFooter?: boolean;
  className?: string;
  fullBleed?: boolean;
}

/**
 * Wrapped so everything inside can read one answer to "do the links fit".
 *
 * The provider has to sit above `TopNav`, which measures, and above the
 * content, which contains the card of links that stands in for the footer.
 */
export function PageLayout(props: PageLayoutProps) {
  return (
    <NavFitProvider>
      <PageShell {...props} />
    </NavFitProvider>
  );
}

function PageShell({
  children,
  role = 'public',
  showNav = true,
  showFooter = true,
  className,
  fullBleed = false,
}: PageLayoutProps) {
  const { compact } = useNavFit();
  return (
    <div className="relative flex flex-col h-dvh bg-background text-on-surface font-body overflow-x-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 z-0 pointer-events-none liquid-mesh" />
      <div className="fixed top-[-10%] left-[-10%] w-[45%] h-[45%] bg-primary/8 blur-[140px] rounded-full pointer-events-none" />
      <div className="fixed bottom-[-15%] right-[-15%] w-[55%] h-[55%] bg-secondary/8 blur-[160px] rounded-full pointer-events-none" />
      <div className="fixed inset-0 z-0 w-full h-full opacity-10 pointer-events-none mix-blend-screen">
        <div className="w-full h-full bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/landing-background.webp')" }} />
      </div>

      <DemoDataBanner />

      {showNav && <TopNav />}

      <main
        className={cn(
          'relative z-10 flex-1 overflow-y-auto',
          !fullBleed && 'px-4 sm:px-6 lg:px-8',
          // Room for the fixed bottom bar, for exactly as long as there is
          // one. Measured, not assumed: see `navFit`.
          role !== 'public' && (compact ? 'pb-20' : 'pb-4'),
          className
        )}
      >
        {children}
      </main>

      {/* The footer follows the same answer: when the bottom bar is out, it
          owns that edge of the screen and `SiteLinksCard` carries these links
          instead. */}
      {showFooter && !compact && <div className="shrink-0"><Footer /></div>}
      {showNav && <BottomTabNav />}
    </div>
  );
}
