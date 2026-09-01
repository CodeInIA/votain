/**
 * Rich local seed: every phase, every voting type, every outcome.
 *
 * `seed-local.ts` creates three empty elections, which is enough to see the
 * Discover grid but not enough to exercise the app. This one drives real
 * elections through their whole life: registers voters in PlatformRegistry,
 * enrols them through ElectionPaymaster, casts genuine Groth16-proved Paillier
 * ballots, re-votes to show coercion resistance, and publishes decrypted results
 * so every results layout has something to render.
 *
 * Time is moved with `evm_increaseTime`, so the historical elections are created
 * and completed FIRST and the live ones last: the chain clock only goes forward,
 * and an election created earlier would otherwise have its window dragged past.
 *
 * The Paillier private key of each tallyable election is written to
 * `deployments/tally-keys/`, because the UI normally derives it from the
 * organizer passkey and a seeded election has no passkey behind it. Import the
 * file with the "Import decryption key" button in the organizer view.
 *
 * Usage: npx hardhat run scripts/seed-demo.ts --network localhost
 */
import { network } from "hardhat";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";
import { poseidon2 } from "poseidon-lite/poseidon2";
import { generateRandomKeys, PublicKey } from "paillier-bigint";
import type { Wallet } from "ethers";

const { ethers } = await network.connect();

/**
 * Seed only the elections that are still running. Set SEED_LIVE_ONLY=1 to keep
 * the local chain's clock close to the wall clock: without it the finished
 * elections advance it by about two days, which makes the create wizard refuse
 * every date the organizer would naturally pick.
 */
const LIVE_ONLY = process.env.SEED_LIVE_ONLY === "1";

/**
 * Build only the elections whose name contains one of these, comma separated.
 *
 * The seed is not idempotent: running it again against a chain that already has
 * it produces a second copy of all twenty. That makes adding one election to an
 * already-seeded local chain awkward enough that the alternative is throwing the
 * chain away, which also throws away every voter registration on it.
 */
const ONLY = (process.env.SEED_ONLY ?? "")
  .split(",")
  .map(part => part.trim().toLowerCase())
  .filter(Boolean);

const HOUR = 3600;
const DAY = 24 * HOUR;
const COUNTER_BASE = 1_000_000n;
/// 1024-bit keeps seeding quick; the app generates 2048-bit for real elections.
const PAILLIER_BITS = 1024;

const VotingType = {
  SIMPLE_PLURALITY: 0,
  ABSOLUTE_MAJORITY: 1,
  SUPERMAJORITY_TWO_THIRDS: 2,
  WITNESS_THRESHOLD: 3,
} as const;

const toHex = (x: bigint): string => "0x" + x.toString(16);

/// Coarse timing, so a slow seed run says WHERE it is slow instead of just hanging.
const t0 = Date.now();
const elapsed = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
function step(label: string): void {
  console.log(`  [${elapsed()}] ${label}`);
}

/** Ballot ciphertext goes to Solidity as `bytes`, so it must have even length. */
function encryptBallot(pk: PublicKey, optionIndex: number): string {
  const digits = pk.encrypt(COUNTER_BASE ** BigInt(optionIndex)).toString(16);
  return "0x" + (digits.length % 2 === 0 ? digits : "0" + digits);
}

function hashToField(v: bigint): bigint {
  return BigInt(ethers.keccak256(ethers.zeroPadValue(ethers.toBeHex(v), 32))) >> 8n;
}

function voteNullifier(identity: Identity, scope: bigint): bigint {
  return poseidon2([hashToField(scope), identity.secretScalar]);
}

function voteMessage(ciphertext: string, nonce: bigint): bigint {
  return BigInt(ethers.solidityPackedKeccak256(["bytes", "uint256"], [ciphertext, nonce]));
}

async function chainNow(): Promise<number> {
  return (await ethers.provider.getBlock("latest"))!.timestamp;
}

async function advanceTo(target: number): Promise<void> {
  const now = await chainNow();
  if (target > now) {
    await ethers.provider.send("evm_increaseTime", [target - now]);
    await ethers.provider.send("evm_mine", []);
  }
}

