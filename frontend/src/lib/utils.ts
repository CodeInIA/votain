import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
/**
 * Shortens a vote reference for display, keeping both ends.
 *
 * A reference is a 32-byte nullifier rendered as hex: one unbroken token with no
 * spaces, so it never wraps on its own and runs straight off a phone screen.
 * Both ends are kept because that is what someone compares against when they
 * check a receipt.
 *
 * Only ever for DISPLAY. Whatever offers this to the user must copy or verify
 * the full value, never this.
 */
export function shortenReference(reference: string): string {
  return reference.length > 24
    ? `${reference.slice(0, 12)}…${reference.slice(-8)}`
    : reference;
}
