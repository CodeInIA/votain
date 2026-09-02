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
  /**
   * The vault moved on chain because the only property the store had to provide
   * was availability: a server holding the ciphertext could never read it or
   * forge a vote with it, only refuse to hand it back. These cover what the
   * chain now has to guarantee in its place.
   */
  describe("identity vault", function () {
    const CREDENTIAL = "0x11223344";
    const OTHER_CREDENTIAL = "0xaabbccdd";
    const BLOB = "0xdeadbeefcafe";

    async function registered() {
      const registry = await deployRegistry();
      await (await registry.registerMember(NULLIFIER, COMMITMENT)).wait();
      return registry;
    }

    it("stores one sealed copy per passkey and hands them all back", async function () {
      const registry = await registered();

      await expect(registry.addVaultEntry(NULLIFIER, CREDENTIAL, BLOB))
        .to.emit(registry, "VaultEntryAdded")
        .withArgs(NULLIFIER, CREDENTIAL);
      await (await registry.addVaultEntry(NULLIFIER, OTHER_CREDENTIAL, BLOB)).wait();

      const entries = await registry.getVault(NULLIFIER);
      expect(entries.length).to.equal(2);
      expect(entries[0].credentialId).to.equal(CREDENTIAL);
      expect(entries[0].blob).to.equal(BLOB);
      expect(entries[0].addedAt).to.be.greaterThan(0n);
      expect(await registry.vaultEntryCount(NULLIFIER)).to.equal(2n);
    });

    it("refuses a second copy for the same passkey", async function () {
      // Two blobs that open equally well leave the browser choosing between
      // them with nothing to choose on.
      const registry = await registered();
      await (await registry.addVaultEntry(NULLIFIER, CREDENTIAL, BLOB)).wait();

      await expect(
        registry.addVaultEntry(NULLIFIER, CREDENTIAL, "0xfeed"),
      ).to.be.revertedWithCustomError(registry, "CredentialAlreadyPresent");
    });

    it("refuses a vault for a human the registry does not know", async function () {
      // Without it the chain would hold sealed secrets belonging to nobody, and
      // no enrollment could ever use them.
      const registry = await deployRegistry();
      await expect(
        registry.addVaultEntry(NULLIFIER, CREDENTIAL, BLOB),
      ).to.be.revertedWithCustomError(registry, "NullifierNotRegistered");
    });

    it("refuses an empty credential or an empty blob", async function () {
      const registry = await registered();
      await expect(
        registry.addVaultEntry(NULLIFIER, "0x", BLOB),
      ).to.be.revertedWithCustomError(registry, "EmptyVaultEntry");
      await expect(
        registry.addVaultEntry(NULLIFIER, CREDENTIAL, "0x"),
      ).to.be.revertedWithCustomError(registry, "EmptyVaultEntry");
    });

    it("stops offering a copy once its passkey is removed", async function () {
      const registry = await registered();
      await (await registry.addVaultEntry(NULLIFIER, CREDENTIAL, BLOB)).wait();
      await (await registry.addVaultEntry(NULLIFIER, OTHER_CREDENTIAL, BLOB)).wait();

      await expect(registry.removeVaultEntry(NULLIFIER, CREDENTIAL))
        .to.emit(registry, "VaultEntryRemoved")
        .withArgs(NULLIFIER, CREDENTIAL);

      const entries = await registry.getVault(NULLIFIER);
      expect(entries.length).to.equal(1);
      expect(entries[0].credentialId).to.equal(OTHER_CREDENTIAL);
    });

    it("refuses to remove a passkey it never held", async function () {
      const registry = await registered();
      await expect(
        registry.removeVaultEntry(NULLIFIER, CREDENTIAL),
      ).to.be.revertedWithCustomError(registry, "CredentialNotFound");
    });

    it("drops every old copy on recovery", async function () {
      // The old blobs seal a secret whose commitment `rotateMember` has just
      // revoked. Leaving them offered hands a browser the key to a walled door.
      const registry = await registered();
      await (await registry.addVaultEntry(NULLIFIER, CREDENTIAL, BLOB)).wait();
      await (await registry.addVaultEntry(NULLIFIER, OTHER_CREDENTIAL, BLOB)).wait();

      await (await registry.rotateMember(NULLIFIER, OTHER_COMMITMENT)).wait();
      await expect(registry.resetVault(NULLIFIER, "0x99", "0xc0ffee"))
        .to.emit(registry, "VaultReset");

      const entries = await registry.getVault(NULLIFIER);
      expect(entries.length).to.equal(1);
      expect(entries[0].credentialId).to.equal("0x99");
    });

    it("is owner-only on every write", async function () {
      // A voter has no wallet by design, so the owner writes on their behalf.
      // It is a writer and never a reader: the ciphertext is opaque to it, and
      // a substituted blob would decrypt to a commitment the chain rejects.
      const registry = await registered();
      const [, other] = await ethers.getSigners();

      await expect(
        registry.connect(other).addVaultEntry(NULLIFIER, CREDENTIAL, BLOB),
      ).to.be.revertedWithCustomError(registry, "NotOwner");
      await expect(
        registry.connect(other).removeVaultEntry(NULLIFIER, CREDENTIAL),
      ).to.be.revertedWithCustomError(registry, "NotOwner");
      await expect(
        registry.connect(other).resetVault(NULLIFIER, CREDENTIAL, BLOB),
      ).to.be.revertedWithCustomError(registry, "NotOwner");
    });

    it("reads back as empty for a human with no vault", async function () {
      const registry = await registered();
      expect(await registry.vaultEntryCount(NULLIFIER)).to.equal(0n);
      expect((await registry.getVault(NULLIFIER)).length).to.equal(0);
    });
  });
  /**
   * Credential revocation, published so a verifier can check a session without
   * asking the server that signed it.
   *
   * The slot is handed out at REGISTRATION, not per credential. The issuer used
   * to allocate a fresh index every time it signed a session, which on chain
   * would have been a transaction per sign-in; a human needs one slot, and they
   * already have exactly one registration to hang it off.
   */
  describe("credential status", function () {
    it("gives each human a slot as they register, counting from one", async function () {
      // One based, so zero keeps meaning "not registered" and no caller has to
      // remember a second sentinel.
      const registry = await deployRegistry();
      expect(await registry.statusIndexOf(NULLIFIER)).to.equal(0n);

      await (await registry.registerMember(NULLIFIER, COMMITMENT)).wait();
      expect(await registry.statusIndexOf(NULLIFIER)).to.equal(1n);
      expect(await registry.memberCount()).to.equal(1n);

      await (await registry.registerMember(2n, 3n)).wait();
      expect(await registry.statusIndexOf(2n)).to.equal(2n);
      expect(await registry.memberCount()).to.equal(2n);
    });

    it("costs nothing extra to sign in, because the slot never moves", async function () {
      // The property the design exists for: a slot is assigned once and reused
      // for every credential that human is ever issued.
      const registry = await deployRegistry();
      await (await registry.registerMember(NULLIFIER, COMMITMENT)).wait();
      const slot = await registry.statusIndexOf(NULLIFIER);

      await (await registry.rotateMember(NULLIFIER, OTHER_COMMITMENT)).wait();
      expect(await registry.statusIndexOf(NULLIFIER)).to.equal(slot);
      expect(await registry.memberCount()).to.equal(1n);
    });

    it("revokes and restores a slot", async function () {
      const registry = await deployRegistry();
      await (await registry.registerMember(NULLIFIER, COMMITMENT)).wait();

      expect(await registry.revokedStatus(1n)).to.be.false;
      await expect(registry.revokeStatus(1n)).to.emit(registry, "StatusRevoked").withArgs(1n);
      expect(await registry.revokedStatus(1n)).to.be.true;

      await expect(registry.restoreStatus(1n)).to.emit(registry, "StatusRestored").withArgs(1n);
      expect(await registry.revokedStatus(1n)).to.be.false;
    });

    it("refuses a slot nobody was ever given", async function () {
      // Otherwise a typo would revoke a slot that a future voter then inherits,
      // and they would be locked out on their first sign-in for no reason.
      const registry = await deployRegistry();
      await (await registry.registerMember(NULLIFIER, COMMITMENT)).wait();

      await expect(registry.revokeStatus(0n)).to.be.revertedWithCustomError(
        registry,
        "UnknownStatusIndex",
      );
      await expect(registry.revokeStatus(2n)).to.be.revertedWithCustomError(
        registry,
        "UnknownStatusIndex",
      );
    });

    it("is owner-only, since the issuer signs what it revokes", async function () {
      const registry = await deployRegistry();
      await (await registry.registerMember(NULLIFIER, COMMITMENT)).wait();
      const [, other] = await ethers.getSigners();

      await expect(
        registry.connect(other).revokeStatus(1n),
      ).to.be.revertedWithCustomError(registry, "NotOwner");
      await expect(
        registry.connect(other).restoreStatus(1n),
      ).to.be.revertedWithCustomError(registry, "NotOwner");
    });
  });
});
