/**
 * Rich local seed: every phase, every voting type, every outcome.
 *
 * `seed-local.ts` creates three empty elections, which is enough to see the
 * Discover grid but not enough to exercise the app. This one drives real
 * elections through their whole life: registers voters in PlatformRegistry,
 * enrols them through ElectionPaymaster, casts genuine Groth16-proved ElGamal
 * ballots, re-votes to show coercion resistance, and publishes proved results
 * so every results layout has something to render.
 *
 * Time is moved with `evm_increaseTime`, so the historical elections are created
 * and completed FIRST and the live ones last: the chain clock only goes forward,
 * and an election created earlier would otherwise have its window dragged past.
 *
 * The tally key file of each election left in tallying is written to
 * `deployments/tally-keys/`, because the UI normally derives the keys from the
 * organizer's wallet and a seeded election has no wallet signature behind it.
 * Import the file with the "Import decryption key" button in the organizer view.
 *
 * Needs the circuits built (`npm run build` in circuits/): every ballot and
 * every result is proved for real, against the verifiers deploy.ts installed.
 *
 * Usage: npx hardhat run scripts/seed-demo.ts --network localhost
 */
import { network } from "hardhat";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Identity } from "@semaphore-protocol/identity";
import type { Wallet } from "ethers";
import { deriveTallyKeys, flattenPoints } from "../../frontend/src/lib/ballotCrypto.js";
import { proveBallot, proveTally } from "./lib/prover.js";
import { createHmac } from "node:crypto";

const { ethers } = await network.getOrCreate();

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

/**
 * Privacy quorum for seeded elections. Below the number of voters each spec
 * enrolls, so the demo can still publish a result; a quorum nothing reaches
 * would make every seeded election end voided, which demonstrates the rule but
 * nothing else.
 */
const SEED_PRIVACY_QUORUM = 3;

const VotingType = {
  SIMPLE_PLURALITY: 0,
  ABSOLUTE_MAJORITY: 1,
  SUPERMAJORITY_TWO_THIRDS: 2,
  WITNESS_THRESHOLD: 3,
} as const;


/// Coarse timing, so a slow seed run says WHERE it is slow instead of just hanging.
const t0 = Date.now();
const elapsed = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
function step(label: string): void {
  console.log(`  [${elapsed()}] ${label}`);
}

/**
 * The time the NEXT block will carry, not the time the last one did.
 *
 * WHY THE DIFFERENCE MATTERS HERE. Every window this script builds is written
 * relative to this number, and then a transaction opens it. Hardhat stamps a
 * new block from the wall clock, so if the node has been sitting idle the last
 * block can be minutes old: the window gets written around a moment that has
 * already passed, and the election is created after its own enrolment closed.
 * The first one then fails with `EnrollmentNotOpen`, which reads like a timing
 * budget that is too tight and is nothing of the kind. Running deploy and seed
 * back to back hid it, and a pause between them was enough to show it.
 *
 * The raw call because `provider.getBlock("pending")` throws in ethers v6: a
 * pending block has `number: null` and the parser refuses it. The wall clock is
 * in the maximum as a floor, since a node with no pending block answers with
 * the latest one.
 *
 * The backend had exactly this bug in `attestationBaseTime`, where enrolment
 * attestations came out already expired. Same cause, same fix.
 */
