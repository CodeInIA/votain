import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

/**
 * The claim list an organizer publishes elections under.
 *
 * Self-service on purpose: a claim proves nothing on its own, since a reader
 * resolves `_votain.<domain>` and checks the TXT record names this address.
 * Requiring an operator to sign off would add a trusted party to a statement
 * nobody has to trust, which is the opposite of why this left the issuer's disk.
 */

async function deploy() {
  const OrganizerDomains = await ethers.getContractFactory("OrganizerDomains");
  const contract = await OrganizerDomains.deploy();
  await contract.waitForDeployment();
  return contract;
}

describe("OrganizerDomains", function () {
  it("lets an organizer claim their own domains", async function () {
    const domains = await deploy();
    const [organizer] = await ethers.getSigners();

    await expect(domains.claim("votain.app"))
      .to.emit(domains, "DomainClaimed")
      .withArgs(organizer.address, "votain.app");

    expect(await domains.domainsOf(organizer.address)).to.deep.equal(["votain.app"]);
    expect(await domains.claimsDomain(organizer.address, "votain.app")).to.be.true;
  });

  it("needs no operator, so two organizers never wait on each other", async function () {
    // The point of leaving the issuer's disk: nobody has to be online for an
    // organizer to state where they publish.
    const domains = await deploy();
    const [, alice, bob] = await ethers.getSigners();

    await (await domains.connect(alice).claim("alice.example")).wait();
    await (await domains.connect(bob).claim("bob.example")).wait();

    expect(await domains.domainsOf(alice.address)).to.deep.equal(["alice.example"]);
    expect(await domains.domainsOf(bob.address)).to.deep.equal(["bob.example"]);
  });

  it("keeps one organizer's claims out of another's list", async function () {
    const domains = await deploy();
    const [, alice, bob] = await ethers.getSigners();

    await (await domains.connect(alice).claim("shared.example")).wait();

    // Two addresses may claim the same name. DNS decides which one is telling
    // the truth, and it can only ever name one of them.
    await (await domains.connect(bob).claim("shared.example")).wait();
    expect(await domains.claimsDomain(alice.address, "shared.example")).to.be.true;
    expect(await domains.claimsDomain(bob.address, "shared.example")).to.be.true;
  });

  it("refuses the same domain twice from one organizer", async function () {
    const domains = await deploy();
    await (await domains.claim("votain.app")).wait();
    await expect(domains.claim("votain.app")).to.be.revertedWithCustomError(
      domains,
      "DomainAlreadyClaimed",
    );
  });

  it("refuses an empty domain", async function () {
    const domains = await deploy();
    await expect(domains.claim("")).to.be.revertedWithCustomError(domains, "EmptyDomain");
  });

  it("releases a claim without disturbing the others", async function () {
    const domains = await deploy();
    const [organizer] = await ethers.getSigners();

    await (await domains.claim("one.example")).wait();
    await (await domains.claim("two.example")).wait();
    await (await domains.claim("three.example")).wait();

    await expect(domains.release("two.example"))
      .to.emit(domains, "DomainReleased")
      .withArgs(organizer.address, "two.example");

    const left = await domains.domainsOf(organizer.address);
    expect(left).to.have.lengthOf(2);
    expect(left).to.include("one.example");
    expect(left).to.include("three.example");
  });

  it("refuses to release something never claimed", async function () {
    const domains = await deploy();
    await expect(domains.release("ghost.example")).to.be.revertedWithCustomError(
      domains,
      "DomainNotClaimed",
    );
  });

  it("caps the list so one address cannot make reads unbounded", async function () {
    const domains = await deploy();
    const max = Number(await domains.MAX_DOMAINS());

    for (let i = 0; i < max; i++) await (await domains.claim(`d${i}.example`)).wait();
    await expect(domains.claim("one.too.many")).to.be.revertedWithCustomError(
      domains,
      "TooManyDomains",
    );
  });

  it("reads back empty for an address that has claimed nothing", async function () {
    const domains = await deploy();
    const [, stranger] = await ethers.getSigners();
    expect(await domains.domainsOf(stranger.address)).to.deep.equal([]);
    expect(await domains.claimsDomain(stranger.address, "votain.app")).to.be.false;
  });
});
