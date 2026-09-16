import { expect } from "chai";
import { network } from "hardhat";
import {
  deployStack,
  deployElection,
  baseConfig,
  signEnrollAttestation,
  signPrivateEnrollment,
  ZERO_ADDRESS,
  ZERO_HASH,
  type Stack,
} from "./fixtures.js";

/**
 * Enrolling without publishing who enrolled.
 *
 * THE PROBLEM THIS PATH EXISTS FOR. A voter used to put their one platform
 * commitment into every election's tree, and the registry says publicly which
 * human each commitment belongs to. Reading the chain therefore gave anyone a
 * list of the elections a named person had joined: the ballots stayed secret,
 * the participation did not.
 *
 * WHAT THE TESTS PIN DOWN. That a commitment nothing has ever heard of can
 * enrol when the platform vouches for it; that the tag which answers "has this
 * person already enrolled here" still answers it; that the old public doors are
 * shut on an election that has this one, because a human able to use both would
 * hold two leaves and two votes; and that an organizer's own gatekeeper keeps
 * the say it had.
 */

const { ethers, networkHelpers } = await network.create();

const FORWARDER = ethers.Wallet.createRandom().address;
const POLICY_HASH = ethers.keccak256(
  ethers.toUtf8Bytes('{"minAge":18,"allowedCountries":["ESP"]}'),
);

let stack: Stack;
let legacyStack: Stack;
let organizer: any;
let platform: any;
let eligibility: any;
let outsider: any;
let chainId: bigint;

before(async () => {
  [, organizer, platform, eligibility, outsider] = await ethers.getSigners();
  stack = await deployStack(ethers, FORWARDER, platform.address);
  legacyStack = await deployStack(ethers, FORWARDER);
  chainId = (await ethers.provider.getNetwork()).chainId;
});

const now = async (): Promise<number> =>
  Number((await ethers.provider.getBlock("latest"))!.timestamp);

/** A commitment derived for one election, which appears nowhere else. */
let derivedSeq = 900_000n;
function derivedCommitment(): bigint {
  derivedSeq += 1n;
  return derivedSeq;
}

/** What the platform computes from a human and an election, never from either alone. */
function humanTagFor(worldIdNullifier: bigint, electionAddress: string): bigint {
  return BigInt(
    ethers.keccak256(
      ethers.solidityPacked(["uint256", "address"], [worldIdNullifier, electionAddress]),
    ),
  );
}

async function privateElection(overrides = {}): Promise<any> {
  return deployElection(
    ethers,
    stack,
    FORWARDER,
    organizer,
    baseConfig(await now(), overrides),
    platform.address,
  );
}

