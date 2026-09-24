import { describe, expect, it } from "vitest";
import { generateRandomKeys } from "paillier-bigint";

import {
  decodeTallyProof,
  encodeTallyProof,
  finalBallots,
  proveTally,
  verifyTally,
  type FinalBallot,
} from "./tallyProof";

// Small keys keep the suite fast; the arithmetic is the same at 2048 bits.
const { publicKey, privateKey } = await generateRandomKeys(512);
const pk = { n: publicKey.n, g: publicKey.g };
const BASE = 1_000n;
const SLOTS = 4; // three options and the blank vote

const vote = (option: number): bigint => publicKey.encrypt(BASE ** BigInt(option));

function prove(ballots: FinalBallot[]) {
  return proveTally({
    publicKey: pk,
    lambda: privateKey.lambda,
    decrypt: c => privateKey.decrypt(c),
    ballots,
    slots: SLOTS,
    base: BASE,
  });
}

const ballots = (...ciphertexts: bigint[]): FinalBallot[] =>
  ciphertexts.map((ciphertext, i) => ({ nullifier: BigInt(i + 1), ciphertext }));

describe("tally proof", () => {
  it("proves an honest tally that anyone can verify without the key", () => {
    const cast = ballots(vote(0), vote(1), vote(1), vote(3));
    const tally = prove(cast);

    expect(tally.counts).toEqual([1n, 2n, 0n, 1n]);
    expect(tally.invalidBallots).toBe(0);
    expect(
      verifyTally({ publicKey: pk, ballots: cast, counts: tally.counts, invalidBallots: 0, proof: tally.proof, base: BASE }),
    ).toEqual({ ok: true, validBallots: 4, invalidBallots: 0 });
  });

  it("catches votes moved between options, which keep the total intact", () => {
    const cast = ballots(vote(0), vote(1), vote(1));
    const tally = prove(cast);
    const moved = [2n, 1n, 0n, 0n];
    const verdict = verifyTally({
      publicKey: pk, ballots: cast, counts: moved, invalidBallots: 0, proof: tally.proof, base: BASE,
    });
    expect(verdict.ok).toBe(false);
  });

  it("excludes a stuffed ballot in public instead of counting it", () => {
    // Five votes for option 0 in one ciphertext: the attack the sum alone let through.
    const stuffed = publicKey.encrypt(5n);
    const cast = ballots(vote(1), stuffed, vote(2));
    const tally = prove(cast);

    expect(tally.counts).toEqual([0n, 1n, 1n, 0n]);
    expect(tally.invalidBallots).toBe(1);
    expect(tally.proof.invalid[0].plaintext).toBe(5n);
    expect(
      verifyTally({ publicKey: pk, ballots: cast, counts: tally.counts, invalidBallots: 1, proof: tally.proof, base: BASE }).ok,
    ).toBe(true);
  });

  it("excludes a ciphertext that is not a Paillier ciphertext at all, with no opening", () => {
    const cast = ballots(vote(0), 0n, pk.n * 3n);
    const tally = prove(cast);
    expect(tally.invalidBallots).toBe(2);
    expect(tally.proof.invalid).toHaveLength(0);
    expect(
      verifyTally({ publicKey: pk, ballots: cast, counts: tally.counts, invalidBallots: 2, proof: tally.proof, base: BASE }).ok,
    ).toBe(true);
  });

  it("refuses to let an honest ballot be excluded", () => {
    const cast = ballots(vote(0), vote(1));
    const tally = prove(cast);
    const forged = {
      ...tally.proof,
      invalid: [{ nullifier: 2n, plaintext: 7n, randomness: 1n }],
    };
    expect(
      verifyTally({ publicKey: pk, ballots: cast, counts: [1n, 0n, 0n, 0n], invalidBallots: 1, proof: forged, base: BASE }).ok,
    ).toBe(false);
  });

  it("refuses an excluded count that disagrees with the proof", () => {
    const cast = ballots(vote(0));
    const tally = prove(cast);
    expect(
      verifyTally({ publicKey: pk, ballots: cast, counts: tally.counts, invalidBallots: 1, proof: tally.proof, base: BASE }).ok,
    ).toBe(false);
  });

  it("verifies an election nobody voted in", () => {
    const tally = prove([]);
    expect(tally.counts).toEqual([0n, 0n, 0n, 0n]);
    expect(
      verifyTally({ publicKey: pk, ballots: [], counts: tally.counts, invalidBallots: 0, proof: tally.proof, base: BASE }).ok,
    ).toBe(true);
  });

  it("counts only each voter's last ballot", () => {
    const events = [
      { nullifier: 9n, nonce: 0n, ciphertext: "0x" + vote(0).toString(16) },
      { nullifier: 9n, nonce: 1n, ciphertext: "0x" + vote(2).toString(16) },
    ];
    const tally = prove(finalBallots(events));
    expect(tally.counts).toEqual([0n, 0n, 1n, 0n]);
  });

  it("round-trips through the bytes publishResults carries", () => {
    const tally = prove(ballots(vote(0), publicKey.encrypt(42n)));
    expect(decodeTallyProof(encodeTallyProof(tally.proof))).toEqual(tally.proof);
    expect(() => decodeTallyProof("0x7b7d")).toThrow();
  });
});
