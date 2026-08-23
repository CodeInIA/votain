import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

/**
 * Two-step ownership transfer on both owner-gated contracts.
 *
 * It matters operationally: the deployer key also owns PlatformRegistry, and the
 * issuer needs that ownership to register and rotate voters. Without a transfer
 * the deployer key would have to live on the issuer server. With it, the deployer
 * stays offline and a dedicated hot wallet does the day-to-day work.
 */
for (const name of ["PlatformRegistry", "ElectionPaymaster"] as const) {
  describe(`${name}, ownership`, () => {
    let owner: any;
    let next: any;
    let stranger: any;
    let c: any;

    beforeEach(async () => {
      [owner, next, stranger] = await ethers.getSigners();
      const F = await ethers.getContractFactory(name);
      c = await F.deploy();
      await c.waitForDeployment();
    });

    it("only the owner can start a transfer", async () => {
      await expect(c.connect(stranger).transferOwnership(next.address)).to.be.revertedWithCustomError(
        c,
        "NotOwner",
      );
    });

    it("rejects the zero address", async () => {
      await expect(c.connect(owner).transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        c,
        "ZeroAddress",
      );
    });

    it("keeps the old owner in charge until the new one accepts", async () => {
      await (await c.connect(owner).transferOwnership(next.address)).wait();

      expect(await c.owner()).to.equal(owner.address);
      expect(await c.pendingOwner()).to.equal(next.address);
    });

    it("only the pending owner can accept", async () => {
      await (await c.connect(owner).transferOwnership(next.address)).wait();

      await expect(c.connect(stranger).acceptOwnership()).to.be.revertedWithCustomError(
        c,
        "NotPendingOwner",
      );

      await expect(c.connect(next).acceptOwnership())
        .to.emit(c, "OwnershipTransferred")
        .withArgs(owner.address, next.address);

      expect(await c.owner()).to.equal(next.address);
      expect(await c.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("revokes the previous owner's powers after the handover", async () => {
      await (await c.connect(owner).transferOwnership(next.address)).wait();
      await (await c.connect(next).acceptOwnership()).wait();

      await expect(c.connect(owner).transferOwnership(stranger.address)).to.be.revertedWithCustomError(
        c,
        "NotOwner",
      );
    });
  });
}
