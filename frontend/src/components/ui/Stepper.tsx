import { Fragment } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Step {
  label: string;
  description?: string;
}

interface StepperProps {
  steps: Step[];
  current: number;
  className?: string;
}

export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <nav aria-label="Progress" className={cn('flex items-center gap-0', className)}>
      {steps.map((step, i) => {
        const done   = i < current;
        const active = i === current;
        return (
          <Fragment key={step.label}>
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300',
                done   && 'bg-primary text-background',
                active && 'bg-primary/20 text-primary ring-2 ring-primary/40',
                !done && !active && 'bg-surface-high text-on-surface-meta'
              )}>
                {done ? <Check className="w-4 h-4" strokeWidth={2.5} /> : <span>{i + 1}</span>}
              </div>
              <span className={cn(
                'text-xs font-medium hidden sm:block',
                active ? 'text-on-surface' : 'text-on-surface-meta'
              )}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn(
                'h-px flex-1 mx-2 transition-all duration-300',
                i < current ? 'bg-primary/60' : 'bg-outline-variant/30'
              )} />
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

interface OverlayStepProps {
  label: string;
  status: 'pending' | 'active' | 'done';
}

interface OverlayStepperProps {
  steps: OverlayStepProps[];
  className?: string;
}

export function OverlayStepper({ steps, className }: OverlayStepperProps) {
  return (
    <div className={cn('flex flex-col gap-4 w-full max-w-xs', className)}>
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-400',
            step.status === 'done'   && 'bg-green-500/20 text-green-400',
            step.status === 'active' && 'bg-primary/20 text-primary',
            step.status === 'pending' && 'bg-surface-high text-on-surface-meta'
          )}>
            {step.status === 'done' ? (
              <Check className="w-5 h-5" strokeWidth={2.5} />
            ) : step.status === 'active' ? (
              <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            ) : (
              <div className="w-2.5 h-2.5 rounded-full bg-outline-variant" />
            )}
          </div>
          <span className={cn(
            'text-sm font-medium',
            step.status === 'done'   && 'text-green-400',
            step.status === 'active' && 'text-on-surface',
            step.status === 'pending' && 'text-on-surface-meta'
          )}>
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
