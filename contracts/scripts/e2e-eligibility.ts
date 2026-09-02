/**
 * End-to-end walkthrough of a restricted election, on the local chain.
 *
 * Covers every leg of the flow except the one that needs a phone: the Self app
 * reading a passport chip and producing the zero-knowledge proof. Everything
 * downstream of that proof is exercised for real here, against a deployed
 * election on a running node:
 *
 *   1. Deploy an election declaring a policy (18+, ESP only).
 *   2. Confirm the policy hash the contract stores matches the metadata.
 *   3. Confirm the plain `enroll` path is refused. This is the bypass that made
 *      a backend-only check worthless.
 *   4. Sign an attestation exactly as `backend/src/eligibility/attester.ts` does
 *      and enroll with it, through the paymaster, as the relay would.
 *   5. Confirm the rejections: forged signer, expired deadline, wrong election,
 *      and a second enrollment by the same human.
 *
 * Run against a node started with `npx hardhat node`:
 *   npx hardhat run scripts/e2e-eligibility.ts --network localhost
 */
import { network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const { ethers } = await network.connect();

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ATTESTER_FILE = process.env.ATTESTER_FILE;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? `  (${detail})` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

async function expectRevert(label: string, promise: Promise<unknown>, expected: string) {
  try {
    await promise;
    check(label, false, "did not revert");
  } catch (error: unknown) {
    const message = String(error);
    check(label, message.includes(expected), message.includes(expected) ? expected : message.slice(0, 120));
  }
}

/** Canonical policy form. Must match backend and frontend byte for byte. */
function canonicalPolicyJson(policy: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  if (policy.minAge !== undefined) ordered.minAge = policy.minAge;
  if (policy.allowedCountries) ordered.allowedCountries = policy.allowedCountries;
  if (policy.blockedCountries) ordered.blockedCountries = policy.blockedCountries;
  return JSON.stringify(ordered);
}

async function main() {
  const manifestPath = path.join(process.cwd(), "deployments", "local.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const { ElectionFactory, PlatformRegistry, ElectionPaymaster } = manifest.contracts;

  const [deployer, organizer, voter] = await ethers.getSigners();

  const attesterKey = ATTESTER_FILE
    ? JSON.parse(fs.readFileSync(ATTESTER_FILE, "utf8")).privateKey
    : ethers.Wallet.createRandom().privateKey;
  const attester = new ethers.Wallet(attesterKey);
  const outsider = ethers.Wallet.createRandom();

  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log(`chain ${chainId}, attester ${attester.address}`);
  console.log(`factory ${ElectionFactory}\n`);

  // ── 1. Create the restricted election ──────────────────────────────
  const policy = { minAge: 18, allowedCountries: ["ESP"] };
  const canonical = canonicalPolicyJson(policy);
  const policyHash = ethers.keccak256(ethers.toUtf8Bytes(canonical));

  const metadata = {
    description: "End to end check of an age and nationality restricted election.",
    organizerName: "Votain E2E",
    candidates: [{ name: "Option A" }, { name: "Option B" }],
    privacyQuorum: 1,
    eligibility: policy,
    tags: ["e2e"],
  };

  /**
   * The time the NEXT block will carry, not the time the last one did.
   *
   * On an idle local node those are not close. Hardhat stamps a new block with
   * `max(parentTimestamp + 1, wall clock)`, so against a node last used two days
   * ago every deadline computed from the latest block is already two days stale,
   * and the first attested enrollment reverts with `AttestationExpired` before
   * anything under test has been reached.
   */
  const latestBlock = (await ethers.provider.getBlock("latest"))!.timestamp;
  const now = Math.max(latestBlock, Math.floor(Date.now() / 1000));
  const factory = await ethers.getContractAt("ElectionFactory", ElectionFactory);

  const cfg = {
    name: "Restricted E2E Election",
    votingType: 0,
    thresholdValue: 0n,
    numOptions: 2n,
    enrollStart: now - 10,
    enrollEnd: now + 3600,
    voteStart: now + 3600,
    voteEnd: now + 7200,
    scope: BigInt(ethers.hexlify(ethers.randomBytes(31))),
    paillierPublicKey: '{"n":"0x1234","g":"0x1235"}',
    metadataJson: JSON.stringify(metadata),
    eligibilityAttester: attester.address,
    eligibilityPolicyHash: policyHash,
    personhood: 1,
  };

  console.log("1. Creating a restricted election");
  const createTx = await factory
    .connect(organizer)
    .createElection(cfg, { value: ethers.parseEther("1") });
  const receipt = await createTx.wait();
  const created = receipt!.logs
    .map((log: any) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((entry: any) => entry?.name === "ElectionCreated");
  const address: string = created!.args[0];
  console.log(`   election ${address}\n`);

  const election = await ethers.getContractAt("ElectionV4", address);

  // ── 2. The published policy is the one enrollment is gated on ──────
  console.log("2. Published policy");
  const onChainHash = await election.eligibilityPolicyHash();
  const onChainAttester = await election.eligibilityAttester();
  const storedMetadata = JSON.parse(await election.metadataJson());
  check("attester stored on chain", onChainAttester === attester.address);
  check("policy hash matches the canonical JSON", onChainHash.toLowerCase() === policyHash);
  check(
    "hash recomputed from the metadata agrees",
    ethers.keccak256(ethers.toUtf8Bytes(canonicalPolicyJson(storedMetadata.eligibility))) ===
      onChainHash.toLowerCase(),
    canonical,
  );
  console.log();

  // ── 3. Register the voter on the platform, then try the bypass ─────
  console.log("3. The bypass is closed");
  const registry = await ethers.getContractAt("PlatformRegistry", PlatformRegistry);
  const commitment = BigInt(ethers.hexlify(ethers.randomBytes(30)));
  const human = BigInt(ethers.hexlify(ethers.randomBytes(30)));
  await (await registry.connect(deployer).registerMember(human, commitment)).wait();
  check("voter is platform verified", await registry.verifiedMembers(commitment));

  await expectRevert(
    "plain enroll() is refused on a gated election",
    election.connect(voter).enroll(commitment),
    "AttestationRequired",
  );
  check("nothing was inserted", (await election.hasMember(commitment)) === false);
  console.log();

  // ── 4. The attested path, signed the way the backend signs ─────────
  console.log("4. Attested enrollment");
  const domain = {
    name: "VotainElection",
    version: "1",
    chainId,
    verifyingContract: address,
  };
  const types = {
    EnrollAttestation: [
      { name: "identityCommitment", type: "uint256" },
      { name: "personhoodNullifier", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  /**
   * Stands in for the nullifier a document proof yields for this election.
   * Distinct per person, identical for the same person however many World ID
   * accounts they hold, which is the property the contract now relies on.
   */
  let personhoodSeq = 0n;
  const nextPersonhood = (): bigint => {
    personhoodSeq += 1n;
    return BigInt(ethers.keccak256(ethers.toUtf8Bytes(`personhood-${personhoodSeq}`))) >> 8n;
  };
  const sign = (commitment: bigint, personhood: bigint, dl: number, target = address) =>
    attester.signTypedData(
      { ...domain, verifyingContract: target },
      types,
      { identityCommitment: commitment, personhoodNullifier: personhood, deadline: dl },
    );
  const deadline = now + 900;
  const personhood = nextPersonhood();
  const signature = await sign(commitment, personhood, deadline);

  const digest = await election.enrollmentDigest(commitment, personhood, deadline);
  check(
    "the contract recovers the attester from its own digest",
    ethers.recoverAddress(digest, signature) === attester.address,
  );

  // Relayed through the paymaster, exactly as the voter's browser does it.
  const paymaster = await ethers.getContractAt("ElectionPaymaster", ElectionPaymaster);
  const tankBefore = await paymaster.gasBalance(organizer.address);
  await (
    await paymaster.connect(voter).relayEnrollAttested(address, commitment, personhood, deadline, signature)
  ).wait();
  const tankAfter = await paymaster.gasBalance(organizer.address);

  check("voter is now a member", await election.hasMember(commitment));
  check("member count is 1", (await election.memberCount()) === 1n);
  check("organizer's tank paid the gas", tankAfter < tankBefore,
    `${ethers.formatEther(tankBefore - tankAfter)} POL`);
  console.log();

  // ── 5. The rejections ──────────────────────────────────────────────
  console.log("5. Rejections");
  const other = BigInt(ethers.hexlify(ethers.randomBytes(30)));
  const otherHuman = BigInt(ethers.hexlify(ethers.randomBytes(30)));
  await (await registry.connect(deployer).registerMember(otherHuman, other)).wait();

  const forgedPersonhood = nextPersonhood();
  const forged = await outsider.signTypedData(
    domain,
    types,
    { identityCommitment: other, personhoodNullifier: forgedPersonhood, deadline },
  );
  await expectRevert(
    "a signature from anyone else is rejected",
    election.connect(voter).enrollAttested(other, forgedPersonhood, deadline, forged),
    "BadAttestation",
  );

  const stale = now - 60;
  const stalePersonhood = nextPersonhood();
  const staleSig = await sign(other, stalePersonhood, stale);
  await expectRevert(
    "an expired attestation is rejected",
    election.connect(voter).enrollAttested(other, stalePersonhood, stale, staleSig),
    "AttestationExpired",
  );

  // Fresh nullifier, so what fails is the signature over the wrong commitment
  // rather than the reuse guard.
  const swapPersonhood = nextPersonhood();
  await expectRevert(
    "a swapped commitment is rejected",
    election
      .connect(voter)
      .enrollAttested(other, swapPersonhood, deadline, await sign(commitment, swapPersonhood, deadline)),
    "BadAttestation",
  );

  // Trips on the nullifier rather than on AlreadyEnrolled, because that check
  // comes first now. Either way the second leaf is refused.
  const secondSig = await sign(commitment, personhood, deadline);
  await expectRevert(
    "the same attestation cannot be replayed",
    election.connect(voter).enrollAttested(commitment, personhood, deadline, secondSig),
    "PersonhoodNullifierUsed",
  );

  const unregistered = BigInt(ethers.hexlify(ethers.randomBytes(30)));
  const unregPersonhood = nextPersonhood();
  const unregSig = await sign(unregistered, unregPersonhood, deadline);
  await expectRevert(
    "an attestation does not replace World ID verification",
    election.connect(voter).enrollAttested(unregistered, unregPersonhood, deadline, unregSig),
    "NotPlatformVerified",
  );
  console.log();

  // ── 6. An open election still behaves exactly as before ────────────
  console.log("6. Open elections are untouched");
  const openCfg = {
    ...cfg,
    name: "Open E2E Election",
    scope: BigInt(ethers.hexlify(ethers.randomBytes(31))),
    metadataJson: JSON.stringify({ ...metadata, eligibility: undefined }),
    eligibilityAttester: ZERO_ADDRESS,
    eligibilityPolicyHash: ethers.ZeroHash,
    personhood: 0,
  };
  const openTx = await factory
    .connect(organizer)
    .createElection(openCfg, { value: ethers.parseEther("1") });
  const openReceipt = await openTx.wait();
  const openCreated = openReceipt!.logs
    .map((log: any) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((entry: any) => entry?.name === "ElectionCreated");
  const openAddress: string = openCreated!.args[0];
  const openElection = await ethers.getContractAt("ElectionV4", openAddress);

  await (await openElection.connect(voter).enroll(other)).wait();
  check("plain enroll() still works when no policy is declared", await openElection.hasMember(other));

  const strayDeadline = now + 900;
  const strayPersonhood = nextPersonhood();
  const straySig = await sign(commitment, strayPersonhood, strayDeadline, openAddress);
  await expectRevert(
    "an attestation is refused where no policy exists",
    openElection
      .connect(voter)
      .enrollAttested(commitment, strayPersonhood, strayDeadline, straySig),
    "UnexpectedAttestation",
  );
  console.log();

  // ── 7. The reason the personhood nullifier exists ──────────────────
  // `enrolledHumans` only stops a second enrollment by the same ACCOUNT, and
  // sign-in no longer proves personhood, so somebody with two World ID accounts
  // would otherwise join twice. The document nullifier is the same for both.
  console.log("7. One person, two accounts");
  const twinA = BigInt(ethers.hexlify(ethers.randomBytes(30)));
  const twinB = BigInt(ethers.hexlify(ethers.randomBytes(30)));
  await (
    await registry.connect(deployer).registerMember(BigInt(ethers.hexlify(ethers.randomBytes(30))), twinA)
  ).wait();
  await (
    await registry.connect(deployer).registerMember(BigInt(ethers.hexlify(ethers.randomBytes(30))), twinB)
  ).wait();

  const sharedDocument = nextPersonhood();
  const before = await election.memberCount();

  await (
    await election
      .connect(voter)
      .enrollAttested(twinA, sharedDocument, deadline, await sign(twinA, sharedDocument, deadline))
  ).wait();
  check("the first account enrolls", (await election.memberCount()) === before + 1n);

  await expectRevert(
    "the second account, same document, is refused",
    election
      .connect(voter)
      .enrollAttested(twinB, sharedDocument, deadline, await sign(twinB, sharedDocument, deadline)),
    "PersonhoodNullifierUsed",
  );
  check("no second leaf was added", (await election.memberCount()) === before + 1n);

  await expectRevert(
    "a zero nullifier cannot stand in for a missing proof",
    election.connect(voter).enrollAttested(twinB, 0n, deadline, await sign(twinB, 0n, deadline)),
    "MissingPersonhoodNullifier",
  );
  check("the used nullifier is publicly recorded", await election.usedPersonhoodNullifiers(sharedDocument));
  console.log();

  console.log(`RESULT  ${passed} passed, ${failed} failed`);
  console.log(`\nRestricted election: ${address}`);
  console.log(`Open election:       ${openAddress}`);
  if (failed > 0) process.exitCode = 1;
}

await main();
