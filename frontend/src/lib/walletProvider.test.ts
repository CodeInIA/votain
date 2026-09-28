/**
 * The fee the page proposes to the organizer's wallet. Amoy's suggestion
 * follows a few bots at 279 gwei, which offered one election's deployment at
 * 1.4 POL instead of 0.25; a normal suggestion must pass through untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserProvider, FeeData } from 'ethers';
import { WalletProvider } from './walletProvider';

const gwei = (n: number) => BigInt(n) * 1_000_000_000n;
const eth = { request: async () => '0x13882' };

function stubChain(tip: bigint, base: bigint) {
  vi.spyOn(BrowserProvider.prototype, 'getFeeData').mockResolvedValue(new FeeData(base + tip, base * 2n + tip, tip));
  vi.spyOn(BrowserProvider.prototype, 'getBlock').mockResolvedValue({ baseFeePerGas: base } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WalletProvider.getFeeData', () => {
  it('caps a spiked tip at 50 gwei', async () => {
    stubChain(gwei(279), 3n);
    const fees = await new WalletProvider(eth).getFeeData();
    expect(fees.maxPriorityFeePerGas).toBe(gwei(50));
    expect(fees.maxFeePerGas).toBe(6n + gwei(50));
    expect(fees.gasPrice).toBe(3n + gwei(50));
  });

  it('leaves a normal suggestion alone', async () => {
    stubChain(gwei(30), 5n);
    const fees = await new WalletProvider(eth).getFeeData();
    expect(fees.maxPriorityFeePerGas).toBe(gwei(30));
    expect(fees.maxFeePerGas).toBe(10n + gwei(30));
  });
});
