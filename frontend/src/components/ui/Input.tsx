import * as React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, leftIcon, rightIcon, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-on-surface-variant">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="absolute left-3.5 text-on-surface-meta pointer-events-none">{leftIcon}</span>
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn(
              'w-full h-11 rounded-xl bg-surface-lowest/60 border border-outline-variant/20 text-on-surface placeholder:text-on-surface-meta',
              'px-4 py-2.5 text-sm',
              'transition-all duration-200',
              'focus:outline-none focus:border-primary/60 focus:bg-surface-lowest/80 focus:shadow-[0_0_0_3px_rgba(79,142,247,0.15)]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              leftIcon  && 'pl-10',
              rightIcon && 'pr-10',
              error && 'border-error/60 focus:border-error/80 focus:shadow-[0_0_0_3px_rgba(255,180,171,0.15)]',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3.5 text-on-surface-meta pointer-events-none">{rightIcon}</span>
          )}
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
        {!error && hint && <p className="text-xs text-on-surface-meta">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, hint, error, id, ...props }, ref) => {
    const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={textareaId} className="text-sm font-medium text-on-surface-variant">
            {label}
          </label>
        )}
        <textarea
          id={textareaId}
          ref={ref}
          className={cn(
            'w-full min-h-24 rounded-xl bg-surface-lowest/60 border border-outline-variant/20 text-on-surface placeholder:text-on-surface-meta',
            'px-4 py-3 text-sm resize-y',
            'transition-all duration-200',
            'focus:outline-none focus:border-primary/60 focus:bg-surface-lowest/80 focus:shadow-[0_0_0_3px_rgba(79,142,247,0.15)]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            error && 'border-error/60',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-error">{error}</p>}
        {!error && hint && <p className="text-xs text-on-surface-meta">{hint}</p>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, hint, error, placeholder, options, id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-on-surface-variant">
            {label}
          </label>
        )}
        <select
          id={selectId}
          ref={ref}
          className={cn(
            'w-full h-11 rounded-xl bg-surface-lowest/60 border border-outline-variant/20 text-on-surface',
            'px-4 py-2.5 text-sm appearance-none cursor-pointer',
            'transition-all duration-200',
            'focus:outline-none focus:border-primary/60 focus:shadow-[0_0_0_3px_rgba(79,142,247,0.15)]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            error && 'border-error/60',
            className
          )}
          {...props}
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options.map(opt => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
          ))}
        </select>
        {error && <p className="text-xs text-error">{error}</p>}
        {!error && hint && <p className="text-xs text-on-surface-meta">{hint}</p>}
      </div>
    );
  }
);
Select.displayName = 'Select';
