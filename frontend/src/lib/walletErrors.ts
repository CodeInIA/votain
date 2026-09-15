import { WalletSignatureRefusedError } from './organizerKey';

/**
 * Someone declining a wallet prompt, as opposed to something going wrong.
 *
 * Told apart because the two deserve opposite treatment. A failure needs an
 * explanation, and the uglier the better if it helps somebody debug it. A
 * refusal needs almost nothing: the person did it on purpose, they know what
 * they did, and answering with a red box full of `action="sendTransaction",
 * reason="rejected", code=ACTION_REJECTED` tells them their own decision was a
 * malfunction.
 *
 * Three spellings for one fact, because it arrives from three places. EIP-1193
 * says 4001; ethers wraps that as ACTION_REJECTED; a wallet reached over
 * WalletConnect may nest the original inside `error`. `WalletSignatureRefusedError`
 * is the same fact again, raised where the tally key is derived, which is the
 * one refusal that is neither a transaction nor a connection.
 */
export function isUserRejection(e: unknown): boolean {
  if (e instanceof WalletSignatureRefusedError) return true;
  const err = e as { code?: number | string; error?: { code?: number } };
  return err?.code === 4001 || err?.code === 'ACTION_REJECTED' || err?.error?.code === 4001;
}
