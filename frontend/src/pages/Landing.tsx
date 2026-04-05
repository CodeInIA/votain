import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export default function Landing() {
  return (
    <div className="relative h-dvh bg-background text-on-surface font-body selection:bg-primary selection:text-white overflow-hidden">
      
      {/* Liquid Background Atmosphere */}
      <div className="fixed inset-0 z-0 pointer-events-none liquid-mesh" />
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[150px] rounded-full" />

      {/* Decorative Visual Asset */}
      <div className="fixed inset-0 z-0 w-full h-full opacity-20 pointer-events-none mix-blend-screen">
        <div 
          className="w-full h-full bg-cover bg-center bg-no-repeat" 
          style={{ backgroundImage: "url('/landing-background.jpg')" }}
        />
      </div>

      {/* Content Wrapper */}
      <div className="relative z-10 flex flex-col h-full">
        
        {/* Splash Content */}
        <main className="grow flex flex-col items-center justify-center px-4 py-4 min-h-0">
          
          {/* Brand Anchor Section */}
          <header className="text-center mb-6 md:mb-10">
            <div className="inline-flex items-center justify-center p-2 mb-3 md:mb-6">
              <div className="w-20 h-20 md:w-24 md:h-24 bg-linear-to-br from-primary to-secondary p-px rounded-2xl">
                <div className="w-full h-full bg-surface-lowest rounded-[15px] flex items-center justify-center">
                  <img 
                    alt="Votain Logo" 
                    className="w-12 h-12 md:w-16 md:h-16 object-contain drop-shadow-[0_0_15px_rgba(79,142,247,0.5)]" 
                    src="/votain-logo.png"
                  />
                </div>
              </div>
            </div>
            <h1 className="text-4xl md:text-7xl font-black tracking-tighter text-on-surface mb-1 md:mb-3">Votain</h1>
            <p className="text-base md:text-xl text-on-surface-variant font-medium tracking-tight">Private. Verifiable. Yours.</p>
          </header>

          {/* Path Selection Grid (Bento Style) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-5 w-full max-w-4xl">
            
            {/* Voter Path */}
            <button 
              aria-label="I want to vote: Join an existing election using your World ID"
              className="group relative flex flex-col items-start p-5 md:p-6 rounded-2xl bg-surface-low/40 backdrop-blur-2xl border border-white/5 hover:bg-surface-low/60 focus-visible:bg-surface-low/60 focus-visible:ring-2 focus-visible:ring-primary outline-none transition-all duration-500 text-left overflow-hidden min-h-40 md:min-h-55"
            >
              <div className="absolute inset-0 glass-reflection pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-500"></div>       
              <div className="mb-3 md:mb-5 w-10 h-10 md:w-14 md:h-14 bg-primary-container/20 rounded-full flex items-center justify-center group-hover:scale-110 group-focus-visible:scale-110 transition-transform duration-500 overflow-hidden">
                <img alt="" aria-hidden="true" className="w-5 h-5 md:w-8 md:h-8 object-contain" style={{ filter: "invert(1) brightness(200%)" }} src="/world-id-logo.svg" />   
              </div>
              <span className="block text-lg md:text-2xl font-bold text-on-surface mb-1 md:mb-2">I want to vote</span>
              <p className="text-on-surface-variant mb-3 md:mb-5 text-xs md:text-base max-w-50 md:max-w-60">Join an existing election using your World ID for biometric privacy.</p>
              <div className="mt-auto flex items-center text-primary font-bold tracking-wider text-[10px] md:text-xs uppercase">
                Get Started
                <ArrowRight className="ml-2 w-3 h-3 md:w-4 md:h-4" />
              </div>
            </button>

            {/* Organizer Path */}
            <button 
              aria-label="I am an organizer: Create secure decentralized ballots"
              className="group relative flex flex-col items-start p-5 md:p-6 rounded-2xl bg-surface-low/40 backdrop-blur-2xl border border-white/5 hover:bg-surface-low/60 focus-visible:bg-surface-low/60 focus-visible:ring-2 focus-visible:ring-secondary outline-none transition-all duration-500 text-left overflow-hidden min-h-40 md:min-h-55"
            >
              <div className="absolute inset-0 glass-reflection pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-500"></div>       
              <div className="mb-3 md:mb-5 w-10 h-10 md:w-14 md:h-14 bg-secondary-container/20 rounded-full flex justify-center items-center text-secondary group-hover:scale-110 group-focus-visible:scale-110 transition-transform duration-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 md:w-8 md:h-8" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <span className="block text-lg md:text-2xl font-bold text-on-surface mb-1 md:mb-2">I'm an organizer</span>       
              <p className="text-on-surface-variant mb-3 md:mb-5 text-xs md:text-base max-w-50 md:max-w-60">Create secure, decentralized ballots secured by cryptographic passkeys.</p>
              <div className="mt-auto flex items-center text-secondary font-bold tracking-wider text-[10px] md:text-xs uppercase">
                Create Election
                <ArrowRight className="ml-2 w-3 h-3 md:w-4 md:h-4" />
              </div>
            </button>
          </div>

          {/* Secondary Actions */}
          <div className="mt-6 md:mt-10 flex flex-col items-center gap-3 md:gap-5">
            <Link to="/discover" className="px-6 md:px-8 py-2 md:py-3 text-sm md:text-base rounded-full bg-surface-high/40 text-on-surface font-medium backdrop-blur-xl border border-outline-variant/10 hover:bg-surface-high/60 focus-visible:ring-2 focus-visible:ring-primary outline-none transition-all cursor-pointer text-center">
              Browse elections
            </Link>
            <Link to="/how-it-works" className="text-on-surface-variant hover:text-primary focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background outline-none rounded-sm text-[11px] md:text-sm font-medium transition-colors flex items-center gap-2">
              How it works
            </Link>
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-slate-950/40 backdrop-blur-md w-full py-3 md:py-6 mt-auto border-t border-white/5">
          <div className="flex flex-col md:flex-row justify-between items-center px-8 max-w-7xl mx-auto gap-4">
            <div className="text-slate-400 font-bold tracking-tight">Votain Protocol</div>      
            <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 text-slate-500 text-xs">     
              <a className="hover:text-slate-200 focus-visible:text-slate-200 outline-none focus-visible:underline transition-colors" href="#">Terms</a>
              <a className="hover:text-slate-200 focus-visible:text-slate-200 outline-none focus-visible:underline transition-colors" href="#">Privacy</a>
              <a className="hover:text-slate-200 focus-visible:text-slate-200 outline-none focus-visible:underline transition-colors" href="#">Language</a>
            </div>
            <div className="text-slate-500 text-xs text-center">
              © 2026 Votain Protocol
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}