async function chainNow(): Promise<number> {
  const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
  let pending = 0;
  try {
    const raw = (await ethers.provider.send("eth_getBlockByNumber", ["pending", false])) as
      | { timestamp?: string }
      | null;
    if (raw?.timestamp) pending = Number(BigInt(raw.timestamp));
  } catch {
    // No pending block on this node: the two below still answer.
  }
  return Math.max(latest, pending, Math.floor(Date.now() / 1000));
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
  /**
   * The organizer gave up the power to move any deadline.
   *
   * Set on some of the seeded elections and not others, so both answers are
   * visible in the interface. Showing only the reassuring one would make its
   * absence unreadable: nobody can tell a missing badge from a badge they have
   * never seen.
   */
  fixedSchedule?: boolean;
  /**
   * Whether the organizer may call it off, a promise separate from the dates.
   * Set on one seeded election so both answers are visible in the interface.
   */
  cancellable?: boolean;
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
  /**
   * Fewest distinct voters a publishable result may rest on.
   *
   * Per election because the contract stores it per election, and because the
   * seed needs one that can publish a result resting on a single voter: the
   * re-vote accounting is only visible when the number of BALLOTS and the
   * number of VOTERS differ, and the smaller both are the plainer the
   * difference reads. `publishResults` reverts below this, so the default of
   * three makes that election impossible to seed.
   */
  privacyQuorum?: number;
  /// What to do once voting closes.
  finish?: "publish" | "leave-tallying" | "void";
  cancelImmediately?: boolean;
  organizerAccount?: number;
  /**
   * Native token reserved for this election, as a decimal string.
   *
   * Attached at creation, so it lands in the election's own reserve and cannot
   * be withdrawn until it ends. Set to "0" for the ones that exist to show what
   * an unfunded election looks like to a voter: no relay can be paid, so they
   * are told before they spend two minutes on a proof. Those specs must cast no
   * ballots, since seeding one would need the gas that is deliberately absent.
   */
  deposit?: string;
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
const PERSONHOOD_ENUM = { device: 0, document: 1, orb: 2 } as const;

/** Mirrors `effectivePersonhood`: attributes imply a document even unstated. */
function effectiveLevel(policy: EligibilityPolicy): "device" | "document" | "orb" {
  if (policy.personhood) return policy.personhood;
  const hasAttributes =
    policy.minAge !== undefined ||
    (policy.allowedCountries?.length ?? 0) > 0 ||
    (policy.blockedCountries?.length ?? 0) > 0;
  return hasAttributes ? "document" : "device";
}

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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** A seeded voter: their platform identity, and the human behind it. */
interface SeedVoter {
  identity: Identity;
  /** The World ID nullifier, which is what an enrolment tag is derived from. */
  worldId: bigint;
}

const ENROLL_ATTESTATION_TYPES = {
  EnrollAttestation: [
    { name: "identityCommitment", type: "uint256" },
    { name: "personhoodNullifier", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const PRIVATE_ENROLLMENT_TYPES = {
  PrivateEnrollment: [
    { name: "identityCommitment", type: "uint256" },
    { name: "humanTag", type: "uint256" },
    { name: "documentTag", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * The identity a voter derives for ONE election.
 *
 * MIRRORS frontend/src/lib/electionIdentity.ts, and has to: a seeded voter and
 * a real one are the same kind of thing, and a seed that derived differently
 * would produce a chain the app cannot read itself into.
 */
async function electionIdentity(master: Identity, electionAddress: string): Promise<Identity> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(master.privateKey)),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(
        "votain/election-identity/v1:" + electionAddress.toLowerCase(),
      ),
    },
    ikm,
    256,
  );
  const seed = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("");
  return new Identity(seed);
}

/**
 * The tag that says "this person, here", and nothing anywhere else.
 *
 * MIRRORS `humanTagFor` in backend/src/eligibility/attester.ts, including the
 * per-epoch key it is derived under (ENROLMENT_TAG_KEYS). The two have to agree, because a voter seeded here
 * may later enrol through the running dApp in the same election, and a second
 * tag for the same human would be a second leaf and a second vote.
 */
function tagKeyFor(createdAtSeconds: number): string {
  const d = new Date(createdAtSeconds * 1000);
  const epoch = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const secret = tagKeys?.[epoch];
  if (!secret) {
    throw new Error(
      `no enrolment tag key for epoch ${epoch}: set ENROLMENT_TAG_KEYS in backend/.env ` +
        "(or SEED_TAG_KEYS here) to the same JSON the backend uses",
    );
  }
  return "0x" + createHmac("sha256", "votain/enrolment-tag/v2").update(secret).digest("hex");
}

function humanTagFor(worldIdNullifier: bigint, electionAddress: string, createdAt: number): bigint {
  return BigInt(
    ethers.solidityPackedKeccak256(
      ["bytes32", "uint256", "address"],
      [tagKeyFor(createdAt), worldIdNullifier, ethers.getAddress(electionAddress)],
    ),
  );
}

/** MIRRORS `documentTagFor` in backend/src/eligibility/attester.ts, for the same reason. */
function documentTagFor(documentNullifier: bigint, electionAddress: string, createdAt: number): bigint {
  return BigInt(
    ethers.solidityPackedKeccak256(
      ["bytes32", "string", "uint256", "address"],
      [tagKeyFor(createdAt), "votain/document-tag/v1", documentNullifier, ethers.getAddress(electionAddress)],
    ),
  );
}

/**
 * The wallet that signs enrolment attestations for gated elections.
 *
 * Must be the same key the backend holds in ELIGIBILITY_ATTESTER_PRIVATE_KEY,
 * because the address is frozen into each election at creation: seeding with a
 * different one produces elections the running backend can never let anyone
 * into. Only required when a spec declares a policy.
 *
 * Read out of the backend's own .env rather than asked for on every run. The
 * two values have to agree, so passing it by hand was the only way to make them
 * disagree, and a mismatch is invisible until someone tries to enrol.
 * SEED_ATTESTER_KEY still wins when set, which is what testing a deliberately
 * wrong attester needs.
 */
function readAttesterKey(): string | undefined {
  if (process.env.SEED_ATTESTER_KEY) return process.env.SEED_ATTESTER_KEY;

  const backendEnv = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backend", ".env");
  try {
    const line = readFileSync(backendEnv, "utf-8").match(
      /^ELIGIBILITY_ATTESTER_PRIVATE_KEY=(.+)$/m,
    );
    return line?.[1].trim() || undefined;
  } catch {
    // No backend checkout next door. Fall through to the error raised at the
    // first gated election, which already says what to set.
    return undefined;
  }
}

const attesterKey = readAttesterKey();

/** The backend's ENROLMENT_TAG_KEYS, read the same way and for the same reason. */
function readTagKeys(): Record<string, string> | undefined {
  const raw =
    process.env.SEED_TAG_KEYS ??
    (() => {
      try {
        const backendEnv = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backend", ".env");
        return readFileSync(backendEnv, "utf-8").match(/^ENROLMENT_TAG_KEYS=(.+)$/m)?.[1].trim();
      } catch {
        return undefined;
      }
    })();
  if (!raw) return undefined;
  return JSON.parse(raw.replace(/^'(.*)'$/, "$1")) as Record<string, string>;
}

const tagKeys = readTagKeys();
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
  const voters: SeedVoter[] = [];
  for (let i = 0; i < 8; i++) {
    const identity = new Identity(`votain-demo-voter-${i}`);
    const worldId = BigInt(ethers.keccak256(ethers.toUtf8Bytes(`demo-worldid-${i}`)));
    if (!(await registry.verifiedMembers(identity.commitment))) {
      await (await registry.registerMember(worldId, identity.commitment)).wait();
    }
    // The World ID nullifier is kept now, where the old seed threw it away:
    // private enrolment needs it to derive this person's tag for each election.
    voters.push({ identity, worldId });
  }

  /**
   * Which door the elections seeded here have.
   *
   * Frozen into every election by the factory, so it is read once. Zero means
   * this chain was deployed without a platform key and the old public paths are
   * what the contracts accept.
   */
  const platformAttester: string = await factory.platformAttester();
  const enrolsPrivately = platformAttester !== ZERO_ADDRESS;
  if (enrolsPrivately) {
    if (!attesterWallet) {
      throw new Error(
        "This factory deploys elections that enrol privately, which needs the platform key. " +
          "Put ELIGIBILITY_ATTESTER_PRIVATE_KEY in backend/.env (the deploy script reads the " +
          "same value) or set SEED_ATTESTER_KEY.",
      );
    }
    if ((attesterWallet as Wallet).address.toLowerCase() !== platformAttester.toLowerCase()) {
      throw new Error(
        `The key this seed holds (${(attesterWallet as Wallet).address}) is not the one the ` +
          `factory names (${platformAttester}). Every enrolment would be refused.`,
      );
    }
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
    //
    // The voting window is sized by the PROVING too. A local node stamps blocks
    // from the wall clock, and each ballot is a real Groth16 proof that takes
    // seconds to make, so a window sized for instant ballots closed before the
    // last of them landed. A minute per ballot is generous on any machine.
    if (spec.finish) {
      const ballots = (spec.ballots?.length ?? 0) + (spec.revote ? 1 : 0);
      spec = { ...spec, enrollFrom: -30, enrollTo: 60, voteFrom: 60, voteTo: 120 + 60 * ballots };
    }

    const organizer = signers[spec.organizerAccount ?? 0];
    // Random, and kept: a seeded election has no wallet to derive them from.
    const keys = await deriveTallyKeys(crypto.getRandomValues(new Uint8Array(32)), "seed", spec.candidates.length + 1);
    if (spec.eligibility && !attesterWallet) {
      throw new Error(
        `"${spec.name}" declares an eligibility policy but no attester key was found. ` +
          "Expected ELIGIBILITY_ATTESTER_PRIVATE_KEY in backend/.env, or SEED_ATTESTER_KEY " +
          "in the environment. Without it the election would be deployed naming an " +
          "attester nobody holds.",
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
      tallyKeys: flattenPoints(keys.keys),
      // No keyNonce: the keys were not derived from a wallet, so the UI will ask
      // the organizer to import them rather than trying to re-derive them.
      metadataJson: JSON.stringify({
        description: spec.description,
        organizerName: spec.organizerName,
        candidates: spec.candidates,
        privacyQuorum: spec.privacyQuorum ?? SEED_PRIVACY_QUORUM,
        ...(spec.eligibility ? { eligibility: canonicalPolicy(spec.eligibility) } : {}),
        tags: spec.tags ?? ["demo"],
      }),
      eligibilityAttester: spec.eligibility
        ? (attesterWallet as Wallet).address
        : "0x0000000000000000000000000000000000000000",
      eligibilityPolicyHash: spec.eligibility
        ? ethers.keccak256(ethers.toUtf8Bytes(canonicalPolicyJson(spec.eligibility)))
        : "0x" + "00".repeat(32),
      // Mirrors `ElectionV4.PersonhoodLevel`. The constructor refuses a DEVICE
      // election that names an attester, so this has to agree with the policy.
      personhood: spec.eligibility ? PERSONHOOD_ENUM[effectiveLevel(spec.eligibility)] : 0,
      // The same number the metadata declares. Two copies that disagree would
      // put the interface and the contract on different sides of the same rule.
      privacyQuorum: BigInt(spec.privacyQuorum ?? SEED_PRIVACY_QUORUM),
      // Immutable in the contract: this is the only moment it can be decided.
      fixedSchedule: spec.fixedSchedule ?? false,
      cancellable: spec.cancellable ?? true,
    };

    const receipt = await (
      await factory
        .connect(organizer)
        .createElection(cfg, 0n, { value: ethers.parseEther(spec.deposit ?? "2") })
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
    /**
     * Who votes here, under the name this election knows them by.
     *
     * A derived identity where the election enrols privately, the platform one
     * where it does not, and from here on nothing cares which: the group, the
     * proofs and the receipts all use whatever is in this list.
     */
    const voting: Identity[] = [];

    for (const v of participants) {
      if (enrolsPrivately) {
        const identity = await electionIdentity(v.identity, address);
        const tag = humanTagFor(v.worldId, address, created);
        // Stands in for the nullifier a document proof would yield, as below.
        const documentTag = spec.eligibility
          ? documentTagFor(
              BigInt(ethers.keccak256(ethers.toUtf8Bytes(`seed-document-${address}-${v.worldId}`))) >> 8n,
              address,
              created,
            )
          : 0n;
        const deadline = (await chainNow()) + 900;
        const signature = await (attesterWallet as Wallet).signTypedData(
          { name: "VotainElection", version: "1", chainId, verifyingContract: address },
          PRIVATE_ENROLLMENT_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>,
          { identityCommitment: identity.commitment, humanTag: tag, documentTag, deadline },
        );
        // The gated case needs the organizer's gatekeeper too, and the seed
        // holds that key as well: same digest, same signer, same signature.
        await (
          await paymaster.relayEnrollPrivate(
            address,
            identity.commitment,
            tag,
            documentTag,
            deadline,
            signature,
            spec.eligibility ? signature : "0x",
          )
        ).wait();
        voting.push(identity);
        continue;
      }

      voting.push(v.identity);
      if (!spec.eligibility) {
        await (await paymaster.relayEnroll(address, v.identity.commitment)).wait();
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
        BigInt(
          ethers.keccak256(ethers.toUtf8Bytes(`seed-personhood-${address}-${v.identity.commitment}`)),
        ) >> 8n;

      const signature = await (attesterWallet as Wallet).signTypedData(
        { name: "VotainElection", version: "1", chainId, verifyingContract: address },
        ENROLL_ATTESTATION_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>,
        { identityCommitment: v.identity.commitment, personhoodNullifier, deadline },
      );
      await (
        await paymaster.relayEnrollAttested(
          address,
          v.identity.commitment,
          personhoodNullifier,
          deadline,
          signature,
        )
      ).wait();
    }

    // Voting.
    await advanceTo(created + spec.voteFrom + 60);
    /**
     * Proved and relayed exactly as a voter's browser does it. `epoch` is how
     * the seed re-votes without waiting: one ballot per voter per epoch, and a
     * proof may name the current epoch or the one before, so a re-vote proved
     * for the previous epoch lands straight away. Waiting an hour instead would
     * push the chain clock an hour past the wall for every election after it.
     */
    const castFor = async (voterIndex: number, option: number, epoch?: bigint): Promise<void> => {
      const { ballot, proof } = await proveBallot(election, voting[voterIndex], option, { epoch });
      await (await paymaster.relayVote(address, ballot, proof)).wait();
    };

    step(`${spec.name}: proving ${spec.ballots.length} ballots`);
    for (let i = 0; i < spec.ballots.length; i++) await castFor(i, spec.ballots[i]);

    const finalChoices = [...spec.ballots];
    if (spec.revote) {
      const [voterIndex, replacement] = spec.revote;
      await castFor(voterIndex, replacement, (await election.currentEpoch()) - 1n);
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
      // Proved exactly as the organizer's browser proves it, and checked by
      // the election before it accepts the result.
      const tally = await proveTally(election, keys.secrets);
      const expected = new Array<bigint>(spec.candidates.length + 1).fill(0n);
      for (const choice of finalChoices) expected[choice] += 1n;
      if (tally.counts.join() !== expected.join()) {
        throw new Error(`${spec.name}: tallied ${tally.counts.join()}, expected ${expected.join()}`);
      }
      await (
        await election.publishResults(`Qm${spec.name.slice(0, 8).replace(/\W/g, "")}Demo`, tally.counts, tally.proof)
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
        // The format `tallyKey.ts` exports and imports.
        JSON.stringify({ version: 2, secrets: keys.secrets.map(x => "0x" + x.toString(16)) }, null, 2) + "\n",
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
    organizerName: "Wheatsheaf Cooperative",
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
    fixedSchedule: true,
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
    fixedSchedule: true,
    organizerName: "University of Barcelona",
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
    organizerName: "Wheatsheaf Cooperative",
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
    name: "General Election - Madrid Constituency",
    fixedSchedule: true,
    organizerName: "Central Electoral Board",
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
    organizerName: "Neighbourhood Association",
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
    organizerName: "Youth Council",
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
    { name: "Institute of Architects - Quarter Turnout", enrolled: 4, voted: 1 },
    { name: "Sports Federation - Half Turnout", enrolled: 4, voted: 2 },
    { name: "Chamber of Commerce - Two Thirds Turnout", enrolled: 6, voted: 4 },
    { name: "Fine Arts Circle - Full Turnout", enrolled: 3, voted: 3 },
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
    name: "Medical Association - Orb Verified Board Election",
    fixedSchedule: true,
    organizerName: "Medical Association",
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
    name: "General Council - Orb and Age Restricted",
    organizerName: "General Council of Citizen Power",
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
    fixedSchedule: true,
    organizerName: "Perez and Partners Notary",
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
    organizerName: "Iberian Cooperative",
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


  // ────────────────────────────────────────────────
  // Cases the interface has to handle and the set above never produced.
  //
  // All of these belong to Hardhat #0, the account the browser connects with,
  // so every control on them can actually be pressed during a demo.
  // ────────────────────────────────────────────────

  // UPCOMING, and the organizer kept the lever: the only election where
  // "Open enrollment now" appears at all.
  await build({
    name: "Neighbourhood Assembly - March Meeting",
    organizerName: "Delicias Neighbourhood Association",
    description:
      "Announced for next week and not yet open. The organizer kept the power to bring enrolment forward, so the button to do it is on their panel.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [
      { name: "Carmen Ibanez", description: "Current secretary" },
      { name: "Rafael Montes", description: "Sports section" },
    ],
    enrollFrom: 2 * DAY,
    enrollTo: 5 * DAY,
    voteFrom: 5 * DAY,
    voteTo: 8 * DAY,
    tags: ["upcoming", "movable"],
  });

  // UPCOMING with the schedule given up: the same screen with the lever gone,
  // which is what makes the promise legible side by side with the one above.
  await build({
    name: "Arbitration Board - Binding Award",
    organizerName: "Zaragoza Arbitration Chamber",
    description:
      "Announced with dates the organizer can no longer move. Nothing about this election can be brought forward or cut short, which is the whole point of an arbitration timetable.",
    votingType: VotingType.SUPERMAJORITY_TWO_THIRDS,
    thresholdValue: 0n,
    candidates: [{ name: "Uphold the award" }, { name: "Set it aside" }],
    enrollFrom: DAY,
    enrollTo: 4 * DAY,
    voteFrom: 4 * DAY,
    voteTo: 7 * DAY,
    fixedSchedule: true,
    tags: ["upcoming", "fixed-schedule"],
  });

  // ENROLLING with a fixed schedule: closing enrolment early is refused by the
  // contract, so the panel offers nothing to press.
  await build({
    name: "Institute of Architects - Board Renewal",
    organizerName: "Institute of Architects",
    description:
      "Enrolment is open and closes on the published date, whatever the roll looks like by then. The organizer gave up the power to cut it short when the election was created.",
    votingType: VotingType.ABSOLUTE_MAJORITY,
    thresholdValue: 0n,
    candidates: [
      { name: "Lista Continuidad" },
      { name: "Lista Renovacion" },
      { name: "Lista Independiente" },
    ],
    enrollFrom: -HOUR,
    enrollTo: 5 * DAY,
    voteFrom: 5 * DAY,
    voteTo: 9 * DAY,
    fixedSchedule: true,
    // No `ballots`, and none intended: an empty array is not the same as
    // absent here. It reads as truthy, so the window compression for elections
    // that already voted would fire and crush the five-day enrolment this spec
    // exists to show, and the enrolment loop returns early on it anyway.
    tags: ["enrolling", "fixed-schedule"],
  });

  // ACTIVE with a fixed schedule: voting runs to its published end, and the
  // organizer cannot end it once the count starts looking a certain way.
  await build({
    name: "Metalworkers Union - Agreement Ratification",
    organizerName: "Metalworkers Union",
    description:
      "A ratification ballot whose closing time was fixed at deployment. Turnout is public while it runs, and being unable to react to it is exactly what the fixed schedule is for.",
    votingType: VotingType.ABSOLUTE_MAJORITY,
    thresholdValue: 0n,
    candidates: [{ name: "Ratify" }, { name: "Reject" }],
    enrollFrom: -2 * HOUR,
    enrollTo: HOUR,
    voteFrom: HOUR,
    voteTo: 4 * DAY,
    fixedSchedule: true,
    enrollCount: 5,
    ballots: [0, 0, 1],
    tags: ["active", "fixed-schedule"],
  });

  // ENROLLING with NOTHING behind it. A voter is told before they start that no
  // relay can be paid, and the enrol button is refused rather than failing after
  // the proof. Casts no ballots, because seeding one would need the gas this
  // election exists to be missing.
  await build({
    name: "Cycling Club - Voting Without Funds",
    organizerName: "Ebro Cycling Club",
    description:
      "Created without reserving anything. Every ballot here is paid for by the organizer, so until they top it up nobody can enrol or vote, and the app says so instead of failing halfway.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [{ name: "Moncayo route" }, { name: "Ebro route" }],
    enrollFrom: -HOUR,
    enrollTo: 6 * DAY,
    voteFrom: 6 * DAY,
    voteTo: 9 * DAY,
    deposit: "0",
    tags: ["enrolling", "unfunded"],
  });

  // Funded, but not for everyone who enrolled: the warning between the two,
  // which no other election on the chain produces. Roughly three ballots of gas
  // against five people who have not voted.
  await build({
    name: "Farming Cooperative - Tight Funds",
    organizerName: "Jalon Farming Cooperative",
    description:
      "There is a reserve here, but not enough for everyone still expected to vote. The election works and says so, which is a different thing from being empty.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [{ name: "Build a new hall" }, { name: "Repair the existing one" }],
    enrollFrom: -2 * HOUR,
    enrollTo: HOUR,
    voteFrom: HOUR,
    voteTo: 5 * DAY,
    deposit: "0.1",
    enrollCount: 5,
    ballots: [0],
    tags: ["active", "underfunded"],
  });


  // The re-vote, on its own, with nothing else in the way.
  //
  // One voter, two ballots, one counted vote. It exists because four different
  // screens draw the same bar chart and two of them used to divide by BALLOTS:
  // this election read 100% on the organizer's panel and 50% on the voter's,
  // for the same single vote. The coercion-resistant re-vote is the only thing
  // that makes those two numbers differ, so it is the only thing that catches
  // it, and nothing else on this chain produces the case.
  await build({
    name: "Ethics Committee - Replaced Vote",
    organizerName: "Professional Ethics Committee",
    description:
      "A single voter who voted, thought better of it, and voted again. The chain holds two ballots and one vote: the later one replaces the earlier, which is what makes a coerced vote recoverable. The published tally counts one.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [
      { name: "Archivar el expediente" },
      { name: "Abrir investigacion" },
    ],
    enrollFrom: -HOUR,
    enrollTo: HOUR,
    voteFrom: HOUR,
    voteTo: 2 * HOUR,
    ballots: [0],
    revote: [0, 1],
    // One voter cannot publish anything under the default of three, and one
    // voter is the entire point here.
    privacyQuorum: 1,
    finish: "publish",
    tags: ["closed", "revote", "coercion-resistance"],
  });


  // ────────────────────────────────────────────────
  // Every combination of the two promises an election can make, plus the phase
  // that had no way out of it. All under Hardhat #0, the account the browser
  // connects with, so each control can be pressed during a demo.
  //
  // The pair is deliberately not one switch: an election can keep its dates and
  // still be stoppable, or be unstoppable with dates that move. Seeding all four
  // is the only way to see whether the two badges read clearly side by side.
  // ────────────────────────────────────────────────

  // FIXED DATES AND NO WAY BACK. The strongest thing an organizer can promise
  // here: published dates, no early close, no cancellation.
  await build({
    name: "Statutory Referendum - Full Commitment",
    organizerName: "Aragon Civic Foundation",
    description:
      "Announced dates that cannot move and no power to call it off. Whatever the turnout looks like, this election runs exactly as published, which is the strongest commitment the platform lets an organizer make.",
    votingType: VotingType.SUPERMAJORITY_TWO_THIRDS,
    thresholdValue: 0n,
    candidates: [{ name: "Approve the amendment" }, { name: "Keep the statutes as they are" }],
    enrollFrom: -HOUR,
    enrollTo: 4 * DAY,
    voteFrom: 4 * DAY,
    voteTo: 8 * DAY,
    fixedSchedule: true,
    cancellable: false,
    tags: ["enrolling", "fixed-schedule", "no-cancel"],
  });

  // MOVABLE DATES, NO WAY BACK. The half nobody expects: the organizer can still
  // shorten a period, but cannot call the whole thing off.
  await build({
    name: "Transport Sector Board - No Going Back",
    organizerName: "Transport Sector Board",
    description:
      "The organizer may bring a date forward if everyone is ready, and cannot cancel. The two promises are separate on purpose, and this is the combination that shows why.",
    votingType: VotingType.ABSOLUTE_MAJORITY,
    thresholdValue: 0n,
    candidates: [{ name: "Accept the offer" }, { name: "Go back and negotiate" }],
    enrollFrom: -2 * HOUR,
    enrollTo: 3 * DAY,
    voteFrom: 3 * DAY,
    voteTo: 6 * DAY,
    fixedSchedule: false,
    cancellable: false,
    tags: ["enrolling", "no-cancel"],
  });

  // THE GAP. Enrolment closed, voting not yet due: the phase every early
  // function refused until `openVotingEarly` existed.
  await build({
    name: "School Board - Between Windows",
    organizerName: "Ramon y Cajal School Board",
    description:
      "Enrolment has closed and voting is not due for another day. Nothing could reach this gap before: an election offering dates the organizer can shorten could not shorten this one, and they could only wait it out.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [
      { name: "Candidatura Familias" },
      { name: "Candidatura Docentes" },
      { name: "Candidatura Alumnado" },
    ],
    enrollFrom: -2 * HOUR,
    enrollTo: -HOUR,
    voteFrom: DAY,
    voteTo: 4 * DAY,
    tags: ["pending-vote", "gap"],
  });

  // THE GAP, FIXED. The same phase on an election that cannot be hurried, so
  // the two panels can be compared side by side.
  await build({
    name: "Farmers Chamber - Between Windows, Fixed Dates",
    organizerName: "Provincial Farmers Chamber",
    description:
      "Also waiting between the two windows, but with a schedule the organizer gave up moving. The panel offers nothing to press, and says why.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [{ name: "Lista A" }, { name: "Lista B" }],
    enrollFrom: -2 * HOUR,
    enrollTo: -HOUR,
    voteFrom: 2 * DAY,
    voteTo: 5 * DAY,
    fixedSchedule: true,
    tags: ["pending-vote", "fixed-schedule"],
  });

  // UPCOMING AND UNFUNDED, which the voter sees before they can act on it: the
  // two warnings meeting on one election.
  await build({
    name: "Cultural Society - Announced Without Funds",
    organizerName: "Teruel Cultural Society",
    description:
      "Announced for next week with nothing reserved yet. Nothing is wrong with the election, and the organizer has time to fund it before enrolment opens.",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    candidates: [{ name: "Film season" }, { name: "Theatre season" }],
    enrollFrom: 3 * DAY,
    enrollTo: 6 * DAY,
    voteFrom: 6 * DAY,
    voteTo: 9 * DAY,
    deposit: "0",
    tags: ["upcoming", "unfunded"],
  });

  console.log(`\nTotal elections on chain: ${await factory.electionsCount()}`);
  console.log(`Main organizer   (Hardhat #0): ${signers[0].address}`);
  console.log(`Other organizers (Hardhat #2/#3/#4): ${signers[2].address}, ${signers[3].address}, ${signers[4].address}`);
  console.log(`Eligibility attester: ${attesterWallet?.address ?? "none (no gated elections)"}`);
  console.log(`Tally keys written to: ${keyDir}`);
}

await main();
