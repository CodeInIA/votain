/**
 * The organizer's wallet, with the fee this page proposes kept sane.
 *
 * WHY. ethers fills `maxPriorityFeePerGas` from `eth_maxPriorityFeePerGas`, and
 * on Amoy that answer follows the handful of bots in otherwise empty blocks:
 * 279 gwei, when a 30 gwei tip is included just as fast. The wallet shows what
 * the page proposes as "site suggested", so deploying one election (about five
 * million gas) was offered at 1.4 POL instead of 0.25. The organizer can still
 * raise it in their wallet; this only stops the page from proposing the spike.
 *
 * 50 gwei, the ceiling `ElectionPaymaster` reimburses a relayer at, and the one
 * the backend applies to its own transactions (`backend/src/chain/signer.ts`).
 */
import { BrowserProvider, FeeData, parseUnits } from "ethers";

const MAX_TIP = parseUnits(
  (import.meta.env.VITE_MAX_TIP_GWEI as string | undefined)?.trim() || "50",
  "gwei",
);

export class WalletProvider extends BrowserProvider {
  override async getFeeData(): Promise<FeeData> {
    const suggested = await super.getFeeData();
    const tip = suggested.maxPriorityFeePerGas;
    if (tip === null || tip <= MAX_TIP) return suggested;
    const block = await this.getBlock("latest");
    const base = block?.baseFeePerGas ?? 0n;
    return new FeeData(
      suggested.gasPrice !== null && suggested.gasPrice > base + MAX_TIP ? base + MAX_TIP : suggested.gasPrice,
      base * 2n + MAX_TIP,
      MAX_TIP,
    );
  }
}
