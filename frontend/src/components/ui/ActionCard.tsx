import * as React from 'react';
import { ArrowRight } from 'lucide-react';

interface ActionCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  title: string;
  description: string;
  ctaText: string;
  variant?: 'primary' | 'secondary';
  ariaLabel?: string;
  ctaIcon?: React.ReactNode;
}

export const ActionCard = React.forwardRef<HTMLButtonElement, ActionCardProps>(
  ({ className, icon, title, description, ctaText, variant = 'primary', ariaLabel, ctaIcon, ...props }, ref) => {
    // unify identically matching original design on larger screens, compact on mobile.
    const baseClasses = "group relative flex flex-col items-start p-3 sm:p-6 lg:p-8 rounded-2xl bg-surface-low/40 backdrop-blur-2xl border border-white/5 hover:bg-surface-low/60 active:bg-surface-low/60 outline-none transition-all duration-500 text-left overflow-visible h-full shadow-lg cursor-pointer";
    const focusClasses = variant === 'primary' 
      ? 'focus-visible:bg-surface-low/60 focus-visible:ring-2 focus-visible:ring-primary' 
      : 'focus-visible:bg-surface-low/60 focus-visible:ring-2 focus-visible:ring-secondary';

    const circleBase = "mb-2.5 sm:mb-6 w-9 h-9 sm:w-14 sm:h-14 shrink-0 rounded-full flex items-center justify-center";
    const circleVariant = variant === 'primary' ? 'bg-primary-container/20 text-primary overflow-hidden' : 'bg-secondary-container/20 text-secondary';

    return (
      <button
        ref={ref}
        aria-label={ariaLabel}
        className={`${baseClasses} ${focusClasses} ${className || ''}`}
        {...props}
      >
        <div className="absolute inset-0 rounded-2xl glass-reflection pointer-events-none opacity-0 group-hover:opacity-100 group-active:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-500"></div>       
        
        <div className={`${circleBase} ${circleVariant}`}>
          {icon}
        </div>
        
        <span className="block text-base sm:text-xl font-bold text-on-surface mb-0.5 sm:mb-1 leading-tight">
          {title}
        </span>
        <p className="text-on-surface-variant mb-2.5 sm:mb-6 text-[0.7rem] sm:text-sm leading-[1.4] sm:leading-relaxed">
          {description}
        </p>
        
        <div className={`mt-auto flex items-center font-bold tracking-wider text-[0.6rem] sm:text-xs uppercase pt-0.5 sm:pt-1 ${variant === 'primary' ? 'text-primary' : 'text-secondary'}`}>
          {ctaText}
          {ctaIcon ? (
            <span className="ml-[1.5ex] flex items-center justify-center w-[1.2em] h-[1.2em]">
              {ctaIcon}
            </span>
          ) : (
            <ArrowRight className="ml-[1.5ex] w-[1.2em] h-[1.2em]" />
          )}
        </div>
      </button>
    );
  }
);

ActionCard.displayName = 'ActionCard';
