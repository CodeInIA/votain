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

  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
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
      { name: "deadline", type: "uint256" },
    ],
  };
  const deadline = now + 900;
  const signature = await attester.signTypedData(domain, types, {
    identityCommitment: commitment,
    deadline,
  });

  const digest = await election.enrollmentDigest(commitment, deadline);
  check(
    "the contract recovers the attester from its own digest",
    ethers.recoverAddress(digest, signature) === attester.address,
  );

  // Relayed through the paymaster, exactly as the voter's browser does it.
  const paymaster = await ethers.getContractAt("ElectionPaymaster", ElectionPaymaster);
  const tankBefore = await paymaster.gasBalance(organizer.address);
  await (
    await paymaster.connect(voter).relayEnrollAttested(address, commitment, deadline, signature)
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

  const forged = await outsider.signTypedData(domain, types, {
    identityCommitment: other,
    deadline,
  });
  await expectRevert(
    "a signature from anyone else is rejected",
    election.connect(voter).enrollAttested(other, deadline, forged),
    "BadAttestation",
  );

  const stale = now - 60;
  const staleSig = await attester.signTypedData(domain, types, {
    identityCommitment: other,
    deadline: stale,
  });
  await expectRevert(
    "an expired attestation is rejected",
    election.connect(voter).enrollAttested(other, stale, staleSig),
    "AttestationExpired",
  );

  await expectRevert(
    "a swapped commitment is rejected",
    election.connect(voter).enrollAttested(other, deadline, signature),
    "BadAttestation",
  );

  const secondSig = await attester.signTypedData(domain, types, {
    identityCommitment: commitment,
    deadline,
  });
  await expectRevert(
    "the same human cannot enroll twice",
    election.connect(voter).enrollAttested(commitment, deadline, secondSig),
    "AlreadyEnrolled",
  );

  const unregistered = BigInt(ethers.hexlify(ethers.randomBytes(30)));
  const unregSig = await attester.signTypedData(domain, types, {
    identityCommitment: unregistered,
    deadline,
  });
  await expectRevert(
    "an attestation does not replace World ID verification",
    election.connect(voter).enrollAttested(unregistered, deadline, unregSig),
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
  const straySig = await attester.signTypedData(
    { ...domain, verifyingContract: openAddress },
    types,
    { identityCommitment: commitment, deadline: strayDeadline },
  );
  await expectRevert(
    "an attestation is refused where no policy exists",
    openElection.connect(voter).enrollAttested(commitment, strayDeadline, straySig),
    "UnexpectedAttestation",
  );
  console.log();

  console.log(`RESULT  ${passed} passed, ${failed} failed`);
  console.log(`\nRestricted election: ${address}`);
  console.log(`Open election:       ${openAddress}`);
  if (failed > 0) process.exitCode = 1;
}

await main();