interface Spec {
  name: string;
  organizerName: string;
  description: string;
  votingType: number;
  thresholdValue: bigint;
  candidates: { name: string; description?: string }[];
  /// Window offsets in seconds, relative to the moment of creation.
  enrollFrom: number;
  enrollTo: number;
  voteFrom: number;
  voteTo: number;
  /// Which option each seeded voter picks. Length = number of voters who VOTE.
  ballots?: number[];
  /**
   * How many voters enrol, when that is more than the number who vote.
   *
   * Without it the seed can only produce elections at 100% turnout, because it
   * enrols exactly the voters it is about to make vote. Every partially voted
   * election, which is what a live one looks like, was unrepresentable.
   */
  enrollCount?: number;
  /// One voter changes their mind: [voterIndex, replacementOption].
  revote?: [number, number];
  /// What to do once voting closes.
  finish?: "publish" | "leave-tallying" | "void";
  cancelImmediately?: boolean;
  organizerAccount?: number;
  /**
   * Attribute policy. Present means the election is gated: the contract refuses
   * plain `enroll` and the seed has to sign an attestation for each voter, the
   * same way the relay does after a Self proof clears.
   */
  eligibility?: EligibilityPolicy;
  tags?: string[];
}

interface EligibilityPolicy {
  /** How distinct a human the election insists a voter is. Absent means
   *  `document` when attributes are named, `device` when nothing is. */
  personhood?: "device" | "document" | "orb";
  minAge?: number;
  allowedCountries?: string[];
  blockedCountries?: string[];
}

/**
 * Canonical policy form. Must match backend and frontend byte for byte.
 *
 * Returns the OBJECT as well as its JSON, because the metadata has to carry the
 * canonical form too. Writing the spec verbatim while hashing the sorted version
 * produced elections whose published policy did not match their own hash, and
 * the frontend correctly refused to trust them: every policy naming more than
 * one country was quietly unusable.
 */
function canonicalPolicy(policy: EligibilityPolicy): EligibilityPolicy {
  const ordered: EligibilityPolicy = {};
  if (policy.minAge !== undefined) ordered.minAge = policy.minAge;
  if (policy.allowedCountries?.length) ordered.allowedCountries = [...policy.allowedCountries].sort();
  if (policy.blockedCountries?.length) ordered.blockedCountries = [...policy.blockedCountries].sort();
  // Last, matching backend and frontend: policies written before this field
  // existed have to keep serialising to the bytes their hash commits to.
  if (policy.personhood) ordered.personhood = policy.personhood;
  return ordered;
}

function canonicalPolicyJson(policy: EligibilityPolicy): string {
  return JSON.stringify(canonicalPolicy(policy));
}

