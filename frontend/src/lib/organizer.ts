/**
 * Organizer actions: create elections and drive their lifecycle.
 *
 * Uses the organizer's injected EOA signer (MetaMask). Election deployment
 * generates a fresh Paillier keypair: the public key is stored on-chain (voters
 * encrypt with it), the private key is kept in localStorage so the organizer can
 * run the tally later. In production the private key would be sealed to a
 * passkey: see docs/dev/architecture.md.
 */
import { type Signer } from "ethers";
import { getFactory, getElection, getPaymaster } from "./contracts";
import { queryLogsFrom } from "./logs";
import { generateElectionKeys, type SerializedKeyPair } from "./paillier";
import { deriveElectionKeys, newKeyNonce } from "./tallyKey";

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
  enrollStart: Date;
  enrollEnd: Date;
  voteStart: Date;
  voteEnd: Date;
  depositMatic: string; // decimal string
  tags?: string[];
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
  //    passkey PRF, keyed by a public per-election nonce. Nothing is stored at
  //    rest and the key can be re-derived on any device the passkey syncs to.
  //    Fallback (no PRF passkey): a random key that must be stored/exported,
  //    since it could never be reproduced.
  const keyNonce = newKeyNonce();
  const derived = await deriveElectionKeys(keyNonce);
  const keyDerivable = derived !== null;
  const paillierKeys = derived ?? (await generateElectionKeys());

  // 2. Metadata bundle stored on-chain (kept small; IPFS on mainnet).
  //    keyNonce is public (a salt), included only when the key is derivable.
  const metadata = {
    description: input.description,
    organizerName: input.organizerName,
    ...(input.organizerDomain ? { organizerDomain: input.organizerDomain } : {}),
    candidates: input.candidates,
    privacyQuorum: input.privacyQuorum,
    ...(keyDerivable ? { keyNonce } : {}),
    tags: input.tags ?? [],
  };

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
  };

  const factory = getFactory(signer);
  const value = ethers.parseEther(input.depositMatic || "0");
  const tx = await factory.createElection(cfg, { value });
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

export async function cancelElection(signer: Signer, address: string): Promise<string> {
  const tx = await getElection(address, signer).cancelElection();
  return (await tx.wait()).hash;
}

export async function closeEnrollmentEarly(signer: Signer, address: string): Promise<string> {
  const tx = await getElection(address, signer).closeEnrollmentEarly();
  return (await tx.wait()).hash;
}

export async function closeVotingEarly(signer: Signer, address: string): Promise<string> {
  const tx = await getElection(address, signer).closeVotingEarly();
  return (await tx.wait()).hash;
}

export async function markVoided(signer: Signer, address: string): Promise<string> {
  const tx = await getElection(address, signer).markVoided();
  return (await tx.wait()).hash;
}

/**
 * Publishes the decrypted tally. The contract derives the outcome from these
 * counts, so it must carry one entry per option plus the blank vote, in order.
 * `ipfsCid` is the audit-trail CID: empty when the tally was run in-app, which
 * does not pin (the CLI path does).
 */
export async function publishResults(
  signer: Signer,
  address: string,
  counts: number[],
  ipfsCid = "",
): Promise<string> {
  const tx = await getElection(address, signer).publishResults(ipfsCid, counts.map(BigInt));
  return (await tx.wait()).hash;
}

// ────────────────────────────────────────────────
// Gas tank
// ────────────────────────────────────────────────

export async function depositGas(signer: Signer, organizer: string, matic: string): Promise<string> {
  const { ethers } = await import("ethers");
  const tx = await getPaymaster(signer).depositFor(organizer, { value: ethers.parseEther(matic) });
  return (await tx.wait()).hash;
}

export async function withdrawGas(signer: Signer, matic: string): Promise<string> {
  const { ethers } = await import("ethers");
  const tx = await getPaymaster(signer).withdraw(ethers.parseEther(matic));
  return (await tx.wait()).hash;
}

export async function getGasBalance(organizer: string): Promise<bigint> {
  return getPaymaster().gasBalance(organizer);
}

export interface GasMovement {
  type: "deposit" | "withdraw" | "spent";
  /** Signed amount in the chain's native token (negative when it leaves the tank). */
  amount: number;
  date: Date;
  txHash: string;
}

/**
 * Reads the organizer's real gas-tank movements from paymaster events
 * (Deposited / Withdrawn / VoteSponsored), newest first.
 */
export async function fetchGasHistory(organizer: string): Promise<GasMovement[]> {
  const { formatEther } = await import("ethers");
  const paymaster = getPaymaster();

  const [deposits, withdrawals, sponsored] = await Promise.all([
    queryLogsFrom(paymaster, paymaster.filters.Deposited(organizer)),
    queryLogsFrom(paymaster, paymaster.filters.Withdrawn(organizer)),
    queryLogsFrom(paymaster, paymaster.filters.VoteSponsored(organizer)),
  ]);

  const toMovement = (
    type: GasMovement["type"],
    sign: 1 | -1,
    field: "amount" | "cost",
  ) => async (e: { args?: Record<string, bigint>; transactionHash: string; getBlock: () => Promise<{ timestamp: number } | null> }) => {
    let date = new Date();
    try {
      const block = await e.getBlock();
      if (block) date = new Date(Number(block.timestamp) * 1000);
    } catch { /* keep fallback */ }
    return {
      type,
      amount: sign * Number(formatEther(e.args?.[field] ?? 0n)),
      date,
      txHash: e.transactionHash,
    };
  };

  const movements = await Promise.all([
    ...deposits.map(e => toMovement("deposit", 1, "amount")(e as never)),
    ...withdrawals.map(e => toMovement("withdraw", -1, "amount")(e as never)),
    ...sponsored.map(e => toMovement("spent", -1, "cost")(e as never)),
  ]);

  return movements.sort((a, b) => b.date.getTime() - a.date.getTime());
}
