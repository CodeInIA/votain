import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

/**
 * The organizer's sealed tally secret, one copy per passkey.
 *
 * What it protects against is not an attacker but an ordinary Tuesday: an
 * organizer signing in on a second browser used to derive a different key from
 * a different passkey, and only found out when a result refused to decrypt.
 * Everything below is about that copy existing, being reachable, and being
 * impossible to delete down to nothing.
 */

const CRED_A = ethers.hexlify(ethers.toUtf8Bytes("credential-a"));
const CRED_B = ethers.hexlify(ethers.toUtf8Bytes("credential-b"));
const BLOB = ethers.hexlify(ethers.randomBytes(60));

async function deploy() {
  const OrganizerVault = await ethers.getContractFactory("OrganizerVault");
  const contract = await OrganizerVault.deploy();
  await contract.waitForDeployment();
  return contract;
}

describe("OrganizerVault", function () {
  it("keeps a sealed copy that reads back whole", async function () {
    const vault = await deploy();
    const [organizer] = await ethers.getSigners();

    await expect(vault.addEntry(CRED_A, BLOB))
      .to.emit(vault, "EntryAdded")
      .withArgs(organizer.address, CRED_A);

    const [entry] = await vault.entriesOf(organizer.address);
    expect(entry.credentialId).to.equal(CRED_A);
    expect(entry.blob).to.equal(BLOB);
    expect(entry.addedAt).to.be.greaterThan(0n);
  });

  it("holds one copy per passkey, which is the point", async function () {
    // Two devices, two PRF outputs, two ciphertexts of the SAME secret. That is
    // what lets the second device derive the first device's tally keys.
    const vault = await deploy();
    const [organizer] = await ethers.getSigners();
    const other = ethers.hexlify(ethers.randomBytes(60));

    await (await vault.addEntry(CRED_A, BLOB)).wait();
    await (await vault.addEntry(CRED_B, other)).wait();

    expect(await vault.entryCount(organizer.address)).to.equal(2n);
  });

  it("refuses the same passkey twice", async function () {
    const vault = await deploy();
    await (await vault.addEntry(CRED_A, BLOB)).wait();
    await expect(vault.addEntry(CRED_A, BLOB)).to.be.revertedWithCustomError(
      vault,
      "EntryAlreadyExists",
    );
  });

  it("keeps one organizer's vault out of another's", async function () {
    const vault = await deploy();
    const [, alice, bob] = await ethers.getSigners();

    await (await vault.connect(alice).addEntry(CRED_A, BLOB)).wait();

    expect(await vault.entryCount(alice.address)).to.equal(1n);
    expect(await vault.entryCount(bob.address)).to.equal(0n);
    expect(await vault.entriesOf(bob.address)).to.deep.equal([]);
  });

  it("needs no operator, so nobody has to be online to add a device", async function () {
    const vault = await deploy();
    const [, alice, bob] = await ethers.getSigners();

    await (await vault.connect(alice).addEntry(CRED_A, BLOB)).wait();
    await (await vault.connect(bob).addEntry(CRED_A, BLOB)).wait();

    // The same credential id under two wallets is fine: they are separate
    // subtrees, and the ciphertext of one is useless to the other anyway.
    expect(await vault.entryCount(alice.address)).to.equal(1n);
    expect(await vault.entryCount(bob.address)).to.equal(1n);
  });

  it("drops one passkey without disturbing the others", async function () {
    const vault = await deploy();
    const [organizer] = await ethers.getSigners();
    const third = ethers.hexlify(ethers.toUtf8Bytes("credential-c"));

    await (await vault.addEntry(CRED_A, BLOB)).wait();
    await (await vault.addEntry(CRED_B, BLOB)).wait();
    await (await vault.addEntry(third, BLOB)).wait();

    await expect(vault.removeEntry(CRED_B))
      .to.emit(vault, "EntryRemoved")
      .withArgs(organizer.address, CRED_B);

    const left = (await vault.entriesOf(organizer.address)).map(e => e.credentialId);
    expect(left).to.have.lengthOf(2);
    expect(left).to.include(CRED_A);
    expect(left).to.include(third);
  });

  it("refuses to remove the last copy", async function () {
    // The loss it prevents is permanent: no key, no result, ever. Refusing in
    // the contract rather than in a confirmation dialog is the difference
    // between a rule and a habit.
    const vault = await deploy();
    await (await vault.addEntry(CRED_A, BLOB)).wait();
    await expect(vault.removeEntry(CRED_A)).to.be.revertedWithCustomError(vault, "LastEntry");
  });

  it("refuses to remove something never added", async function () {
    const vault = await deploy();
    await (await vault.addEntry(CRED_A, BLOB)).wait();
    await (await vault.addEntry(CRED_B, BLOB)).wait();
    const ghost = ethers.hexlify(ethers.toUtf8Bytes("credential-ghost"));
    await expect(vault.removeEntry(ghost)).to.be.revertedWithCustomError(vault, "EntryNotFound");
  });

  it("refuses an empty credential id or an empty blob", async function () {
    const vault = await deploy();
    await expect(vault.addEntry("0x", BLOB)).to.be.revertedWithCustomError(
      vault,
      "EmptyCredentialId",
    );
    await expect(vault.addEntry(CRED_A, "0x")).to.be.revertedWithCustomError(vault, "EmptyBlob");
  });

  it("bounds what one address can make a reader fetch", async function () {
    const vault = await deploy();
    const max = Number(await vault.MAX_ENTRIES());

    for (let i = 0; i < max; i++) {
      await (await vault.addEntry(ethers.hexlify(ethers.toUtf8Bytes(`cred-${i}`)), BLOB)).wait();
    }
    await expect(
      vault.addEntry(ethers.hexlify(ethers.toUtf8Bytes("one-too-many")), BLOB),
    ).to.be.revertedWithCustomError(vault, "TooManyEntries");

    const oversized = ethers.hexlify(ethers.randomBytes(Number(await vault.MAX_BLOB_BYTES()) + 1));
    const fresh = await deploy();
    await expect(fresh.addEntry(CRED_A, oversized)).to.be.revertedWithCustomError(
      fresh,
      "BlobTooLarge",
    );
  });

  it("reads back empty for a wallet that has never organized", async function () {
    const vault = await deploy();
    const [, stranger] = await ethers.getSigners();
    expect(await vault.entriesOf(stranger.address)).to.deep.equal([]);
    expect(await vault.entryCount(stranger.address)).to.equal(0n);
  });
});
