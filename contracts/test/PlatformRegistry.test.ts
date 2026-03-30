import { expect } from "chai";
import hre from "hardhat";

describe("PlatformRegistry", function () {
  it("Should allow the owner to register a member", async function () {
    const [owner, other] = await hre.ethers.getSigners();
    const PlatformRegistry = await hre.ethers.getContractFactory("PlatformRegistry");
    const registry = await PlatformRegistry.deploy();
    await registry.waitForDeployment();

    const mockNullifier = 12345n;
    const mockIdentityCommitment = 67890n;

    await expect(registry.registerMember(mockNullifier, mockIdentityCommitment))
      .to.emit(registry, "MemberVerified")
      .withArgs(mockNullifier, mockIdentityCommitment);

    expect(await registry.registeredNullifiers(mockNullifier)).to.be.true;
    expect(await registry.verifiedMembers(mockIdentityCommitment)).to.be.true;
  });

  it("Should prevent registering the same nullifier twice", async function () {
    const [owner] = await hre.ethers.getSigners();
    const PlatformRegistry = await hre.ethers.getContractFactory("PlatformRegistry");
    const registry = await PlatformRegistry.deploy();
    await registry.waitForDeployment();

    const mockNullifier = 12345n;
    const mockIdentityCommitment1 = 67890n;
    const mockIdentityCommitment2 = 99999n;

    await registry.registerMember(mockNullifier, mockIdentityCommitment1);

    await expect(
      registry.registerMember(mockNullifier, mockIdentityCommitment2)
    ).to.be.revertedWith("Nullifier already registered");
  });

  it("Should prevent non-owners from registering members", async function () {
    const [owner, other] = await hre.ethers.getSigners();
    const PlatformRegistry = await hre.ethers.getContractFactory("PlatformRegistry");
    const registry = await PlatformRegistry.deploy();
    await registry.waitForDeployment();

    const mockNullifier = 12345n;
    const mockIdentityCommitment = 67890n;

    await expect(
      registry.connect(other).registerMember(mockNullifier, mockIdentityCommitment)
    ).to.be.revertedWith("Not owner");
  });
});