const ENROLL_ATTESTATION_TYPES = {
  EnrollAttestation: [
    { name: "identityCommitment", type: "uint256" },
    { name: "personhoodNullifier", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * The wallet that signs enrolment attestations for gated elections.
 *
 * Must be the same key the backend holds in ELIGIBILITY_ATTESTER_PRIVATE_KEY,
 * because the address is frozen into each election at creation: seeding with a
 * different one produces elections the running backend can never let anyone
 * into. Only required when a spec declares a policy.
 */
const attesterKey = process.env.SEED_ATTESTER_KEY;
const attesterWallet = attesterKey ? new ethers.Wallet(attesterKey) : null;

async function main(): Promise<void> {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 31337n) throw new Error(`seed-demo is local-only (got chainId ${chainId})`);

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(readFileSync(join(root, "deployments", "local.json"), "utf-8")) as {
    contracts: Record<string, string>;
  };

  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const relayer = signers[9];

  const factory = await ethers.getContractAt(
    "ElectionFactory",
    manifest.contracts.ElectionFactory,
    deployer,
  );
  const registry = await ethers.getContractAt(
    "PlatformRegistry",
    manifest.contracts.PlatformRegistry,
    deployer,
  );
  const paymaster = await ethers.getContractAt(
    "ElectionPaymaster",
    manifest.contracts.ElectionPaymaster,
    relayer,
  );

  const keyDir = join(root, "deployments", "tally-keys");
  mkdirSync(keyDir, { recursive: true });

  // A pool of voters registered on the platform once, reused across elections.
  console.log("Registering demo voters on PlatformRegistry...");
  const voters: Identity[] = [];
  for (let i = 0; i < 8; i++) {
    const identity = new Identity(`votain-demo-voter-${i}`);
    const worldId = BigInt(ethers.keccak256(ethers.toUtf8Bytes(`demo-worldid-${i}`)));
    if (!(await registry.verifiedMembers(identity.commitment))) {
      await (await registry.registerMember(worldId, identity.commitment)).wait();
    }
    voters.push(identity);
  }
  console.log(`  ${voters.length} voters registered\n`);

  async function build(raw: Spec): Promise<void> {
    // Finished elections are what drags the chain clock forward: they have to be
    // created live, voted on, and only then advanced past their voteEnd so the
    // tally can be published. Those jumps accumulate to roughly two days and
    // never come back, since a chain clock only moves forward.
    if (ONLY.length > 0 && !ONLY.some(part => raw.name.toLowerCase().includes(part))) {
      return;
    }

    if (LIVE_ONLY && (raw.finish || raw.cancelImmediately)) {
      console.log(`SKIP ${raw.name}  (live-only seed)`);
      return;
    }

    // Casting a ballot needs the vote window open, so the clock is advanced to
    // reach it, and a chain clock only moves forward. Two of these specs open
    // voting three days out, which cost three days of drift each and put every
    // date an organizer would pick six days out of reach.
    //
    // Compressed for ANY spec that casts a ballot, not only under LIVE_ONLY. An
    // election that already has votes in it necessarily had its window open, so
    // how long ago that happened is not visible anywhere: it is still ACTIVE and
    // still ends when `voteTo` says, which is left alone.
    let spec: Spec = raw.ballots ? { ...raw, enrollTo: 120, voteFrom: 120 } : raw;

    // A FINISHED election is compressed always, and this is what makes seeding
    // every phase compatible with a chain clock that still matches the wall.
    //
    // Publishing a tally means advancing past `voteTo`, and a chain clock only
    // moves forward, so each of these specs used to cost its whole window: at
    // three hours apiece across seven of them, roughly two days of drift that
    // never came back. The window of an election that is already closed carries
    // no information, though. Nobody can see it, nothing in the app reads it,
    // and the tally is identical either way. Seconds do the same job as hours.
    //
    // Sized by the work that happens INSIDE each window, not by the wall clock.
    // Every transaction mines a block, and a block is stamped at least a second
    // after its parent, so enrolling five voters consumes five seconds of chain
    // time however fast the machine is. Two earlier attempts at this were too
    // tight and every enrollment reverted with `EnrollmentNotOpen`. The
    // advances below also step 60 seconds into each window, which sets the
    // floor.
    if (spec.finish) {
      spec = { ...spec, enrollFrom: -30, enrollTo: 60, voteFrom: 60, voteTo: 150 };
    }

    const organizer = signers[spec.organizerAccount ?? 0];
    step(`${spec.name}: generating Paillier key`);
    const keys = await generateRandomKeys(PAILLIER_BITS);
    if (spec.eligibility && !attesterWallet) {
      throw new Error(
        `"${spec.name}" declares an eligibility policy but SEED_ATTESTER_KEY is unset. ` +
          "Set it to the backend's ELIGIBILITY_ATTESTER_PRIVATE_KEY, or the election " +
          "would be deployed naming an attester nobody holds.",
      );
    }

    const created = await chainNow();

    const cfg = {
      name: spec.name,
      votingType: spec.votingType,
      thresholdValue: spec.thresholdValue,
      numOptions: BigInt(spec.candidates.length),
      enrollStart: created + spec.enrollFrom,
      enrollEnd: created + spec.enrollTo,
      voteStart: created + spec.voteFrom,
      voteEnd: created + spec.voteTo,
      scope: BigInt(ethers.hexlify(ethers.randomBytes(31))),
      paillierPublicKey: JSON.stringify({
        n: toHex(keys.publicKey.n),
        g: toHex(keys.publicKey.g),
      }),
      // No keyNonce: the key was not derived from a passkey, so the UI will ask
      // the organizer to import it rather than trying to re-derive it.
      metadataJson: JSON.stringify({
        description: spec.description,
        organizerName: spec.organizerName,
        candidates: spec.candidates,
        privacyQuorum: 3,
        ...(spec.eligibility ? { eligibility: canonicalPolicy(spec.eligibility) } : {}),
        tags: spec.tags ?? ["demo"],
      }),
      eligibilityAttester: spec.eligibility
        ? (attesterWallet as Wallet).address
        : "0x0000000000000000000000000000000000000000",
      eligibilityPolicyHash: spec.eligibility
        ? ethers.keccak256(ethers.toUtf8Bytes(canonicalPolicyJson(spec.eligibility)))
        : "0x" + "00".repeat(32),
    };

    const receipt = await (
      await factory.connect(organizer).createElection(cfg, { value: ethers.parseEther("2") })
    ).wait();
    const address = receipt!.logs
      .map(l => {
        try {
          return factory.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find(p => p?.name === "ElectionCreated")?.args?.electionAddress as string;

    const election = await ethers.getContractAt("ElectionV4", address, organizer);

    if (spec.cancelImmediately) {
      await (await election.cancelElection()).wait();
      console.log(`OK  ${spec.name}\n    -> ${address}  [CANCELLED]`);
      return;
    }

    if (!spec.ballots || spec.ballots.length === 0) {
      console.log(`OK  ${spec.name}\n    -> ${address}`);
      return;
    }

    // Enrolment, relayed exactly as the app does it.
    // Everyone enrolled is a member of the Semaphore group and so of the merkle
    // tree the proofs are built against; only the first `ballots.length` of
    // them go on to cast one.
    const enrolling = Math.max(spec.enrollCount ?? spec.ballots.length, spec.ballots.length);
    step(`  enrolling ${enrolling} voters, ${spec.ballots.length} casting ballots`);
    await advanceTo(created + spec.enrollFrom + 60);
    const participants = voters.slice(0, enrolling);
    for (const v of participants) {
      if (!spec.eligibility) {
        await (await paymaster.relayEnroll(address, v.commitment)).wait();
        continue;
      }

      // Stands in for a Self proof clearing the policy. The seed cannot produce
      // one, but it holds the key the election trusts, so it can sign the same
      // attestation the relay would have signed afterwards.
      const deadline = (await chainNow()) + 900;
      // Stands in for the nullifier a document proof would yield: distinct per
      // seeded voter, so each enrolls once and the contract's reuse check sees
      // the same shape it will see in production.
      const personhoodNullifier =
        BigInt(ethers.keccak256(ethers.toUtf8Bytes(`seed-personhood-${address}-${v.commitment}`))) >> 8n;

      const signature = await (attesterWallet as Wallet).signTypedData(
        { name: "VotainElection", version: "1", chainId, verifyingContract: address },
        ENROLL_ATTESTATION_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>,
        { identityCommitment: v.commitment, personhoodNullifier, deadline },
      );
      await (
        await paymaster.relayEnrollAttested(
          address,
          v.commitment,
          personhoodNullifier,
          deadline,
          signature,
        )
      ).wait();
    }

    // Voting.
    await advanceTo(created + spec.voteFrom + 60);
    const group = new Group(participants.map(v => v.commitment));
    const scope: bigint = await election.scope();

    const castFor = async (voterIndex: number, option: number): Promise<void> => {
      const identity = participants[voterIndex];
      const ciphertext = encryptBallot(keys.publicKey, option);
      const nonce: bigint = await election.nullifierNonces(voteNullifier(identity, scope));
      const proof = await generateProof(identity, group, voteMessage(ciphertext, nonce), scope);
      const p = proof.points.map(BigInt);
      await (
        await paymaster.relayVote(
          address,
          ciphertext,
          BigInt(proof.nullifier),
          BigInt(proof.merkleTreeRoot),
          BigInt(proof.merkleTreeDepth),
          [p[0], p[1]],
          [
            [p[2], p[3]],
            [p[4], p[5]],
          ],
          [p[6], p[7]],
        )
      ).wait();
    };

    for (let i = 0; i < spec.ballots.length; i++) await castFor(i, spec.ballots[i]);

    const finalChoices = [...spec.ballots];
    if (spec.revote) {
      const [voterIndex, replacement] = spec.revote;
      await castFor(voterIndex, replacement);
      finalChoices[voterIndex] = replacement;
    }

    if (spec.finish === "void") {
      await advanceTo(created + spec.voteTo + 60);
      await (await election.markVoided()).wait();
      console.log(`OK  ${spec.name}\n    -> ${address}  [VOIDED]`);
      return;
    }

    if (spec.finish === "publish") {
      await advanceTo(created + spec.voteTo + 60);
      const counts = new Array<bigint>(spec.candidates.length + 1).fill(0n);
      for (const choice of finalChoices) counts[choice] += 1n;
      await (
        await election.publishResults(`Qm${spec.name.slice(0, 8).replace(/\W/g, "")}Demo`, counts)
      ).wait();

      const outcomeNames = ["NONE", "WINNER", "TIE", "APPROVED", "REJECTED", "THRESHOLD_NOT_MET"];
      const outcome = outcomeNames[Number(await election.outcome())];
      console.log(`OK  ${spec.name}\n    -> ${address}  [CLOSED - ${outcome}]`);
      return;
    }

    if (spec.finish === "leave-tallying") {
      await advanceTo(created + spec.voteTo + 60);
      writeFileSync(
        join(keyDir, `${address}.json`),
        JSON.stringify(
          {
            publicKey: { n: toHex(keys.publicKey.n), g: toHex(keys.publicKey.g) },
            privateKey: {
              lambda: toHex(keys.privateKey.lambda),
              mu: toHex(keys.privateKey.mu),
            },
          },
          null,
          2,
        ) + "\n",
      );
      console.log(`OK  ${spec.name}\n    -> ${address}  [TALLYING - key in deployments/tally-keys/]`);
      return;
    }

    console.log(`OK  ${spec.name}\n    -> ${address}  [${spec.ballots.length} votes cast]`);
  }

  // ────────────────────────────────────────────────
  // 1. Finished elections, oldest first (time only moves forward)
  // ────────────────────────────────────────────────
  console.log("Building finished elections...\n");

  await build({
    name: "Bilbao Neighbourhood Association - Annual Board",
    organizerName: "Bilbao City Council",
    description:
      "Election of the Ategorrieta-Uribarri neighbourhood association board for the 2026 term.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [
      { name: "Itziar Zubicaray", description: "Incumbent, community programmes" },
      { name: "Eneko Larranaga", description: "Local business association" },
      { name: "Ainhoa Etxeberria", description: "Youth representative" },
    ],
    enrollFrom: -1,
    enrollTo: HOUR,
    voteFrom: HOUR,
    voteTo: 3 * HOUR,
    ballots: [0, 0, 1, 2, 0],
    revote: [3, 0],
    finish: "publish",
    tags: ["closed", "plurality"],
  });

  await build({
    name: "Tenants Union - Rent Freeze Referendum",
    organizerName: "Tenants Union of Valencia",
    description:
      "Should the union campaign for a city-wide rent freeze? Requires an absolute majority.",
    votingType: VotingType.ABSOLUTE_MAJORITY,
    thresholdValue: 0n,
    candidates: [{ name: "Yes" }, { name: "No" }],
    enrollFrom: -1,
    enrollTo: HOUR,
    voteFrom: HOUR,
    voteTo: 3 * HOUR,
    ballots: [0, 0, 0, 1, 1],
    finish: "publish",
    tags: ["closed", "referendum"],
  });

  await build({
    name: "Founders Agreement - Equal Split Vote",
    organizerName: "Seville Tech Hub Collective",
    description: "Deliberately tied result, to exercise the tie-breaking layout.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [{ name: "Option A" }, { name: "Option B" }],
    enrollFrom: -1,
    enrollTo: HOUR,
    voteFrom: HOUR,
    voteTo: 3 * HOUR,
    ballots: [0, 1, 0, 1],
    finish: "publish",
    tags: ["closed", "tie"],
  });

  await build({
    name: "Wedding of Marta and Julen - Witness Confirmation",
    organizerName: "Marta and Julen",
    description: "Four witnesses must confirm. Only three did, so the threshold is not met.",
    votingType: VotingType.WITNESS_THRESHOLD,
    thresholdValue: 4n,
    candidates: [{ name: "I confirm" }, { name: "I decline" }],
    enrollFrom: -1,
    enrollTo: HOUR,
    voteFrom: HOUR,
    voteTo: 3 * HOUR,
    ballots: [0, 0, 0, 1, 1],
    finish: "publish",
    tags: ["closed", "witness"],
  });

  await build({
    name: "Cooperative Statutes - Two Thirds Amendment",
    organizerName: "Cooperativa La Espiga",
    description: "Amendment to the statutes. Needs at least two thirds of the ballots cast.",
    votingType: VotingType.SUPERMAJORITY_TWO_THIRDS,
    thresholdValue: 0n,
    candidates: [{ name: "Yes" }, { name: "No" }],
    enrollFrom: -1,
    enrollTo: HOUR,
    voteFrom: HOUR,
    voteTo: 3 * HOUR,
    ballots: [0, 0, 0, 0, 1],
    finish: "publish",
    tags: ["closed", "supermajority"],
  });

  await build({
    name: "District Poll - Insufficient Turnout",
    organizerName: "Madrid Municipal Authority",
    description: "Voided after the voting window closed without reaching the privacy quorum.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [{ name: "Proposal A" }, { name: "Proposal B" }],
    enrollFrom: -1,
    enrollTo: HOUR,
    voteFrom: HOUR,
    voteTo: 3 * HOUR,
    ballots: [0, 1],
    finish: "void",
    tags: ["voided"],
  });

  await build({
    name: "Regional Assembly - Delegate Election",
    organizerName: "Madrid Municipal Authority",
    description: "Voting has closed. The organizer still has to decrypt and publish the tally.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [{ name: "Lucia Ferrer" }, { name: "Marcos Idigoras" }, { name: "Nadia Ben Salah" }],
    enrollFrom: -1,
    enrollTo: HOUR,
    voteFrom: HOUR,
    voteTo: 3 * HOUR,
    ballots: [0, 1, 1, 2, 1],
    finish: "leave-tallying",
    tags: ["tallying"],
  });

  await build({
    name: "Chess Club - Cancelled Committee Vote",
    organizerName: "Ateneo Chess Club",
    description: "Called off by the organizer before enrollment closed.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [{ name: "Candidate A" }, { name: "Candidate B" }],
    enrollFrom: -1,
    enrollTo: DAY,
    voteFrom: DAY,
    voteTo: 2 * DAY,
    cancelImmediately: true,
    tags: ["cancelled"],
  });

  // ────────────────────────────────────────────────
  // 2. Live elections, created last so their windows sit in the future
  // ────────────────────────────────────────────────
  console.log("\nBuilding live elections...\n");

  // ACTIVE with ballots already in. Built before the other live ones because it
  // has to walk its own clock forward past voteStart; the rest are created after
  // and get their windows from the new "now".
  //
  // The contract requires enrollEnd <= voteStart, so an election that is already
  // voting can no longer be joined. That is the design, not a limitation of the
  // seed: you enrol first, then vote. To vote yourself, use the election below
  // whose enrollment is still open.
  await build({
    name: "Madrid City Council - District 5 Representative",
    organizerName: "Madrid Municipal Authority",
    description: "Voting is OPEN and ballots are already in. Enrollment for this one has closed.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [
      { name: "Ana Garcia Lopez", description: "Progressive Alliance, urban mobility" },
      { name: "Carlos Martinez Ruiz", description: "People's Party, former district manager" },
      { name: "Sofia Herrera Vega", description: "Green Coalition, environmental engineer" },
    ],
    enrollFrom: -1,
    enrollTo: HOUR,
    voteFrom: HOUR,
    voteTo: 7 * DAY,
    ballots: [0, 1, 0, 2, 0],
    tags: ["active"],
  });

  // The one to actually test the voter flow on: enrollment is open, and voting
  // starts in 10 minutes. Enrol, then either wait, or open it immediately from
  // the organizer view with "close enrollment early".
  await build({
    name: "Neighbourhood Budget - Participatory Vote",
    organizerName: "Madrid Municipal Authority",
    description:
      "ENROL HERE to test voting. Voting opens 10 minutes after seeding, or immediately if the organizer closes enrollment early.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [
      { name: "Repave the plaza" },
      { name: "New library wing" },
      { name: "Bike lane network" },
    ],
    enrollFrom: -60,
    enrollTo: 10 * 60,
    voteFrom: 10 * 60,
    voteTo: 7 * DAY,
    tags: ["enrolling", "test-me"],
  });

  await build({
    name: "UB Student Union - Board Election",
    organizerName: "Universidad de Barcelona",
    description: "Enrollment is OPEN. Join now; voting starts in two days.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [{ name: "List A" }, { name: "List B" }, { name: "List C" }],
    organizerAccount: 4,
    enrollFrom: -HOUR,
    enrollTo: 2 * DAY,
    voteFrom: 2 * DAY,
    voteTo: 5 * DAY,
    tags: ["enrolling"],
  });

  await build({
    name: "Cooperative Board - Witness Confirmation",
    organizerName: "Cooperativa La Espiga",
    description: "Enrollment has closed and voting has not started yet.",
    votingType: VotingType.WITNESS_THRESHOLD,
    thresholdValue: 2n,
    candidates: [{ name: "I confirm" }, { name: "I decline" }],
    enrollFrom: -2 * HOUR,
    enrollTo: -60,
    voteFrom: DAY,
    voteTo: 3 * DAY,
    tags: ["pending-vote"],
  });

  await build({
    name: "Andalusian Green Party - Internal Primary",
    organizerName: "Andalusian Green Party",
    description: "Scheduled. Enrollment opens in three days.",
    votingType: VotingType.ABSOLUTE_MAJORITY,
    thresholdValue: 0n,
    candidates: [{ name: "Yes" }, { name: "No" }],
    enrollFrom: 3 * DAY,
    enrollTo: 6 * DAY,
    voteFrom: 6 * DAY,
    voteTo: 9 * DAY,
    tags: ["upcoming"],
  });

  // A second organizer, so the dashboard per-organizer filtering is testable.
  await build({
    name: "Girona Rowing Club - Captain Election",
    organizerName: "Girona Rowing Club",
    description: "Created by a DIFFERENT organizer account (Hardhat #2).",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [{ name: "Pau Riera" }, { name: "Nuria Camps" }],
    enrollFrom: -HOUR,
    enrollTo: 3 * DAY,
    voteFrom: 3 * DAY,
    voteTo: 6 * DAY,
    organizerAccount: 2,
    tags: ["other-organizer"],
  });


  // ── Restricted elections (attribute policies) ──────────────────────────
  // What the eligibility feature exists for. Only the first carries seeded
  // voters; the rest are left empty on purpose, so there is always a gated
  // election to walk into with a real document and an empty member list.

  await build({
    name: "Elecciones Generales - Circunscripcion Madrid",
    organizerName: "Junta Electoral Central",
    description:
      "Restricted to adults holding Spanish nationality. Enrolment requires proving both from an identity document. The proof reveals neither the date of birth nor anything beyond the nationality being on the allowed list.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [
      { name: "Candidatura A", description: "Coalicion progresista" },
      { name: "Candidatura B", description: "Partido conservador" },
      { name: "Candidatura C", description: "Plataforma ciudadana" },
    ],
    enrollFrom: -HOUR,
    enrollTo: 3 * DAY,
    voteFrom: 3 * DAY,
    voteTo: 6 * DAY,
    ballots: [0, 1, 0],
    eligibility: { minAge: 18, allowedCountries: ["ESP"] },
    tags: ["restricted", "test-me"],
  });

  // Personhood without attributes: the voter scans a document and nothing about
  // it is checked or revealed, the scan being there only to make two
  // enrollments behind one document impossible. Nothing else in this seed
  // covers a policy whose only rule is the level itself.
  await build({
    name: "Neighbourhood Budget - One Person One Vote",
    organizerName: "Asociacion Vecinal",
    description:
      "No age or nationality rule. Voters prove they hold a real identity document, which is what stops one person enrolling twice behind two World ID accounts.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [
      { name: "Repave the square" },
      { name: "New lighting" },
      { name: "Playground" },
    ],
    enrollFrom: -HOUR,
    enrollTo: 3 * DAY,
    voteFrom: 3 * DAY,
    voteTo: 6 * DAY,
    ballots: [0, 2],
    eligibility: { personhood: "document" },
    tags: ["restricted", "test-me"],
  });

  await build({
    name: "Youth Assembly - Age Restricted Ballot",
    organizerName: "Consejo de la Juventud",
    description:
      "Restricted by age alone. Nationality is never asked for, so the proof is a pure yes or no and nothing about the voter's document is disclosed at all.",
    votingType: VotingType.ABSOLUTE_MAJORITY,
    thresholdValue: 0n,
    candidates: [{ name: "Yes" }, { name: "No" }],
    enrollFrom: -HOUR,
    enrollTo: 4 * DAY,
    voteFrom: 4 * DAY,
    voteTo: 8 * DAY,
    eligibility: { minAge: 18 },
    tags: ["restricted", "age-only"],
  });

  // Four live elections whose only purpose is to span the participation bar,
  // from a quarter to full. Everything else in this seed is either untouched or
  // fully voted, so the bar had exactly two appearances to be judged by.
  for (const turnout of [
    { name: "Colegio de Arquitectos - Quarter Turnout", enrolled: 4, voted: 1 },
    { name: "Federacion Deportiva - Half Turnout", enrolled: 4, voted: 2 },
    { name: "Camara de Comercio - Two Thirds Turnout", enrolled: 6, voted: 4 },
    { name: "Circulo de Bellas Artes - Full Turnout", enrolled: 3, voted: 3 },
  ]) {
    await build({
      name: turnout.name,
      organizerName: "Votain Demo",
      description: `Open for voting with ${turnout.voted} of ${turnout.enrolled} enrolled voters having cast a ballot, to show the participation bar part way along.`,
      votingType: VotingType.SIMPLE_PLURALITY,
      thresholdValue: 0n,
      candidates: [{ name: "Option A" }, { name: "Option B" }],
      enrollFrom: -HOUR,
      enrollTo: 120,
      voteFrom: 120,
      voteTo: 9 * DAY,
      enrollCount: turnout.enrolled,
      ballots: Array.from({ length: turnout.voted }, (_, i) => i % 2),
      tags: ["turnout-demo"],
    });
  }

  // The highest bar, and the one nothing else in this seed reaches. `orb` means
  // a document AND an Orb-verified World ID: the document nullifier is still
  // what the contract deduplicates on, and the Orb is checked against the level
  // recorded in the voter's own credential at sign-in.
  await build({
    name: "Colegio de Medicos - Orb Verified Board Election",
    organizerName: "Colegio Oficial de Medicos",
    description:
      "Enrollment is open and demands the strongest personhood available: an identity document plus an Orb-verified World ID. Nothing about age or nationality is asked.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [
      { name: "Dra. Elena Ruiz" },
      { name: "Dr. Marc Soler" },
      { name: "Dra. Nuria Vidal" },
    ],
    enrollFrom: -HOUR,
    enrollTo: 5 * DAY,
    voteFrom: 5 * DAY,
    voteTo: 9 * DAY,
    eligibility: { personhood: "orb" },
    tags: ["restricted", "orb"],
  });

  // The same level with an attribute rule on top, which is the combination that
  // asks the most of a voter: an Orb, a document, and a predicate proved from it.
  await build({
    name: "Consejo General - Orb and Age Restricted",
    organizerName: "Consejo General del Poder Ciudadano",
    description:
      "Open for enrollment. Demands an Orb-verified World ID and an identity document proving the voter is over 18, which is the strictest combination the platform can express.",
    votingType: VotingType.ABSOLUTE_MAJORITY,
    thresholdValue: 0n,
    candidates: [{ name: "Approve" }, { name: "Reject" }],
    enrollFrom: -HOUR,
    enrollTo: 6 * DAY,
    voteFrom: 6 * DAY,
    voteTo: 10 * DAY,
    organizerAccount: 2,
    eligibility: { personhood: "orb", minAge: 18 },
    tags: ["restricted", "orb", "age"],
  });

  await build({
    name: "Notarial Deed - Restricted Witnesses",
    organizerName: "Notaria Perez y Asociados",
    description:
      "A witness threshold with an age requirement, confirming the attested enrolment path works for every voting type and not only for plain plurality.",
    votingType: VotingType.WITNESS_THRESHOLD,
    thresholdValue: 2n,
    candidates: [{ name: "I confirm" }, { name: "I decline" }],
    enrollFrom: -HOUR,
    enrollTo: 2 * DAY,
    voteFrom: 2 * DAY,
    voteTo: 5 * DAY,
    eligibility: { minAge: 18 },
    tags: ["restricted", "witness"],
  });

  await build({
    name: "Iberian Cooperative - Members Assembly",
    organizerName: "Cooperativa Iberica",
    description:
      "Open to several nationalities, and owned by a different organizer. An allowlist of more than one country is where disclosure starts to narrow the anonymity set, which is the tradeoff this policy makes visible.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [{ name: "Proposal A" }, { name: "Proposal B" }],
    enrollFrom: -HOUR,
    enrollTo: 5 * DAY,
    voteFrom: 5 * DAY,
    voteTo: 9 * DAY,
    eligibility: { minAge: 16, allowedCountries: ["ESP", "PRT", "FRA"] },
    organizerAccount: 3,
    tags: ["restricted", "other-organizer"],
  });

  await build({
    name: "Sanctions Compliance Vote - Blocklist",
    organizerName: "Global Trade Association",
    description:
      "Restricted by exclusion rather than by allowlist, and owned by a different organizer. Self expresses this natively, so the voter proves their country is not on the list without revealing which country it is.",
    votingType: VotingType.SUPERMAJORITY_TWO_THIRDS,
    thresholdValue: 0n,
    candidates: [{ name: "Yes" }, { name: "No" }],
    enrollFrom: -HOUR,
    enrollTo: 6 * DAY,
    voteFrom: 6 * DAY,
    voteTo: 10 * DAY,
    eligibility: { minAge: 18, blockedCountries: ["PRK", "IRN"] },
    organizerAccount: 4,
    tags: ["restricted", "blocklist", "other-organizer"],
  });

  console.log(`\nTotal elections on chain: ${await factory.electionsCount()}`);
  console.log(`Main organizer   (Hardhat #0): ${signers[0].address}`);
  console.log(`Other organizers (Hardhat #2/#3/#4): ${signers[2].address}, ${signers[3].address}, ${signers[4].address}`);
  console.log(`Eligibility attester: ${attesterWallet?.address ?? "none (no gated elections)"}`);
  console.log(`Tally keys written to: ${keyDir}`);
}

await main();
