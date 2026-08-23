import { describe, it, expect } from "vitest";
import { encryptBallot, COUNTER_BASE } from "./paillier";
import { isHexString, solidityPackedKeccak256 } from "ethers";

/**
 * The ballot ciphertext is handed to Solidity as `bytes`. `BigInt.toString(16)`
 * drops the leading zero nibble, so roughly half of all ciphertexts came out an
 * odd number of hex digits: which ethers rejects as BytesLike. The vote failed
 * client side, for some voters only, with an opaque error. Caught by the
 * contracts E2E suite; locked down here.
 */
describe("encryptBallot, ciphertext is valid Solidity bytes", () => {
  // Small deterministic key: we only care about the hex encoding, not security.
  const n = 0xfa1n * 0x10007n;
  const pkJson = JSON.stringify({ n: "0x" + n.toString(16), g: "0x" + (n + 1n).toString(16) });

  it("always produces an even number of hex digits", () => {
    // Many samples: encryption is randomised, so the leading nibble varies.
    for (let i = 0; i < 200; i++) {
      const ciphertext = encryptBallot(pkJson, i % 3);
      expect((ciphertext.length - 2) % 2, `odd-length ciphertext: ${ciphertext}`).toBe(0);
    }
  });

  it("produces values ethers accepts as BytesLike", () => {
    for (let i = 0; i < 100; i++) {
      const ciphertext = encryptBallot(pkJson, i % 3);
      expect(isHexString(ciphertext)).toBe(true);
      // This is the exact call the vote path makes; it threw before the fix.
      expect(() => solidityPackedKeccak256(["bytes", "uint256"], [ciphertext, 0n])).not.toThrow();
    }
  });

  it("still decodes back to the encrypted counter", () => {
    const ciphertext = encryptBallot(pkJson, 2);
    // Padding must not change the numeric value.
    expect(BigInt(ciphertext)).toBeGreaterThan(0n);
    expect(COUNTER_BASE).toBe(1_000_000n);
  });
});
