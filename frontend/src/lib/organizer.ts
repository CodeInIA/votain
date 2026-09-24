/**
 * Organizer actions: create elections and drive their lifecycle.
 *
 * Uses the organizer's injected EOA signer (MetaMask). Election deployment
 * generates a fresh Paillier keypair: the public key is stored on-chain (voters
 * encrypt with it), the private key is kept in localStorage so the organizer can
 * run the tally later. In production the private key would be sealed to a
 * passkey: see docs/dev/architecture.md.
 */
import { type EventLog, type Log, type Signer } from "ethers";
import { getFactory, getElection, getPaymaster, getReadProvider } from "./contracts";
import { eventArgs, queryLogsFrom } from "./logs";
import { fetchOrganizerElectionAddresses } from "./chainElections";
import { COUNTER_BASE, generateElectionKeys, type SerializedKeyPair } from "./paillier";
import { deriveElectionKeys, newKeyNonce } from "./tallyKey";
import { signsDeterministically } from "./organizerKey";
import {
  effectivePersonhood,
  isCoherentPolicy,
  isEmptyPolicy,
  policyHash,
  ZERO_HASH,
  type EligibilityPolicy,
  type PersonhoodLevel,
} from "./eligibility";
import { hasDuplicateNames } from "./ballotNames";
import { splitFunding } from "./gasNeeds";

/** Mirrors `ElectionV4.PersonhoodLevel`. */
const PERSONHOOD_ENUM: Record<PersonhoodLevel, number> = { device: 0, document: 1, orb: 2 };

const PRIVKEY_STORAGE_PREFIX = "votain_paillier_sk_";
const ORGANIZER_NAME_KEY = "votain_organizer_name";

/** Default label until the organizer sets a display name in their profile. */
export const DEFAULT_ORGANIZER_NAME = "VotainOrg";

/** The organizer's display name, shown as "created by" on their elections. */
export function getOrganizerName(): string {
  return localStorage.getItem(ORGANIZER_NAME_KEY) || DEFAULT_ORGANIZER_NAME;
}

export function setOrganizerName(name: string): void {
  const trimmed = name.trim();
  if (trimmed) localStorage.setItem(ORGANIZER_NAME_KEY, trimmed);
  else localStorage.removeItem(ORGANIZER_NAME_KEY);
}

/** Whether this browser knows the organizer's name, as opposed to defaulting. */
export function hasStoredOrganizerName(): boolean {
  return localStorage.getItem(ORGANIZER_NAME_KEY) !== null;
}

/**
 * Recovers the display name from the organizer's own elections.
 *
 * The name is snapshotted into each election's metadata at creation, so the
 * chain already holds it and there is no second store to keep in sync. A new
 * browser can read it back instead of asking again, and instead of silently
 * labelling the next election with the default.
 *
 * Skips two non-answers: the placeholder, and elections whose metadata carried
 * no name at all (where `organizer` falls back to the raw address). Adopting
 * either would bury the real name under something the organizer never chose.
 *
 * @param elections The organizer's elections, newest first.
 */
export function recoverOrganizerName(
  elections: Array<{ organizer: string; organizerAddress: string }>,
): string | null {
  const named = elections.find(
    e =>
      e.organizer &&
      e.organizer !== DEFAULT_ORGANIZER_NAME &&
      e.organizer.toLowerCase() !== e.organizerAddress.toLowerCase(),
  );
  return named?.organizer ?? null;
}

