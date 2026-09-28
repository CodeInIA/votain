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

/**
 * `items.map(fn)` with at most `limit` calls in flight, results in input order.
 *
 * For reads fanned out over every election: one at a time made a history
 * screen wait for the sum of every round trip, and all at once would hit a free
 * RPC endpoint with hundreds of requests in the same instant.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
