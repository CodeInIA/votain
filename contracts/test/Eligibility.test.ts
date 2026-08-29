import { expect } from "chai";
import { network } from "hardhat";
import {
  deployStack,
  deployElection,
  baseConfig,
  signEnrollAttestation,
  ZERO_ADDRESS,
  ZERO_HASH,
  type Stack,
} from "./fixtures.js";

const { ethers, networkHelpers } = await network.create();

const FORWARDER = ethers.Wallet.createRandom().address;
const POLICY_HASH = ethers.keccak256(
  ethers.toUtf8Bytes('{"minAge":18,"allowedCountries":["ESP"]}'),
);

let stack: Stack;
let organizer: any;
let attester: any;
let outsider: any;
let chainId: bigint;

before(async () => {
  [, organizer, attester, outsider] = await ethers.getSigners();
  stack = await deployStack(ethers, FORWARDER);
  chainId = (await ethers.provider.getNetwork()).chainId;
});

async function platformRegister(nullifier: bigint, commitment: bigint): Promise<void> {
  await (await stack.registry.registerMember(nullifier, commitment)).wait();
}

let commitmentSeq = 500_000n;
function nextCommitment(): { nullifier: bigint; commitment: bigint } {
  commitmentSeq += 1n;
  return { nullifier: commitmentSeq * 13n, commitment: commitmentSeq };
}

/// Election that declares an attribute policy attested by `attester`.
async function gatedElection(overrides = {}): Promise<any> {
  const now = await networkHelpers.time.latest();
  return deployElection(
    ethers,
    stack,
    FORWARDER,
    organizer,
    baseConfig(now, {
      eligibilityAttester: attester.address,
      eligibilityPolicyHash: POLICY_HASH,
      ...overrides,
    }),
  );
}

async function openElection(): Promise<any> {
  const now = await networkHelpers.time.latest();
  return deployElection(ethers, stack, FORWARDER, organizer, baseConfig(now));
}

async function futureDeadline(): Promise<number> {
  return (await networkHelpers.time.latest()) + 600;
}

describe("ElectionV4, eligibility config", () => {
  it("rejects an attester without a policy hash, and a policy hash without an attester", async () => {
    const now = await networkHelpers.time.latest();
    const Election = await ethers.getContractFactory("ElectionV4", {
      libraries: { PoseidonT3: stack.poseidonAddress },
    });

    const deployWith = (cfg: ReturnType<typeof baseConfig>) =>
      Election.deploy(
        FORWARDER,
        stack.verifier.getAddress(),
        stack.registry.getAddress(),
        organizer.address,
        cfg,
      );

    // Rules nothing enforces.
    await expect(
      deployWith(baseConfig(now, { eligibilityPolicyHash: POLICY_HASH })),
    ).to.be.revertedWithCustomError(Election, "InvalidConfig");

    // Enforcement of rules nobody can read.
    await expect(
      deployWith(baseConfig(now, { eligibilityAttester: attester.address })),
    ).to.be.revertedWithCustomError(Election, "InvalidConfig");
  });

  it("accepts both set, and both unset", async () => {
    const gated = await gatedElection();
    expect(await gated.eligibilityAttester()).to.equal(attester.address);
    expect(await gated.eligibilityPolicyHash()).to.equal(POLICY_HASH);

    const open = await openElection();
    expect(await open.eligibilityAttester()).to.equal(ZERO_ADDRESS);
    expect(await open.eligibilityPolicyHash()).to.equal(ZERO_HASH);
  });
});

