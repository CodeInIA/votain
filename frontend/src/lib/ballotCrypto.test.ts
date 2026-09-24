import { describe, expect, it } from "vitest";
import { Base8, addPoint, mulPointEscalar } from "@zk-kit/baby-jubjub";

import {
  BASE,
  IDENTITY,
  add,
  aggregate,
  deriveTallyKeys,
  decryptTally,
  discreteLog,
  encryptCancellation,
  encryptVote,
  equals,
  isInSubgroup,
  multiply,
  randomScalar,
  type Ballot,
  type Point,
} from "./ballotCrypto";

const SLOTS = 4; // three options and the blank vote
const keysFor = (seed: string) => deriveTallyKeys(new TextEncoder().encode(seed.padEnd(32, "x")), "0x01", SLOTS);

/** A voter's chain of ballots, exactly as a client builds it. */
function chain(keys: readonly Point[], choices: number[]): Ballot[] {
  const out: Ballot[] = [];
  let previous: { a: Point; b: Point[] } | null = null;
  choices.forEach((choice, k) => {
    const vote = encryptVote(keys, choice, randomScalar());
    const cancel = encryptCancellation(keys, randomScalar(), previous);
    out.push({ tag: BigInt(k), voteA: vote.a, voteB: vote.b, cancelA: cancel.a, cancelB: cancel.b });
    previous = vote;
  });
  return out;
}

describe("Baby Jubjub arithmetic", () => {
  it("agrees with the reference implementation the circuit is checked against", () => {
    expect(BASE).toEqual(Base8);
    const k = 123456789n;
    expect(multiply(BASE, k)).toEqual(mulPointEscalar(Base8, k));
    const p = multiply(BASE, 7n);
    const q = multiply(BASE, 11n);
    expect(add(p, q)).toEqual(addPoint(p as [bigint, bigint], q as [bigint, bigint]));
  });

  it("has the identity as a neutral element and a generator of the prime subgroup", () => {
    expect(add(BASE, IDENTITY)).toEqual(BASE);
    expect(isInSubgroup(BASE)).toBe(true);
  });

  it("recovers small discrete logs and refuses ones past the bound", () => {
    expect(discreteLog(multiply(BASE, 0n), 10)).toBe(0n);
    expect(discreteLog(multiply(BASE, 37n), 100)).toBe(37n);
    expect(discreteLog(multiply(BASE, 101n), 100)).toBeNull();
  });
});

describe("ballots that cancel their predecessor", () => {
  it("add up to each voter's LAST choice, with nothing linking the steps", async () => {
    const { secrets, keys } = await keysFor("organizer");
    const ballots = [
      ...chain(keys, [0]), // one vote for option 0
      ...chain(keys, [2, 1]), // voted 2, then changed to 1
      ...chain(keys, [1, 1, 3]), // 1, 1, then the blank vote
    ];
    expect(decryptTally(secrets, aggregate(ballots, SLOTS), ballots.length)).toEqual([1n, 1n, 0n, 1n]);
  });

  it("makes a first ballot and a re-vote look alike: both carry a cancellation", async () => {
    const { keys } = await keysFor("organizer");
    const [first] = chain(keys, [0]);
    const [, second] = chain(keys, [0, 1]);
    for (const ballot of [first, second]) {
      expect(equals(ballot.cancelA, IDENTITY)).toBe(false);
      expect(ballot.cancelB.every(p => !equals(p, IDENTITY))).toBe(true);
    }
  });

  it("does not let a cancellation be found by negating a previous vote", async () => {
    const { keys } = await keysFor("organizer");
    const [first, second] = chain(keys, [0, 1]);
    // Re-randomised: -A_prev alone is not what the chain shows.
    expect(equals(add(second.cancelA, first.voteA), IDENTITY)).toBe(false);
  });
});

describe("decrypting the tally", () => {
  it("recovers the counts from the aggregate", async () => {
    const { secrets, keys } = await keysFor("organizer");
    const ballots = [...chain(keys, [0]), ...chain(keys, [2, 0]), ...chain(keys, [3])];
    expect(decryptTally(secrets, aggregate(ballots, SLOTS), ballots.length)).toEqual([2n, 0n, 0n, 1n]);
  });

  it("counts an election nobody voted in as zero everywhere", async () => {
    const { secrets } = await keysFor("organizer");
    expect(decryptTally(secrets, aggregate([], SLOTS), 0)).toEqual([0n, 0n, 0n, 0n]);
  });

  it("refuses a key that does not belong to the ballots", async () => {
    const { keys } = await keysFor("organizer");
    const other = await keysFor("somebody-else");
    const ballots = chain(keys, [1]);
    expect(() => decryptTally(other.secrets, aggregate(ballots, SLOTS), ballots.length)).toThrow();
  });
});

describe("tally keys", () => {
  it("are the same every time from the same secret and nonce", async () => {
    const a = await keysFor("organizer");
    const b = await keysFor("organizer");
    expect(a.keys).toEqual(b.keys);
    expect(a.keys.every(isInSubgroup)).toBe(true);
    expect(new Set(a.secrets).size).toBe(SLOTS);
  });

  it("differ for another organizer or another election", async () => {
    const a = await keysFor("organizer");
    const b = await keysFor("somebody-else");
    const c = await deriveTallyKeys(new TextEncoder().encode("organizer".padEnd(32, "x")), "0x02", SLOTS);
    expect(a.keys[0]).not.toEqual(b.keys[0]);
    expect(a.keys[0]).not.toEqual(c.keys[0]);
  });

  it("aggregate what they are given, slot by slot", async () => {
    const { keys } = await keysFor("organizer");
    const ballots = chain(keys, [1]);
    const total = aggregate(ballots, SLOTS);
    expect(total.b).toHaveLength(SLOTS);
  });
});
