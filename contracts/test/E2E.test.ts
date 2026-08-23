/**
 * End-to-end election, exercised the way the real dApp does it.
 *
 * The other suites use MockVerifier, so until this file existed the **official
 * Groth16 verifier had never checked a single proof**. That is the riskiest
 * assumption in the whole stack: `ElectionV4._hashToField` has to reproduce
 * Semaphore's own hash-to-field byte for byte, and the packed proof points have
 * to land in the exact calldata order `ISemaphoreVerifier` expects. If either is
 * off, every vote reverts on Amoy and no unit test would have caught it.
 *
 * So this suite deploys SemaphoreVerifierV4, generates real proofs with the
 * official JS libraries, encrypts real Paillier ballots, routes everything
 * through ElectionPaymaster exactly as the relayer does, and decrypts the
 * homomorphic tally at the end.
 */
import { expect } from "chai";
import { network } from "hardhat";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";
import { poseidon2 } from "poseidon-lite/poseidon2";
import { PublicKey, PrivateKey, generateRandomKeys } from "paillier-bigint";
import { deployPoseidonT3, POSEIDON_FQN, baseConfig, VotingType, Outcome, Phase } from "./fixtures.js";

const { ethers, networkHelpers } = await network.create();

const FORWARDER = "0x000000000000000000000000000000000000dEaD";
const COUNTER_BASE = 1_000_000n;

// A 1024-bit Paillier key keeps the suite fast; production uses 2048.
const PAILLIER_BITS = 1024;

const toHex = (x: bigint): string => "0x" + x.toString(16);

/**
 * Mirrors frontend/src/lib/paillier.ts encryptBallot, padding included: the
 * ciphertext is passed to Solidity as `bytes`, so an odd number of hex digits
 * is rejected by ethers before the call is even made.
 */
function encryptBallot(pk: PublicKey, optionIndex: number): string {
  const digits = pk.encrypt(COUNTER_BASE ** BigInt(optionIndex)).toString(16);
  return "0x" + (digits.length % 2 === 0 ? digits : "0" + digits);
}

/** Semaphore's hash-to-field, mirroring ElectionV4._hashToField. */
function hashToField(value: bigint): bigint {
  return BigInt(ethers.keccak256(ethers.zeroPadValue(ethers.toBeHex(value), 32))) >> 8n;
}

/**
 * The vote nullifier, computed directly instead of via a throwaway proof.
 * Mirrors frontend/src/lib/semaphore.ts computeNullifier; generating a full
 * Groth16 proof just to read this would double the cost of every ballot.
 */
function voteNullifier(identity: Identity, scope: bigint): bigint {
  return poseidon2([hashToField(scope), identity.secretScalar]);
}

/** Mirrors ElectionV4.castVote's message derivation exactly. */
function voteMessage(ciphertext: string, nonce: bigint): bigint {
  return BigInt(ethers.solidityPackedKeccak256(["bytes", "uint256"], [ciphertext, nonce]));
}

interface Stack {
  registry: any;
  paymaster: any;
  verifier: any;
  factory: any;
  poseidon: string;
}