describe("ElectionV4, attested enrollment", () => {
  it("lets a valid attestation enroll, and emits the same event as an open election", async () => {
    const election = await gatedElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    const deadline = await futureDeadline();
    const sig = await signEnrollAttestation(
      attester,
      await election.getAddress(),
      chainId,
      commitment,
      deadline,
    );

    await expect(election.enrollAttested(commitment, deadline, sig)).to.emit(
      election,
      "MemberEnrolled",
    );

    expect(await election.hasMember(commitment)).to.equal(true);
    expect(await election.memberCount()).to.equal(1n);
    // The root the event announced is the one the tree now reports, so a voter
    // building a proof from the event lands on a root the contract accepts.
    expect(await election.rootTimestamps(await election.merkleTreeRoot())).to.be.greaterThan(0n);
  });

  it("closes the bypass: plain enroll is refused once a policy is declared", async () => {
    const election = await gatedElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    // The whole point of the attester. Before enroll() started checking this,
    // a voter the relay refused could simply call it themselves.
    await expect(election.enroll(commitment)).to.be.revertedWithCustomError(
      election,
      "AttestationRequired",
    );
    expect(await election.hasMember(commitment)).to.equal(false);
  });

  it("refuses an attestation on an election that declares no policy", async () => {
    const election = await openElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    const deadline = await futureDeadline();
    const sig = await signEnrollAttestation(
      attester,
      await election.getAddress(),
      chainId,
      commitment,
      deadline,
    );

    await expect(
      election.enrollAttested(commitment, deadline, sig),
    ).to.be.revertedWithCustomError(election, "UnexpectedAttestation");
  });

  it("rejects a signature from anyone other than the declared attester", async () => {
    const election = await gatedElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    const deadline = await futureDeadline();
    const sig = await signEnrollAttestation(
      outsider,
      await election.getAddress(),
      chainId,
      commitment,
      deadline,
    );

    await expect(
      election.enrollAttested(commitment, deadline, sig),
    ).to.be.revertedWithCustomError(election, "BadAttestation");
  });

  it("rejects an expired attestation", async () => {
    const election = await gatedElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    const deadline = (await networkHelpers.time.latest()) + 60;
    const sig = await signEnrollAttestation(
      attester,
      await election.getAddress(),
      chainId,
      commitment,
      deadline,
    );

    await networkHelpers.time.increaseTo(deadline + 1);

    await expect(
      election.enrollAttested(commitment, deadline, sig),
    ).to.be.revertedWithCustomError(election, "AttestationExpired");
  });

  it("rejects an attestation whose commitment was swapped after signing", async () => {
    const election = await gatedElection();
    const signed = nextCommitment();
    const swapped = nextCommitment();
    await platformRegister(signed.nullifier, signed.commitment);
    await platformRegister(swapped.nullifier, swapped.commitment);

    const deadline = await futureDeadline();
    const sig = await signEnrollAttestation(
      attester,
      await election.getAddress(),
      chainId,
      signed.commitment,
      deadline,
    );

    // Recovers to some other address, so it fails as a bad signature rather
    // than silently enrolling a commitment the attester never approved.
    await expect(
      election.enrollAttested(swapped.commitment, deadline, sig),
    ).to.be.revertedWithCustomError(election, "BadAttestation");
  });

  it("rejects malformed signature bytes instead of reverting inside ECDSA", async () => {
    const election = await gatedElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);
    const deadline = await futureDeadline();

    await expect(
      election.enrollAttested(commitment, deadline, "0xdeadbeef"),
    ).to.be.revertedWithCustomError(election, "BadAttestation");
  });

  it("cannot replay an attestation issued for a different election", async () => {
    const a = await gatedElection();
    const b = await gatedElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    const deadline = await futureDeadline();
    const sigForA = await signEnrollAttestation(
      attester,
      await a.getAddress(),
      chainId,
      commitment,
      deadline,
    );

    // The EIP-712 domain binds the attestation to one verifying contract.
    await expect(
      b.enrollAttested(commitment, deadline, sigForA),
    ).to.be.revertedWithCustomError(b, "BadAttestation");

    await expect(a.enrollAttested(commitment, deadline, sigForA)).to.emit(a, "MemberEnrolled");
  });

  it("still deduplicates by human, so one attestation cannot buy two leaves", async () => {
    const election = await gatedElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    const deadline = await futureDeadline();
    const sig = await signEnrollAttestation(
      attester,
      await election.getAddress(),
      chainId,
      commitment,
      deadline,
    );

    await (await election.enrollAttested(commitment, deadline, sig)).wait();
    await expect(
      election.enrollAttested(commitment, deadline, sig),
    ).to.be.revertedWithCustomError(election, "AlreadyEnrolled");
  });

  it("still requires platform verification: an attestation is not a substitute", async () => {
    const election = await gatedElection();
    const { commitment } = nextCommitment(); // deliberately never registered

    const deadline = await futureDeadline();
    const sig = await signEnrollAttestation(
      attester,
      await election.getAddress(),
      chainId,
      commitment,
      deadline,
    );

    // Attribute eligibility is additive. It never replaces proof of personhood.
    await expect(
      election.enrollAttested(commitment, deadline, sig),
    ).to.be.revertedWithCustomError(election, "NotPlatformVerified");
  });

  it("still respects the enrollment window", async () => {
    const now = await networkHelpers.time.latest();
    const election = await gatedElection({ enrollStart: now + 500, enrollEnd: now + 1000 });
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    const deadline = now + 400;
    const sig = await signEnrollAttestation(
      attester,
      await election.getAddress(),
      chainId,
      commitment,
      deadline,
    );

    await expect(
      election.enrollAttested(commitment, deadline, sig),
    ).to.be.revertedWithCustomError(election, "EnrollmentNotOpen");
  });

  it("exposes the digest it verifies, so a signer can be checked off chain", async () => {
    const election = await gatedElection();
    const { commitment } = nextCommitment();
    const deadline = await futureDeadline();

    const digest = await election.enrollmentDigest(commitment, deadline);
    const sig = await signEnrollAttestation(
      attester,
      await election.getAddress(),
      chainId,
      commitment,
      deadline,
    );

    expect(ethers.recoverAddress(digest, sig)).to.equal(attester.address);
  });
});

