import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Definir las variantes del botón para mantener la cohesión de diseño
export const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-sm font-medium transition-colors focus-visible:outline-none cursor-pointer disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-surface-high/40 text-on-surface backdrop-blur-xl border border-outline-variant/10 hover:bg-surface-high/60 focus-visible:ring-2 focus-visible:ring-primary rounded-full",
        ghost:
          "text-on-surface-variant hover:text-primary focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background",
        primary:
          "bg-primary text-white hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        secondary:
          "bg-secondary text-white hover:bg-secondary/90 focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
        responsive: "px-[clamp(1.5rem,4vmin,2rem)] py-[clamp(0.5rem,1.5dvh,0.75rem)] text-[clamp(0.875rem,2vmin,1rem)]",
        responsiveSm: "text-[clamp(0.65rem,1.5vmin,0.875rem)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
