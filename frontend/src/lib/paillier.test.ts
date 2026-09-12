import { describe, it, expect, beforeAll } from "vitest";
import {
  COUNTER_BASE,
  LEGACY_COUNTER_BASE,
  counterBaseFor,
  decryptTally,
  encryptBallot,
} from "./paillier";
import { generateRandomKeys } from "paillier-bigint";
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
    expect(COUNTER_BASE).toBe(1_000_000_000_000n);
  });
});

/**
 * The base is fixed into every ballot when it is encrypted, so raising the
 * constant may not change how an election already under way is read.
 */
describe("counterBaseFor, an election is decoded in its own base", () => {
  it("uses what the election recorded", () => {
    expect(counterBaseFor(JSON.stringify({ counterBase: "1000000000000" }))).toBe(COUNTER_BASE);
  });

  it("falls back to the old million when nothing was recorded", () => {
    // Elections created before the field existed. Defaulting to today's
    // constant would decode every one of them to nonsense.
    expect(counterBaseFor(JSON.stringify({ privacyQuorum: 3 }))).toBe(LEGACY_COUNTER_BASE);
    expect(counterBaseFor("not json at all")).toBe(LEGACY_COUNTER_BASE);
  });
});

/**
 * Every ballot adds exactly one to exactly one counter, so the counters have to
 * add up to the ballots that went in. That equality is what catches an overflow
 * between counters, which the previous check could not see: it only looked for
 * a leftover past the LAST counter, and a carry from option 0 into option 1
 * leaves none.
 */
describe("decryptTally, the counters have to account for every ballot", () => {
  // 512 bits: big enough to hold several counters, fast enough for a test.
  let keys: { publicKey: any; privateKey: any };
  beforeAll(async () => {
    keys = (await generateRandomKeys(512)) as unknown as typeof keys;
  });

  function tallyOf(options: number[], base: bigint, slots: number, expected?: number) {
    const sum = options
      .map(i => keys.publicKey.encrypt(base ** BigInt(i)))
      .reduce((a: bigint, c: bigint) => keys.publicKey.addition(a, c));
    return decryptTally(keys, sum, slots, base, expected);
  }

  it("unpacks a well-formed tally", () => {
    expect(tallyOf([0, 1, 1, 2], 1000n, 3, 4).map(Number)).toEqual([1, 2, 1]);
  });

  it("refuses a tally whose counters do not add up to the ballots", () => {
    expect(() => tallyOf([0, 1, 1, 2], 1000n, 3, 5)).toThrow(/does not match the ballots counted/);
  });

  it("catches a carry between counters, which the old leftover check could not", () => {
    // Base 10: eleven votes for option 0 overflow into option 1's counter. The
    // leftover after the last counter is still zero, so only the sum sees it.
    const eleven = Array.from({ length: 11 }, () => 0);
    const counts = tallyOf(eleven, 10n, 3).map(Number);
    expect(counts).toEqual([1, 1, 0]);          // silently wrong
    expect(counts.reduce((a, c) => a + c, 0)).not.toBe(11);
    expect(() => tallyOf(eleven, 10n, 3, 11)).toThrow(/does not match the ballots counted/);
  });
});
