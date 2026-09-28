/**
 * Error text, once.
 *
 * `errorMessage` is for this server's own log. `chainFailure` is what a client
 * is told when a transaction fails, and it says less on purpose: an ethers
 * error carries the RPC URL, the raw request and the provider's own wording,
 * none of which a browser needs. What the browser does need is the NAME of the
 * revert, or its four-byte selector, because that is what `revertNameOf` in
 * the frontend turns into a sentence the voter can act on.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface EthersLikeError {
  code?: string;
  data?: unknown;
  revert?: { name?: string } | null;
  info?: { error?: { data?: unknown } };
}

export function chainFailure(error: unknown): string {
  const err = (error ?? {}) as EthersLikeError;
  if (typeof err.revert?.name === 'string' && err.revert.name) return `reverted: ${err.revert.name}`;

  const data = typeof err.data === 'string' ? err.data : err.info?.error?.data;
  if (typeof data === 'string' && /^0x[0-9a-fA-F]{8}/.test(data)) {
    return `reverted: data="${data.slice(0, 10).toLowerCase()}"`;
  }
  if (err.code === 'INSUFFICIENT_FUNDS') return 'the relayer is out of funds';
  if (err.code === 'CALL_EXCEPTION') return 'reverted';
  return 'transaction failed';
}

/**
 * A message safe to hand a client: this server's own words as they are, and
 * anything raised by ethers or the RPC reduced to `chainFailure`, since those
 * can carry the RPC endpoint and its API key.
 */
export function clientMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z_]+$/.test(code)) return chainFailure(error);
  return errorMessage(error);
}
