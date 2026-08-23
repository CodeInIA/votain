import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

async function deployRegistry() {
  const PlatformRegistry = await ethers.getContractFactory("PlatformRegistry");
  const registry = await PlatformRegistry.deploy();
  await registry.waitForDeployment();
  return registry;
}

const NULLIFIER = 12345n;
const COMMITMENT = 67890n;
const OTHER_COMMITMENT = 99999n;

describe("PlatformRegistry", function () {
  it("Should allow the owner to register a member", async function () {
    const registry = await deployRegistry();

    await expect(registry.registerMember(NULLIFIER, COMMITMENT))
      .to.emit(registry, "MemberVerified")
      .withArgs(NULLIFIER, COMMITMENT);

    expect(await registry.registeredNullifiers(NULLIFIER)).to.be.true;
    expect(await registry.verifiedMembers(COMMITMENT)).to.be.true;
    expect(await registry.nullifierOf(COMMITMENT)).to.equal(NULLIFIER);
    expect(await registry.commitmentOf(NULLIFIER)).to.equal(COMMITMENT);
  });

  it("Should prevent registering the same nullifier twice", async function () {
    const registry = await deployRegistry();
    await registry.registerMember(NULLIFIER, COMMITMENT);

    await expect(
      registry.registerMember(NULLIFIER, OTHER_COMMITMENT),
    ).to.be.revertedWithCustomError(registry, "NullifierAlreadyRegistered");
  });

  it("Should prevent reusing a commitment across humans", async function () {
    const registry = await deployRegistry();
    await registry.registerMember(NULLIFIER, COMMITMENT);

    await expect(
      registry.registerMember(54321n, COMMITMENT),
    ).to.be.revertedWithCustomError(registry, "IdentityAlreadyVerified");
  });

  it("Should reject zero values", async function () {
    const registry = await deployRegistry();

    await expect(registry.registerMember(0n, COMMITMENT)).to.be.revertedWithCustomError(
      registry,
      "ZeroValue",
    );
    await expect(registry.registerMember(NULLIFIER, 0n)).to.be.revertedWithCustomError(
      registry,
      "ZeroValue",
    );
  });

  it("Should prevent non-owners from registering members", async function () {
    const [, other] = await ethers.getSigners();
    const registry = await deployRegistry();

    await expect(
      registry.connect(other).registerMember(NULLIFIER, COMMITMENT),
    ).to.be.revertedWithCustomError(registry, "NotOwner");
  });

  describe("rotateMember", function () {
    it("revokes the old commitment and activates the new one atomically", async function () {
      const registry = await deployRegistry();
      await registry.registerMember(NULLIFIER, COMMITMENT);

      await expect(registry.rotateMember(NULLIFIER, OTHER_COMMITMENT))
        .to.emit(registry, "MemberRotated")
        .withArgs(NULLIFIER, COMMITMENT, OTHER_COMMITMENT);

      // Exactly one active identity per human, before and after.
      expect(await registry.verifiedMembers(COMMITMENT)).to.be.false;
      expect(await registry.verifiedMembers(OTHER_COMMITMENT)).to.be.true;
      expect(await registry.commitmentOf(NULLIFIER)).to.equal(OTHER_COMMITMENT);
    });

    it("keeps resolving the revoked commitment to its human", async function () {
      const registry = await deployRegistry();
      await registry.registerMember(NULLIFIER, COMMITMENT);
      await registry.rotateMember(NULLIFIER, OTHER_COMMITMENT);

      // Elections rely on this to reject a second enrollment after a rotation.
      expect(await registry.nullifierOf(COMMITMENT)).to.equal(NULLIFIER);
      expect(await registry.nullifierOf(OTHER_COMMITMENT)).to.equal(NULLIFIER);
    });

    it("refuses to rotate an unregistered human", async function () {
      const registry = await deployRegistry();

      await expect(
        registry.rotateMember(NULLIFIER, COMMITMENT),
      ).to.be.revertedWithCustomError(registry, "NullifierNotRegistered");
    });

    it("refuses to rotate onto a commitment owned by someone else", async function () {
      const registry = await deployRegistry();
      await registry.registerMember(NULLIFIER, COMMITMENT);
      await registry.registerMember(54321n, OTHER_COMMITMENT);

      await expect(
        registry.rotateMember(NULLIFIER, OTHER_COMMITMENT),
      ).to.be.revertedWithCustomError(registry, "IdentityAlreadyVerified");
    });

    it("refuses a no-op rotation", async function () {
      const registry = await deployRegistry();
      await registry.registerMember(NULLIFIER, COMMITMENT);

      await expect(
        registry.rotateMember(NULLIFIER, COMMITMENT),
      ).to.be.revertedWithCustomError(registry, "IdentityAlreadyVerified");
    });

    it("is owner-only", async function () {
      const [, other] = await ethers.getSigners();
      const registry = await deployRegistry();
      await registry.registerMember(NULLIFIER, COMMITMENT);

      await expect(
        registry.connect(other).rotateMember(NULLIFIER, OTHER_COMMITMENT),
      ).to.be.revertedWithCustomError(registry, "NotOwner");
    });
  });
});