describe("ElectionPaymaster, attested relaying", () => {
  it("relays an attested enrollment and bills the organizer's tank", async () => {
    const now = await networkHelpers.time.latest();
    const tx = await stack.factory.connect(organizer).createElection(
      baseConfig(now, {
        name: "Gated Election",
        eligibilityAttester: attester.address,
        eligibilityPolicyHash: POLICY_HASH,
      }),
      { value: ethers.parseEther("1") },
    );
    const receipt = await tx.wait();
    const created = receipt!.logs
      .map((l: any) => {
        try {
          return stack.factory.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((l: any) => l?.name === "ElectionCreated");
    const electionAddress: string = created!.args[0];

    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    const deadline = await futureDeadline();
    const sig = await signEnrollAttestation(
      attester,
      electionAddress,
      chainId,
      commitment,
      deadline,
    );

    const before = await stack.paymaster.gasBalance(organizer.address);
    await (
      await stack.paymaster
        .connect(outsider)
        .relayEnrollAttested(electionAddress, commitment, deadline, sig)
    ).wait();
    const after = await stack.paymaster.gasBalance(organizer.address);

    const election = await ethers.getContractAt("ElectionV4", electionAddress);
    expect(await election.hasMember(commitment)).to.equal(true);
    expect(after).to.be.lessThan(before);
  });

  it("does not pay a relayer whose attestation is rejected", async () => {
    const now = await networkHelpers.time.latest();
    const tx = await stack.factory.connect(organizer).createElection(
      baseConfig(now, {
        name: "Gated Election Two",
        eligibilityAttester: attester.address,
        eligibilityPolicyHash: POLICY_HASH,
      }),
      { value: ethers.parseEther("1") },
    );
    const receipt = await tx.wait();
    const created = receipt!.logs
      .map((l: any) => {
        try {
          return stack.factory.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((l: any) => l?.name === "ElectionCreated");
    const electionAddress: string = created!.args[0];

    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    const deadline = await futureDeadline();
    const badSig = await signEnrollAttestation(
      outsider,
      electionAddress,
      chainId,
      commitment,
      deadline,
    );

    const before = await stack.paymaster.gasBalance(organizer.address);

    // Caught by hand rather than with revertedWithCustomError: the error is
    // declared on ElectionV4 but surfaces through the paymaster, and the
    // matcher resolves custom errors against the contract it was handed.
    let threw = false;
    try {
      await stack.paymaster.relayEnrollAttested(electionAddress, commitment, deadline, badSig);
    } catch (error: unknown) {
      threw = true;
      expect(String(error)).to.contain("BadAttestation");
    }
    expect(threw).to.equal(true);

    // The revert takes the reimbursement with it, so a relayer submitting
    // garbage never gets paid out of the organizer's tank.
    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(before);
  });
});