describe("private enrollment", () => {
  it("takes a commitment the registry has never seen, on the platform's word", async () => {
    const election = await privateElection();
    const address = await election.getAddress();
    const commitment = derivedCommitment();
    const tag = humanTagFor(4242n, address);
    const deadline = (await now()) + 600;

    // Nothing vouches for this commitment anywhere. That is the point: it was
    // derived for this election and is used in no other.
    expect(await stack.registry.verifiedMembers(commitment)).to.equal(false);

    const signature = await signPrivateEnrollment(
      platform,
      address,
      chainId,
      commitment,
      tag,
      deadline,
    );

    await expect(
      election.enrollPrivate(commitment, tag, deadline, signature, "0x"),
    ).to.emit(election, "MemberEnrolled");

    expect(await election.hasMember(commitment)).to.equal(true);
    expect(await election.memberCount()).to.equal(1n);
  });

  it("refuses the same human twice, however many commitments they derive", async () => {
    const election = await privateElection();
    const address = await election.getAddress();
    const human = 777n;
    const tag = humanTagFor(human, address);
    const deadline = (await now()) + 600;

    const first = derivedCommitment();
    await (
      await election.enrollPrivate(
        first,
        tag,
        deadline,
        await signPrivateEnrollment(platform, address, chainId, first, tag, deadline),
        "0x",
      )
    ).wait();

    // A second commitment, freshly derived, correctly signed, and the same
    // person behind it. The tag is what notices.
    const second = derivedCommitment();
    await expect(
      election.enrollPrivate(
        second,
        tag,
        deadline,
        await signPrivateEnrollment(platform, address, chainId, second, tag, deadline),
        "0x",
      ),
    ).to.be.revertedWithCustomError(election, "AlreadyEnrolled");
  });

  it("gives the same human a different tag in a different election", async () => {
    const one = await privateElection();
    const two = await privateElection();
    const human = 31337n;

    expect(humanTagFor(human, await one.getAddress())).to.not.equal(
      humanTagFor(human, await two.getAddress()),
    );
  });

  it("refuses a signature from anyone but the platform", async () => {
    const election = await privateElection();
    const address = await election.getAddress();
    const commitment = derivedCommitment();
    const tag = humanTagFor(11n, address);
    const deadline = (await now()) + 600;

    // The organizer signing their own roll is exactly what the factory
    // imposing this key prevents.
    const forged = await signPrivateEnrollment(
      organizer,
      address,
      chainId,
      commitment,
      tag,
      deadline,
    );

    await expect(
      election.enrollPrivate(commitment, tag, deadline, forged, "0x"),
    ).to.be.revertedWithCustomError(election, "BadAttestation");
  });

  it("refuses an attestation for another election", async () => {
    const one = await privateElection();
    const two = await privateElection();
    const commitment = derivedCommitment();
    const tag = humanTagFor(12n, await one.getAddress());
    const deadline = (await now()) + 600;

    const forOne = await signPrivateEnrollment(
      platform,
      await one.getAddress(),
      chainId,
      commitment,
      tag,
      deadline,
    );

    await expect(
      two.enrollPrivate(commitment, tag, deadline, forOne, "0x"),
    ).to.be.revertedWithCustomError(two, "BadAttestation");
  });

  it("refuses an expired attestation and a tag of zero", async () => {
    const election = await privateElection();
    const address = await election.getAddress();
    const commitment = derivedCommitment();
    const tag = humanTagFor(13n, address);

    const stale = (await now()) - 1;
    await expect(
      election.enrollPrivate(
        commitment,
        tag,
        stale,
        await signPrivateEnrollment(platform, address, chainId, commitment, tag, stale),
        "0x",
      ),
    ).to.be.revertedWithCustomError(election, "AttestationExpired");

    const deadline = (await now()) + 600;
    await expect(
      election.enrollPrivate(
        commitment,
        0n,
        deadline,
        await signPrivateEnrollment(platform, address, chainId, commitment, 0n, deadline),
        "0x",
      ),
    ).to.be.revertedWithCustomError(election, "MissingHumanTag");
  });

  it("shuts the public doors, so nobody holds two leaves", async () => {
    const election = await privateElection();
    const address = await election.getAddress();

    // A genuine platform member, enrolling the old way.
    const commitment = 123_456n;
    await (await stack.registry.registerMember(999n, commitment)).wait();

    await expect(election.enroll(commitment)).to.be.revertedWithCustomError(
      election,
      "PrivateEnrollmentRequired",
    );

    const deadline = (await now()) + 600;
    await expect(
      election.enrollAttested(
        commitment,
        999n,
        deadline,
        await signEnrollAttestation(platform, address, chainId, commitment, 999n, deadline),
      ),
    ).to.be.revertedWithCustomError(election, "PrivateEnrollmentRequired");
  });

  it("is unavailable on an election deployed without a platform key", async () => {
    const election = await deployElection(
      ethers,
      legacyStack,
      FORWARDER,
      organizer,
      baseConfig(await now()),
    );
    const address = await election.getAddress();
    const commitment = derivedCommitment();
    const tag = humanTagFor(14n, address);
    const deadline = (await now()) + 600;

    await expect(
      election.enrollPrivate(
        commitment,
        tag,
        deadline,
        await signPrivateEnrollment(platform, address, chainId, commitment, tag, deadline),
        "0x",
      ),
    ).to.be.revertedWithCustomError(election, "PrivateEnrollmentUnavailable");
  });

  it("still asks the organizer's own gatekeeper, where they named one", async () => {
    const election = await privateElection({
      eligibilityAttester: eligibility.address,
      eligibilityPolicyHash: POLICY_HASH,
      personhood: 1,
    });
    const address = await election.getAddress();
    const commitment = derivedCommitment();
    const tag = humanTagFor(15n, address);
    const deadline = (await now()) + 600;
    const platformSig = await signPrivateEnrollment(
      platform,
      address,
      chainId,
      commitment,
      tag,
      deadline,
    );

    // The platform says "a verified human, not yet enrolled here". It does not
    // say "over eighteen and Spanish", and on this election that is a second
    // question with a second answer.
    await expect(
      election.enrollPrivate(commitment, tag, deadline, platformSig, "0x"),
    ).to.be.revertedWithCustomError(election, "BadAttestation");

    await expect(
      election.enrollPrivate(
        commitment,
        tag,
        deadline,
        platformSig,
        await signPrivateEnrollment(outsider, address, chainId, commitment, tag, deadline),
      ),
    ).to.be.revertedWithCustomError(election, "BadAttestation");

    await expect(
      election.enrollPrivate(
        commitment,
        tag,
        deadline,
        platformSig,
        await signPrivateEnrollment(eligibility, address, chainId, commitment, tag, deadline),
      ),
    ).to.emit(election, "MemberEnrolled");
  });

  it("refuses outside the enrollment window", async () => {
    const start = (await now()) + 500;
    const election = await privateElection({
      enrollStart: start,
      enrollEnd: start + 500,
      voteStart: start + 500,
      voteEnd: start + 1000,
    });
    const address = await election.getAddress();
    const commitment = derivedCommitment();
    const tag = humanTagFor(16n, address);
    const deadline = (await now()) + 600;

    await expect(
      election.enrollPrivate(
        commitment,
        tag,
        deadline,
        await signPrivateEnrollment(platform, address, chainId, commitment, tag, deadline),
        "0x",
      ),
    ).to.be.revertedWithCustomError(election, "EnrollmentNotOpen");
  });

  it("is relayed for a voter who holds no wallet", async () => {
    // Through the factory, so the paymaster knows which tank pays for it.
    const cfg = baseConfig(await now());
    const created = await stack.factory
      .connect(organizer)
      .createElection(cfg, 0n, { value: ethers.parseEther("1") });
    const receipt = await created.wait();
    const log = receipt!.logs.find(
      (entry: any) => entry.fragment?.name === "ElectionCreated",
    );
    const address = log.args[0];
    const election = await ethers.getContractAt("ElectionV4", address);

    const commitment = derivedCommitment();
    const tag = humanTagFor(17n, address);
    const deadline = (await now()) + 600;
    const signature = await signPrivateEnrollment(
      platform,
      address,
      chainId,
      commitment,
      tag,
      deadline,
    );

    const before = await stack.paymaster.reservedFor(address);
    await (
      await stack.paymaster
        .connect(outsider)
        .relayEnrollPrivate(address, commitment, tag, deadline, signature, "0x")
    ).wait();

    expect(await election.hasMember(commitment)).to.equal(true);
    // The relayer was paid out of this election's own reserve.
    expect(await stack.paymaster.reservedFor(address)).to.be.lessThan(before);
  });

  it("deploys every election through the factory with the platform's key", async () => {
    expect(await stack.factory.platformAttester()).to.equal(platform.address);
    expect(await legacyStack.factory.platformAttester()).to.equal(ZERO_ADDRESS);

    const cfg = baseConfig(await now(), {
      eligibilityAttester: ZERO_ADDRESS,
      eligibilityPolicyHash: ZERO_HASH,
    });
    const created = await stack.factory.connect(organizer).createElection(cfg, 0n);
    const receipt = await created.wait();
    const log = receipt!.logs.find(
      (entry: any) => entry.fragment?.name === "ElectionCreated",
    );
    const election = await ethers.getContractAt("ElectionV4", log.args[0]);

    // An organizer cannot name this key, so they cannot sign their own roll.
    expect(await election.platformAttester()).to.equal(platform.address);
  });
});
