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
import {
  deployPoseidonT3,
  POSEIDON_FQN,
  baseConfig,
  signPrivateEnrollment,
  VotingType,
  Outcome,
  Phase,
} from "./fixtures.js";

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

interface Voter {
  /** What the identity is derived from, both the platform one and per-election ones. */
  seed: string;
  identity: Identity;
  nullifier: bigint;
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
  let platform: any;
  let stack: Stack;
  let paillier: { publicKey: PublicKey; privateKey: PrivateKey };

  before(async function () {
    this.timeout(180_000);
    [deployer, organizer, relayer, platform] = await ethers.getSigners();

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
      platform.address,
    );
    await factory.waitForDeployment();
    await (await paymaster.setFactory(await factory.getAddress())).wait();

    stack = { registry, paymaster, verifier, factory, poseidon };
    paillier = await generateRandomKeys(PAILLIER_BITS);
  });

  /** Registers a voter on the platform and returns their Semaphore identity. */
  async function newVoter(seed: string): Promise<Voter> {
    const identity = new Identity(seed);
    const worldIdNullifier = BigInt(ethers.keccak256(ethers.toUtf8Bytes("worldid:" + seed)));
    await (await stack.registry.registerMember(worldIdNullifier, identity.commitment)).wait();
    return { seed, identity, nullifier: worldIdNullifier };
  }

  /**
   * The identity a voter derives for ONE election, mirroring the frontend.
   *
   * The commitment that lands in this election's tree is computed from the
   * voter's own secret and this election's address, so it is reproducible from
   * their recovery phrase and matches nothing they use anywhere else. Their
   * platform identity, the one the registry names, never appears on chain
   * again after registration.
   */
  function electionIdentity(voter: Voter, electionAddress: string): Identity {
    return new Identity(`${voter.seed}:${electionAddress.toLowerCase()}`);
  }

  /**
   * What the platform derives to answer "has this person already enrolled
   * here", and nothing else. In production a server-side key goes into this
   * hash, so nobody who knows the World ID nullifier can recompute the tag and
   * recognise the same person in another election.
   */
  function humanTag(voter: Voter, electionAddress: string): bigint {
    return BigInt(
      ethers.solidityPackedKeccak256(
        ["string", "uint256", "address"],
        ["test-pepper", voter.nullifier, electionAddress],
      ),
    );
  }

  /** Enrols a voter the way the dApp does, and returns the identity they vote with. */
  async function enrolPrivately(election: any, voter: Voter): Promise<Identity> {
    const address = await election.getAddress();
    const identity = electionIdentity(voter, address);
    const tag = humanTag(voter, address);
    const deadline = (await networkHelpers.time.latest()) + 900;
    const signature = await signPrivateEnrollment(
      platform,
      address,
      (await ethers.provider.getNetwork()).chainId,
      identity.commitment,
      tag,
      deadline,
    );

    await (
      await stack.paymaster
        .connect(relayer)
        .relayEnrollPrivate(address, identity.commitment, tag, deadline, signature, "0x")
    ).wait();

    return identity;
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
      await stack.factory.connect(organizer).createElection(cfg, 0n, { value: ethers.parseEther(deposit) })
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

    const voting = new Map<string, Identity>();
    for (const v of [alice, bob, carol]) {
      voting.set(v.seed, await enrolPrivately(election, v));
    }
    expect(await election.memberCount()).to.equal(3n);

    // NONE of these are the commitments the registry knows. That is the point:
    // the tree says three verified humans joined, and nothing on chain says
    // which three, nor what else they have joined.
    for (const v of [alice, bob, carol]) {
      expect(await election.hasMember(v.identity.commitment)).to.equal(false);
      expect(await election.hasMember(voting.get(v.seed)!.commitment)).to.equal(true);
    }

    const group = new Group([
      voting.get("alice")!.commitment,
      voting.get("bob")!.commitment,
      voting.get("carol")!.commitment,
    ]);
    expect(BigInt(group.root)).to.equal(await election.merkleTreeRoot());

    // ── Voting ──
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);

    const ballots: string[] = [];
    ballots.push((await relayedVote(election, voting.get("alice")!, group, 0)).ciphertext);
    ballots.push((await relayedVote(election, voting.get("bob")!, group, 0)).ciphertext);

    // Carol votes for option 2, then changes her mind: coercion resistance means
    // only her highest-nonce ballot may count.
    const carolIdentity = voting.get("carol")!;
    const coerced = await relayedVote(election, carolIdentity, group, 2);
    const real = await relayedVote(election, carolIdentity, group, 1);
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
    await enrolPrivately(election, member);
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
    const voting = await enrolPrivately(election, voter);
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);

    const group = new Group([voting.commitment]);
    const scope: bigint = await election.scope();
    const ciphertext = encryptBallot(paillier.publicKey, 0);
    const proof = await generateProof(voting, group, voteMessage(ciphertext, 0n), scope);
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
    const voting = await enrolPrivately(election, voter);
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);

    const group = new Group([voting.commitment]);
    const scope: bigint = await election.scope();
    const ciphertext = encryptBallot(paillier.publicKey, 0);
    const proof = await generateProof(voting, group, voteMessage(ciphertext, 0n), scope);
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

    const voters: Voter[] = [];
    for (const seed of ["s1", "s2", "s3"]) voters.push(await newVoter("two-thirds-" + seed));
    const voting: Identity[] = [];
    for (const v of voters) voting.push(await enrolPrivately(election, v));

    const group = new Group(voting.map(identity => identity.commitment));
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);

    // 2 Yes (index 0), 1 No (index 1) => exactly 2/3.
    await relayedVote(election, voting[0], group, 0);
    await relayedVote(election, voting[1], group, 0);
    await relayedVote(election, voting[2], group, 1);

    await networkHelpers.time.increaseTo((await election.voteEnd()) + 1n);
    await (await election.connect(organizer).publishResults("QmTwoThirds", [2n, 1n, 0n])).wait();

    expect(await election.outcome()).to.equal(Outcome.APPROVED);
  });

  it("keeps every voter's call arriving from the paymaster, never from the voter", async function () {
    this.timeout(180_000);

    const election = await createElection();
    const address = await election.getAddress();
    const voter = await newVoter("unlinkable");

    const voting = await enrolPrivately(election, voter);
    const enrollTx = await (await election.queryFilter(election.filters.MemberEnrolled()))[0]
      .getTransaction();

    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);
    const group = new Group([voting.commitment]);
    await relayedVote(election, voting, group, 0);

    const voteTx = await (await election.queryFilter(election.filters.VoteCast()))[0].getTransaction();
    const paymasterAddress = await stack.paymaster.getAddress();

    // Both operations were sent TO the paymaster, so the on-chain trace exposes
    // no address that belongs to this voter and links enrollment to ballot.
    expect(enrollTx.to).to.equal(paymasterAddress);
    expect(voteTx.to).to.equal(paymasterAddress);

    // And the leaf is not the voter's platform identity, so the enrolment
    // cannot be matched against the registry either, nor against the same
    // person's enrolment anywhere else.
    expect(await election.hasMember(voter.identity.commitment)).to.equal(false);
    expect(await stack.registry.nullifierOf(voting.commitment)).to.equal(0n);
  });
});