describe("E2E, real Groth16 proofs, real Paillier, relayed like production", () => {
  let deployer: any;
  let organizer: any;
  let relayer: any;
  let stack: Stack;
  let paillier: { publicKey: PublicKey; privateKey: PrivateKey };

  before(async function () {
    this.timeout(180_000);
    [deployer, organizer, relayer] = await ethers.getSigners();

    const poseidon = await deployPoseidonT3(ethers);

    const Registry = await ethers.getContractFactory("PlatformRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    const Paymaster = await ethers.getContractFactory("ElectionPaymaster");
    const paymaster = await Paymaster.deploy();
    await paymaster.waitForDeployment();

    // The real thing, not MockVerifier. This is the point of the suite.
    const Verifier = await ethers.getContractFactory("SemaphoreVerifierV4");
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();

    const Factory = await ethers.getContractFactory("ElectionFactory", {
      libraries: { [POSEIDON_FQN]: poseidon },
    });
    const factory = await Factory.deploy(
      await paymaster.getAddress(),
      FORWARDER,
      await verifier.getAddress(),
      await registry.getAddress(),
    );
    await factory.waitForDeployment();
    await (await paymaster.setFactory(await factory.getAddress())).wait();

    stack = { registry, paymaster, verifier, factory, poseidon };
    paillier = await generateRandomKeys(PAILLIER_BITS);
  });

  /** Registers a voter on the platform and returns their Semaphore identity. */
  async function newVoter(seed: string): Promise<{ identity: Identity; nullifier: bigint }> {
    const identity = new Identity(seed);
    const worldIdNullifier = BigInt(ethers.keccak256(ethers.toUtf8Bytes("worldid:" + seed)));
    await (await stack.registry.registerMember(worldIdNullifier, identity.commitment)).wait();
    return { identity, nullifier: worldIdNullifier };
  }

  async function createElection(overrides: Record<string, unknown> = {}, deposit = "2"): Promise<any> {
    const now = await networkHelpers.time.latest();
    const cfg = baseConfig(now, {
      numOptions: 3n,
      paillierPublicKey: JSON.stringify({
        n: toHex(paillier.publicKey.n),
        g: toHex(paillier.publicKey.g),
      }),
      ...overrides,
    });
    await (
      await stack.factory.connect(organizer).createElection(cfg, { value: ethers.parseEther(deposit) })
    ).wait();
    const count = await stack.factory.electionsCount();
    return ethers.getContractAt("ElectionV4", await stack.factory.elections(count - 1n));
  }

  /** Full relayed vote: encrypt, prove, submit through the paymaster. */
  async function relayedVote(
    election: any,
    identity: Identity,
    group: Group,
    optionIndex: number,
  ): Promise<{ ciphertext: string; nullifier: bigint }> {
    const scope: bigint = await election.scope();
    const pkJson: string = await election.paillierPublicKey();
    const parsed = JSON.parse(pkJson) as { n: string; g: string };
    const pk = new PublicKey(BigInt(parsed.n), BigInt(parsed.g));

    const ciphertext = encryptBallot(pk, optionIndex);

    // The nonce must be read BEFORE proving: it is bound into the message.
    const nonce: bigint = await election.nullifierNonces(voteNullifier(identity, scope));

    const message = voteMessage(ciphertext, nonce);
    const proof = await generateProof(identity, group, message, scope);
    const p = proof.points.map(BigInt);

    await (
      await stack.paymaster.connect(relayer).relayVote(
        await election.getAddress(),
        ciphertext,
        BigInt(proof.nullifier),
        BigInt(proof.merkleTreeRoot),
        BigInt(proof.merkleTreeDepth),
        [p[0], p[1]],
        [
          [p[2], p[3]],
          [p[4], p[5]],
        ],
        [p[6], p[7]],
      )
    ).wait();

    return { ciphertext, nullifier: BigInt(proof.nullifier) };
  }

  it("runs a whole election: enroll, vote, re-vote, tally, publish", async function () {
    this.timeout(300_000);

    const election = await createElection();
    const address = await election.getAddress();

    // ── Enrollment, relayed ──
    const alice = await newVoter("alice");
    const bob = await newVoter("bob");
    const carol = await newVoter("carol");

    for (const v of [alice, bob, carol]) {
      await (await stack.paymaster.connect(relayer).relayEnroll(address, v.identity.commitment)).wait();
    }
    expect(await election.memberCount()).to.equal(3n);

    const group = new Group([alice.identity.commitment, bob.identity.commitment, carol.identity.commitment]);
    expect(BigInt(group.root)).to.equal(await election.merkleTreeRoot());

    // ── Voting ──
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);

    const ballots: string[] = [];
    ballots.push((await relayedVote(election, alice.identity, group, 0)).ciphertext);
    ballots.push((await relayedVote(election, bob.identity, group, 0)).ciphertext);

    // Carol votes for option 2, then changes her mind: coercion resistance means
    // only her highest-nonce ballot may count.
    const coerced = await relayedVote(election, carol.identity, group, 2);
    const real = await relayedVote(election, carol.identity, group, 1);
    expect(real.nullifier).to.equal(coerced.nullifier);
    expect(await election.nullifierNonces(real.nullifier)).to.equal(2n);
    ballots.push(real.ciphertext);

    expect(await election.voteCount()).to.equal(4n); // 3 voters, 4 emitted ballots

    // ── Tally: dedup by max nonce, homomorphic sum, decrypt ──
    const events = await election.queryFilter(election.filters.VoteCast());
    const latest = new Map<string, { ciphertext: string; nonce: bigint }>();
    for (const e of events) {
      const a = (e as any).args;
      const key = a.nullifier.toString();
      const seen = latest.get(key);
      if (!seen || a.nonce > seen.nonce) latest.set(key, { ciphertext: a.voteCiphertext, nonce: a.nonce });
    }
    expect(latest.size).to.equal(3);

    const aggregated = [...latest.values()]
      .map(v => BigInt(v.ciphertext))
      .reduce((acc, c) => paillier.publicKey.addition(acc, c));

    let remaining = paillier.privateKey.decrypt(aggregated);
    const counts: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      counts.push(remaining % COUNTER_BASE);
      remaining /= COUNTER_BASE;
    }
    expect(remaining).to.equal(0n);

    // Alice + Bob on option 0, Carol's REPLACEMENT on option 1, nothing on the
    // coerced option 2. The overridden ballot is invisible in the total.
    expect(counts.slice(0, 3)).to.deep.equal([2n, 1n, 0n]);

    // ── Publish ──
    await networkHelpers.time.increaseTo((await election.voteEnd()) + 1n);
    // publishResults expects numOptions + 1 entries: the blank slot counts too.
    await (await election.connect(organizer).publishResults("QmAuditTrail", counts)).wait();

    expect(await election.resultsPublished()).to.equal(true);
    expect(await election.outcome()).to.equal(Outcome.WINNER);
    expect(await election.winnerIndex()).to.equal(0n);
    expect(await election.phase()).to.equal(Phase.CLOSED);
  });

  it("rejects a proof from someone outside the group", async function () {
    this.timeout(180_000);

    const election = await createElection();
    const address = await election.getAddress();

    const member = await newVoter("member-only");
    await (await stack.paymaster.connect(relayer).relayEnroll(address, member.identity.commitment)).wait();
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);

    // An outsider builds a group containing only themselves: internally consistent,
    // but its root is not the election's, so the contract must refuse it.
    const outsider = new Identity("outsider");
    const fakeGroup = new Group([outsider.commitment]);

    const scope: bigint = await election.scope();
    const ciphertext = encryptBallot(paillier.publicKey, 0);
    const proof = await generateProof(outsider, fakeGroup, voteMessage(ciphertext, 0n), scope);
    const p = proof.points.map(BigInt);

    await expect(
      stack.paymaster.connect(relayer).relayVote(
        address,
        ciphertext,
        BigInt(proof.nullifier),
        BigInt(proof.merkleTreeRoot),
        BigInt(proof.merkleTreeDepth),
        [p[0], p[1]],
        [
          [p[2], p[3]],
          [p[4], p[5]],
        ],
        [p[6], p[7]],
      ),
    ).to.be.revertedWithCustomError(election, "UnknownOrExpiredRoot");
  });

  it("rejects a tampered proof against the real verifier, and charges nobody", async function () {
    this.timeout(180_000);

    const election = await createElection();
    const address = await election.getAddress();
    const voter = await newVoter("tamper");
    await (await stack.paymaster.connect(relayer).relayEnroll(address, voter.identity.commitment)).wait();
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);

    const group = new Group([voter.identity.commitment]);
    const scope: bigint = await election.scope();
    const ciphertext = encryptBallot(paillier.publicKey, 0);
    const proof = await generateProof(voter.identity, group, voteMessage(ciphertext, 0n), scope);
    const p = proof.points.map(BigInt);

    const tankBefore = await stack.paymaster.gasBalance(organizer.address);

    // Flip one field element: the Groth16 pairing check must fail.
    await expect(
      stack.paymaster.connect(relayer).relayVote(
        address,
        ciphertext,
        BigInt(proof.nullifier),
        BigInt(proof.merkleTreeRoot),
        BigInt(proof.merkleTreeDepth),
        [p[0] + 1n, p[1]],
        [
          [p[2], p[3]],
          [p[4], p[5]],
        ],
        [p[6], p[7]],
      ),
    ).to.be.revert(ethers);

    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(tankBefore);
  });

  it("rejects replaying someone else's ballot with a stale nonce", async function () {
    this.timeout(180_000);

    const election = await createElection();
    const address = await election.getAddress();
    const voter = await newVoter("replay");
    await (await stack.paymaster.connect(relayer).relayEnroll(address, voter.identity.commitment)).wait();
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);

    const group = new Group([voter.identity.commitment]);
    const scope: bigint = await election.scope();
    const ciphertext = encryptBallot(paillier.publicKey, 0);
    const proof = await generateProof(voter.identity, group, voteMessage(ciphertext, 0n), scope);
    const p = proof.points.map(BigInt);

    const args = [
      address,
      ciphertext,
      BigInt(proof.nullifier),
      BigInt(proof.merkleTreeRoot),
      BigInt(proof.merkleTreeDepth),
      [p[0], p[1]],
      [
        [p[2], p[3]],
        [p[4], p[5]],
      ],
      [p[6], p[7]],
    ] as const;

    await (await stack.paymaster.connect(relayer).relayVote(...args)).wait();

    // The nonce has moved on, so the same proof no longer binds the message.
    await expect(stack.paymaster.connect(relayer).relayVote(...args)).to.be.revert(ethers);
    expect(await election.voteCount()).to.equal(1n);
  });

  it("counts a Yes/No supermajority correctly through the same pipeline", async function () {
    this.timeout(300_000);

    // 2 options (Yes/No) + blank. Two thirds of ballots cast must be Yes.
    const election = await createElection({
      numOptions: 2n,
      votingType: VotingType.SUPERMAJORITY_TWO_THIRDS,
    });
    const address = await election.getAddress();

    const voters = [];
    for (const seed of ["s1", "s2", "s3"]) voters.push(await newVoter("two-thirds-" + seed));
    for (const v of voters) {
      await (await stack.paymaster.connect(relayer).relayEnroll(address, v.identity.commitment)).wait();
    }

    const group = new Group(voters.map(v => v.identity.commitment));
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);

    // 2 Yes (index 0), 1 No (index 1) => exactly 2/3.
    await relayedVote(election, voters[0].identity, group, 0);
    await relayedVote(election, voters[1].identity, group, 0);
    await relayedVote(election, voters[2].identity, group, 1);

    await networkHelpers.time.increaseTo((await election.voteEnd()) + 1n);
    await (await election.connect(organizer).publishResults("QmTwoThirds", [2n, 1n, 0n])).wait();

    expect(await election.outcome()).to.equal(Outcome.APPROVED);
  });

  it("keeps every voter's call arriving from the paymaster, never from the voter", async function () {
    this.timeout(180_000);

    const election = await createElection();
    const address = await election.getAddress();
    const voter = await newVoter("unlinkable");

    const enrollTx = await (
      await stack.paymaster.connect(relayer).relayEnroll(address, voter.identity.commitment)
    ).wait();

    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);
    const group = new Group([voter.identity.commitment]);
    await relayedVote(election, voter.identity, group, 0);

    const voteTx = await (await election.queryFilter(election.filters.VoteCast()))[0].getTransaction();
    const paymasterAddress = await stack.paymaster.getAddress();

    // Both operations were sent TO the paymaster, so the on-chain trace exposes
    // no address that belongs to this voter and links enrollment to ballot.
    expect(enrollTx!.to).to.equal(paymasterAddress);
    expect(voteTx.to).to.equal(paymasterAddress);
  });
});
