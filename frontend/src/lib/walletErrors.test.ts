import { describe, it, expect } from 'vitest';
import { isUserRejection } from './walletErrors';
import { WalletSignatureRefusedError } from './organizerKey';

/**
 * One fact with four spellings, because it arrives from four places.
 *
 * Getting this wrong is not cosmetic. A refusal reported as a failure hands
 * somebody a red box quoting `action="sendTransaction", reason="rejected"`
 * about a decision they made on purpose, and the ones that matter most are the
 * ones where a person hesitated and backed out.
 */
describe('isUserRejection', () => {
  it('recognises EIP-1193 4001, which is what a wallet actually sends', () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
  });

  it('recognises the way ethers rewrites it', () => {
    expect(isUserRejection({ code: 'ACTION_REJECTED' })).toBe(true);
  });

  it('recognises it nested, which is how it arrives over WalletConnect', () => {
    expect(isUserRejection({ code: -32000, error: { code: 4001 } })).toBe(true);
  });

  it('recognises a refused signature, raised where the tally key is derived', () => {
    expect(isUserRejection(new WalletSignatureRefusedError())).toBe(true);
  });

  it('leaves a real failure alone, which is the whole point of telling them apart', () => {
    expect(isUserRejection(new Error('insufficient funds for gas'))).toBe(false);
    expect(isUserRejection({ code: -32603 })).toBe(false);
    expect(isUserRejection(undefined)).toBe(false);
    expect(isUserRejection(null)).toBe(false);
    expect(isUserRejection('rejected')).toBe(false);
  });
});
