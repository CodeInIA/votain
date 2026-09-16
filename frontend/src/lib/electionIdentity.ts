import { Identity } from "@semaphore-protocol/identity";

/**
 * A different identity in every election, derived from the same secret.
 *
 * WHY. A voter used to enrol the one commitment the platform registry holds for
 * them, in every election they joined. `PlatformRegistry.nullifierOf` is a
 * public view, so that commitment names its human to anyone who asks, and the
 * same number appearing in three trees said plainly that one person had joined
 * those three elections. The ballots were anonymous; the participation was a
 * public record.
 *
 * WHAT REPLACES IT. The commitment that lands in an election's tree is derived
 * here, from the voter's own secret and that election's address. It is theirs,
 * nobody else can produce it, it is reproducible from the recovery phrase on
 * any device, and it looks like an unrelated stranger in every other election.
 *
 * HKDF over the identity's private key, not over the phrase: the phrase is
 * often not in memory at all (a passkey unsealed the secret instead), and this
 * has to work from whatever the voter unlocked. Domain-separated by an info
 * string that names both the purpose and the election, so a commitment for one
 * election cannot be reached from another, and neither can the platform
 * identity be reached from any of them.
 */

/** Info prefix. Changing it changes every derived identity, so it is versioned. */
const INFO_PREFIX = "votain/election-identity/v1:";

/**
 * Derived commitments, by election address.
 *
 * PUBLIC VALUES ONLY, exactly like the platform commitment kept next to it:
 * a commitment is already in an on-chain merkle tree. Stored so read-only
 * screens can answer "am I enrolled here" after a reload without unlocking the
 * secret, which would summon a passkey prompt to draw a badge.
 */
const COMMITMENTS_KEY = "votain_election_commitments";

/** In-memory, so a page that enrols and then votes derives once. */
const derived = new Map<string, Identity>();

const keyFor = (electionAddress: string): string => electionAddress.toLowerCase();

function readCommitments(): Record<string, string> {
  try {
    const raw = localStorage.getItem(COMMITMENTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    // Unreadable storage is not a reason to refuse to vote: the identity is
    // derived from the secret, and this is only a cache in front of it.
    return {};
  }
}

function rememberCommitment(electionAddress: string, commitment: bigint): void {
  try {
    const all = readCommitments();
    all[keyFor(electionAddress)] = commitment.toString();
    localStorage.setItem(COMMITMENTS_KEY, JSON.stringify(all));
  } catch {
    // Private mode, or a full quota. The next read derives it again.
  }
}

/** The commitment this device derived for an election, if it has one. */
export function storedElectionCommitment(electionAddress: string): bigint | null {
  const value = readCommitments()[keyFor(electionAddress)];
  return value ? BigInt(value) : null;
}

/**
 * The identity this voter uses in ONE election.
 *
 * Deterministic: the same secret and the same address always produce the same
 * commitment, which is what lets a voter who reinstalls their browser find
 * themselves already enrolled rather than locked out.
 */
export async function identityForElection(
  master: Identity,
  electionAddress: string,
): Promise<Identity> {
  const cached = derived.get(keyFor(electionAddress));
  if (cached) return cached;

  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(master.privateKey)) as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(INFO_PREFIX + keyFor(electionAddress)) as BufferSource,
    },
    ikm,
    256,
  );

  // Hex, for the same reason `identityFromPhrase` uses it: the seed has to be a
  // stable string rather than however a library version stringifies bytes.
  const seed = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("");
  const identity = new Identity(seed);

  derived.set(keyFor(electionAddress), identity);
  rememberCommitment(electionAddress, identity.commitment);
  return identity;
}

/** Forgets every derived identity. Called when the voter signs out. */
export function forgetElectionIdentities(): void {
  derived.clear();
  try {
    localStorage.removeItem(COMMITMENTS_KEY);
  } catch {
    // Nothing to do: the identities are derived, not stored.
  }
}
