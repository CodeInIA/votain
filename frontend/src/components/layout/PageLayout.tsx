import type { ReactNode } from 'react';
import { TopNav } from './TopNav';
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

export function PageLayout({
  children,
  role = 'public',
  showNav = true,
  showFooter = true,
  className,
  fullBleed = false,
}: PageLayoutProps) {
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
          role !== 'public' && 'pb-20 md:pb-4',
          className
        )}
      >
        {children}
      </main>

      {showFooter && <div className="hidden md:block shrink-0"><Footer /></div>}
      {showNav && <BottomTabNav />}
    </div>
  );
}