export const VOTING_TYPE_ENUM: Record<string, number> = {
  simple_plurality: 0,
  absolute_majority: 1,
  two_thirds: 2,
  witness_threshold: 3,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface CreateElectionInput {
  name: string;
  description: string;
  votingType: keyof typeof VOTING_TYPE_ENUM;
  thresholdValue: number; // witness_threshold only
  organizerName: string;
  /** Verified domain to show on this election, chosen at creation. Optional. */
  organizerDomain?: string;
  candidates: { name: string; description?: string }[]; // blank vote excluded
  privacyQuorum: number;
  /**
   * The organizer gives up the power to move any deadline.
   *
   * A promise made once, at deployment, that the contract then keeps: closing
   * enrolment or voting early is a lever whose effect the organizer can watch in
   * real time, since the member and voter counts are public.
   */
  fixedSchedule: boolean;
  /** Whether the organizer keeps the power to call it off. */
  cancellable: boolean;
  /**
   * What the organizer already holds in the paymaster, in wei.
   *
   * The reserve is taken from here before anything is asked of the wallet. Zero
   * when unknown, which only costs a larger transaction, never a wrong one.
   */
  availableBalance?: bigint;
  enrollStart: Date;
  enrollEnd: Date;
  voteStart: Date;
  voteEnd: Date;
  depositMatic: string; // decimal string
  tags?: string[];
  /**
   * Attribute restrictions on who may enroll. Omitted or empty leaves the
   * election open, which is the default and the path every existing election
   * takes.
   */
  eligibility?: EligibilityPolicy;
  /**
   * Address that will sign enrollment attestations for this election. Required
   * when `eligibility` is set and ignored otherwise. Read from the backend at
   * creation time, then frozen into the contract: an election cannot be moved
   * to a different attester afterwards, which is what makes the restriction
   * something voters can rely on rather than something the organizer can
   * rewrite mid-election.
   */
  eligibilityAttester?: string;
}

const toUnix = (d: Date): number => Math.floor(d.getTime() / 1000);

/**
 * Persists a Paillier private key locally, keyed by election address.
 *
 * Only used as a fallback for devices with no PRF passkey: the preferred path
 * derives the key on demand from the passkey and stores nothing at rest.
 */
export function storeElectionPrivateKey(electionAddress: string, keys: SerializedKeyPair): void {
  localStorage.setItem(PRIVKEY_STORAGE_PREFIX + electionAddress.toLowerCase(), JSON.stringify(keys));
}

export function loadElectionPrivateKey(electionAddress: string): SerializedKeyPair | null {
  const raw = localStorage.getItem(PRIVKEY_STORAGE_PREFIX + electionAddress.toLowerCase());
  return raw ? (JSON.parse(raw) as SerializedKeyPair) : null;
}

export interface CreatedElection {
  address: string;
  txHash: string;
  paillierKeys: SerializedKeyPair;
  /** True when the key is re-derivable from the passkey (nothing stored at rest). */
  keyDerivable: boolean;
}

/**
 * Deploys a new election through the factory and funds the organizer's gas tank
 * with the attached deposit. Returns the new election address (parsed from the
 * ElectionCreated event).
 */
export async function createElection(
  signer: Signer,
  input: CreateElectionInput,
): Promise<CreatedElection> {
  const { ethers } = await import("ethers");

  // 1. Tally keypair. Preferred: derive deterministically from the organizer's
  //    wallet signature (`organizerKey.ts`), keyed by a public per-election
  //    nonce. Nothing is stored at rest and the key can be re-derived on any
  //    device the wallet reaches. Fallback (a wallet whose signatures are not
  //    deterministic): a random key that must be stored/exported, since a
  //    derived one could never be reproduced.
  // Refused here and not only in the wizard, because this is the last code the
  // app runs before a transaction exists and the wizard is one caller of it.
  // It is NOT a defence against a transaction built by hand, which never comes
  // through this file; that case is handled where the election is read.
  if (hasDuplicateNames(input.candidates.map(c => c.name))) {
    throw new Error("two candidates would appear on the ballot as the same option");
  }

  const keyNonce = newKeyNonce();
  const derived = (await signsDeterministically(signer))
    ? await deriveElectionKeys(keyNonce, signer)
    : null;
  const keyDerivable = derived !== null;
  const paillierKeys = derived ?? (await generateElectionKeys());

  // 2. Metadata bundle stored on-chain (kept small; IPFS on mainnet).
  //    keyNonce is public (a salt), included only when the key is derivable.
  //    The eligibility policy rides along here, and its hash goes into the
  //    contract, so anyone can recompute one from the other and see that the
  //    published rules are the ones enrollment was actually gated on.
  const gated = !isEmptyPolicy(input.eligibility);
  const metadata = {
    description: input.description,
    organizerName: input.organizerName,
    ...(input.organizerDomain ? { organizerDomain: input.organizerDomain } : {}),
    candidates: input.candidates,
    privacyQuorum: input.privacyQuorum,
    // Recorded, not assumed. The base is fixed into every ballot at encryption
    // time, so an election tallied against a different one decodes to nonsense.
    // Writing it here is what lets the constant be raised later without
    // stranding the elections already running under the old value.
    counterBase: COUNTER_BASE.toString(),
    ...(keyDerivable ? { keyNonce } : {}),
    // The personhood level travels inside `eligibility`, where the on-chain
    // policy hash covers it. The old top-level `requireOrb` flag sat outside
    // that hash, so it claimed a bar nothing could hold the election to; it is
    // still read for elections that predate the move, and written by nothing.
    ...(gated ? { eligibility: input.eligibility } : {}),
    tags: input.tags ?? [],
  };

  if (gated && !input.eligibilityAttester) {
    throw new Error("an election with an eligibility policy needs an attester address");
  }

  // Caught here rather than by the deployment. The wizard cannot produce this
  // pair, since choosing the account-only level clears the attribute rules,
  // but a caller that skips the wizard would otherwise reach `ElectionV4` and
  // get `InvalidConfig`, which names neither field.
  if (!isCoherentPolicy(input.eligibility)) {
    throw new Error(
      "an election that asks only for a World ID account cannot restrict age or nationality: " +
        "both are read from a document",
    );
  }

  // 3. Random scope (external nullifier): unique per election
  const scope = BigInt(ethers.hexlify(ethers.randomBytes(31)));

  const cfg = {
    name: input.name,
    votingType: VOTING_TYPE_ENUM[input.votingType],
    thresholdValue: BigInt(input.thresholdValue),
    numOptions: BigInt(input.candidates.length),
    enrollStart: toUnix(input.enrollStart),
    enrollEnd: toUnix(input.enrollEnd),
    voteStart: toUnix(input.voteStart),
    voteEnd: toUnix(input.voteEnd),
    scope,
    paillierPublicKey: JSON.stringify(paillierKeys.publicKey),
    metadataJson: JSON.stringify(metadata),
    eligibilityAttester: gated ? (input.eligibilityAttester as string) : ZERO_ADDRESS,
    eligibilityPolicyHash: gated ? await policyHash(input.eligibility as EligibilityPolicy) : ZERO_HASH,
    // Declared on chain as well as inside the hashed policy, because the
    // constructor enforces an invariant with it that the policy alone cannot:
    // a DEVICE election may carry no attester, and therefore no age or
    // nationality rule, since neither can be proved without a document.
    personhood: PERSONHOOD_ENUM[effectivePersonhood(input.eligibility)],
    // On chain as well as in the metadata, because the contract is what has to
    // refuse the publication. Kept in both places on purpose: the metadata copy
    // is what the interface reads to explain the rule before anyone votes.
    privacyQuorum: BigInt(input.privacyQuorum),
    // Immutable in the contract, so this is the only moment it can be decided.
    fixedSchedule: input.fixedSchedule,
    cancellable: input.cancellable,
  };

  const factory = getFactory(signer);
  /**
   * The reserve for this election, taken from the balance first.
   *
   * One signature for both sources, which is why the factory takes the second
   * argument: creating and then reserving would leave the election unfunded
   * whenever the second transaction was rejected, at the exact moment an
   * organizer is most likely to give up and walk away.
   */
  const { fromBalance, fromWallet } = splitFunding(
    ethers.parseEther(input.depositMatic || "0"),
    input.availableBalance ?? 0n,
  );
  const tx = await factory.createElection(cfg, fromBalance, { value: fromWallet });
  const receipt = await tx.wait();

  // Parse the ElectionCreated event to get the new address
  const parsed = receipt.logs
    .map((log: { topics: string[]; data: string }) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((e: { name: string } | null) => e?.name === "ElectionCreated");

  const address = parsed?.args?.electionAddress as string;
  if (!address) throw new Error("ElectionCreated event not found in receipt");

  // Only persist when the key cannot be re-derived: otherwise store nothing.
  if (!keyDerivable) storeElectionPrivateKey(address, paillierKeys);
  return { address, txHash: receipt.hash, paillierKeys, keyDerivable };
}

// ────────────────────────────────────────────────
// Lifecycle controls (organizer signer)
// ────────────────────────────────────────────────

/**
 * Waits for a lifecycle transaction and returns its hash.
 *
 * `wait()` resolves to null when ethers cannot find the transaction any more,
 * which is what a dropped or replaced one looks like. Dereferencing that gives
 * "Cannot read properties of null", which tells the organizer nothing. The
 * common cause on a local chain is a wallet whose cached nonce has fallen behind
 * the node, usually because transactions were sent from the same account outside
 * the wallet, so the message names the fix.
 *
 * A REVERT does not come through here: ethers throws for a receipt with status
 * 0, and the caller reports that error as it is.
 */
async function waitForLifecycleTx(tx: { wait: () => Promise<{ hash: string } | null> }): Promise<string> {
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error(
      "The transaction was dropped or replaced before it confirmed. If the wallet is on a local chain, clear its activity data to resync the account nonce, then try again.",
    );
  }
  return receipt.hash;
}

export async function cancelElection(signer: Signer, address: string): Promise<string> {
  const tx = await getElection(address, signer).cancelElection();
  return waitForLifecycleTx(tx);
}

/** Bring enrollment forward to now, from an election that has not opened yet. */
export async function openEnrollmentEarly(signer: Signer, address: string): Promise<string> {
  const tx = await getElection(address, signer).openEnrollmentEarly();
  return waitForLifecycleTx(tx);
}

/**
 * Start voting now, from the gap between the two windows.
 *
 * The one boundary nothing could move: every other early call refuses
 * PENDING_VOTE, so an election offering shortenable dates could not shorten that
 * one and the organizer could only wait.
 */
export async function openVotingEarly(signer: Signer, address: string): Promise<string> {
  const tx = await getElection(address, signer).openVotingEarly();
  return waitForLifecycleTx(tx);
}

export async function closeEnrollmentEarly(signer: Signer, address: string): Promise<string> {
  const tx = await getElection(address, signer).closeEnrollmentEarly();
  return waitForLifecycleTx(tx);
}

export async function closeVotingEarly(signer: Signer, address: string): Promise<string> {
  const tx = await getElection(address, signer).closeVotingEarly();
  return waitForLifecycleTx(tx);
}

export async function markVoided(signer: Signer, address: string): Promise<string> {
  const tx = await getElection(address, signer).markVoided();
  return waitForLifecycleTx(tx);
}

/**
 * Publishes the decrypted tally with its proof. The contract derives the
 * outcome from these counts, so it must carry one entry per option plus the
 * blank vote, in order, and together with `invalidBallots` they must account
 * for every voter. `ipfsCid` is the audit-trail CID: empty when the tally was
 * run in-app, which does not pin (the CLI path does).
 */
export async function publishResults(
  signer: Signer,
  address: string,
  tally: { counts: number[]; invalidBallots: number; proof: string },
  ipfsCid = "",
): Promise<string> {
  const tx = await getElection(address, signer).publishResults(
    ipfsCid,
    tally.counts.map(BigInt),
    BigInt(tally.invalidBallots),
    tally.proof,
  );
  return waitForLifecycleTx(tx);
}

// ────────────────────────────────────────────────
// Gas tank
// ────────────────────────────────────────────────

/** Into the signer's own tank: nobody may fill another organizer's. */
export async function depositGas(signer: Signer, matic: string): Promise<string> {
  const { ethers } = await import("ethers");
  const tx = await getPaymaster(signer).deposit({ value: ethers.parseEther(matic) });
  return waitForLifecycleTx(tx);
}

export async function withdrawGas(signer: Signer, matic: string): Promise<string> {
  const { ethers } = await import("ethers");
  const tx = await getPaymaster(signer).withdraw(ethers.parseEther(matic));
  return waitForLifecycleTx(tx);
}

export async function getGasBalance(organizer: string): Promise<bigint> {
  return getPaymaster().gasBalance(organizer);
}

/**
 * Commit gas to one election, from the balance first and the wallet for the rest.
 *
 * THE BALANCE COMES FIRST because it is already inside the contract: sending
 * new value while a balance sits there would leave the organizer topping up
 * twice and withdrawing the difference. The wallet is only asked for what the
 * balance cannot cover, which is what makes the gas screen the single door
 * money crosses.
 *
 * Two transactions only when both sources are needed, and in that order: the
 * internal move first, so a rejected wallet prompt leaves an election funded
 * with what was already available rather than with nothing.
 */
export async function fundElection(
  signer: Signer,
  election: string,
  matic: string,
  availableBalance: bigint,
): Promise<string> {
  const { ethers } = await import("ethers");
  const { fromBalance, fromWallet } = splitFunding(ethers.parseEther(matic), availableBalance);

  const paymaster = getPaymaster(signer);
  let last = "";
  if (fromBalance > 0n) {
    last = await waitForLifecycleTx(await paymaster.reserveFromBalance(election, fromBalance));
  }
  if (fromWallet > 0n) {
    last = await waitForLifecycleTx(
      await paymaster.depositForElection(election, { value: fromWallet }),
    );
  }
  return last;
}

/** Return an ended election's unspent reserve to the organizer's free balance. */
export async function releaseElectionReserve(signer: Signer, election: string): Promise<string> {
  const tx = await getPaymaster(signer).releaseReserve(election);
  return waitForLifecycleTx(tx);
}

/**
 * What is behind one election's sponsored gas.
 *
 * Two numbers and not a sum, because they are different promises. `reserved`
 * cannot be taken away while the election can still take a vote. `free` will be
 * spent if the reserve runs out, and can also be withdrawn at any moment, so a
 * screen that added them together would be telling a voter the second kind is
 * as good as the first.
 */
export interface ElectionFunding {
  reserved: bigint;
  free: bigint;
}

export async function getElectionFunding(election: string): Promise<ElectionFunding> {
  const [reserved, free] = (await getPaymaster().electionFunding(election)) as [bigint, bigint];
  return { reserved, free };
}

export interface GasMovement {
  /**
   * What moved.
   *
   * `reserved` is money arriving for ONE election, which is where a creation
   * deposit now lands: without it the history would say nothing at all about
   * the POL that left the organizer's wallet to start an election. `released`
   * is the unspent part of that coming back to the free balance when the
   * election ends, which is a transfer between two pots of the same tank rather
   * than money arriving or leaving, and the screen shows it without a sign for
   * exactly that reason.
   */
  type: "deposit" | "withdraw" | "spent" | "reserved" | "released";
  /** Signed amount in the chain's native token (negative when it leaves the tank). */
  amount: number;
  /**
   * When it happened, or undefined when the block could not be read.
   *
   * Optional on purpose. This used to fall back to `new Date()`, which put an
   * unreadable movement at TODAY on a list sorted by date: a failed network read
   * became a payment that looked like it had just been made, at the top of a
   * financial history. An unknown date now says so.
   */
  date?: Date;
  txHash: string;
  /** True chain order, which is what the list is sorted by. */
  blockNumber: number;
}

/**
 * Reads the organizer's real gas-tank movements from paymaster events
 * (Deposited / Withdrawn / VoteSponsored), newest first.
 */
export async function fetchGasHistory(organizer: string): Promise<GasMovement[]> {
  const { formatEther } = await import("ethers");
  const paymaster = getPaymaster();

  /**
   * `ElectionFunded` is indexed by ELECTION, not by organizer, so it cannot be
   * filtered down to one of them at the node. Every election's funding comes
   * back and the organizer's own are picked out here, against the addresses the
   * factory recorded for them.
   */
  const [deposits, withdrawals, sponsored, funded, released, mine] = await Promise.all([
    queryLogsFrom(paymaster, paymaster.filters.Deposited(organizer)),
    queryLogsFrom(paymaster, paymaster.filters.Withdrawn(organizer)),
    queryLogsFrom(paymaster, paymaster.filters.VoteSponsored(organizer)),
    queryLogsFrom(paymaster, paymaster.filters.ElectionFunded()),
    queryLogsFrom(paymaster, paymaster.filters.ReserveReleased(null, organizer)),
    fetchOrganizerElectionAddresses(organizer),
  ]);

  const ours = new Set(mine.map(a => a.toLowerCase()));
  const funding = funded.filter(
    log => ours.has(String(eventArgs<{ election?: string }>(log).election ?? '').toLowerCase()),
  );

  const logs = [...deposits, ...withdrawals, ...sponsored, ...funding, ...released];

  /**
   * ONE BLOCK READ PER BLOCK, not per movement.
   *
   * This is the heaviest list in the app and it was the least careful about it:
   * `VoteSponsored` fires once per sponsored vote, so an election with two
   * thousand voters left two thousand events, and asking each one for its block
   * meant two thousand round trips just to open the gas page. Votes are mined in
   * batches, so the distinct blocks are a small fraction of that.
   */
  const times = new Map<number, Date | undefined>();
  await Promise.all(
    [...new Set(logs.map(l => l.blockNumber))].map(async blockNumber => {
      try {
        const block = await getReadProvider().getBlock(blockNumber);
        times.set(blockNumber, block ? new Date(Number(block.timestamp) * 1000) : undefined);
      } catch {
        times.set(blockNumber, undefined);
      }
    }),
  );

  const read = (
    source: readonly (Log | EventLog)[],
    type: GasMovement["type"],
    sign: 1 | -1,
    field: "amount" | "cost",
  ) =>
    source.map(e => ({
      type,
      amount: sign * Number(formatEther(eventArgs<Record<string, bigint>>(e)[field] ?? 0n)),
      date: times.get(e.blockNumber),
      txHash: e.transactionHash,
      blockNumber: e.blockNumber,
    }));

  const movements = [
    ...read(deposits, "deposit", 1, "amount"),
    ...read(withdrawals, "withdraw", -1, "amount"),
    ...read(sponsored, "spent", -1, "cost"),
    ...read(funding, "reserved", 1, "amount"),
    ...read(released, "released", 1, "amount"),
  ];

  // Sorted by the chain's own order rather than by the timestamp, which is the
  // order things actually happened in: two movements in one block share a
  // timestamp, and a movement whose block could not be read has none at all.
  return movements.sort((a, b) => b.blockNumber - a.blockNumber);
}
