/**
 * Read-only view of a single election.
 *
 * The eligibility flow has to know three things about an election before it
 * will attest anything: whether it declares an attribute policy at all, which
 * address it expects attestations from, and which policy its published hash
 * commits to. All three come from the chain, never from the caller, so a voter
 * cannot talk this server into signing for an election on terms of their own.
 *
 * Env:
 *   CHAIN_RPC_URL   RPC endpoint
 */
import { Contract, JsonRpcProvider, ZeroAddress, isAddress } from 'ethers';
import { parsePolicy, policyHash, type EligibilityPolicy } from '../eligibility/policy.js';

const ELECTION_ABI = [
  'function platformAttester() view returns (address)',
  'function eligibilityAttester() view returns (address)',
  'function eligibilityPolicyHash() view returns (bytes32)',
  'function metadataJson() view returns (string)',
  'function enrollStart() view returns (uint256)',
  'function enrollEnd() view returns (uint256)',
  'function createdAt() view returns (uint256)',
];

export function isChainConfigured(): boolean {
  return Boolean(process.env.CHAIN_RPC_URL);
}

function getProvider(): JsonRpcProvider {
  return new JsonRpcProvider(process.env.CHAIN_RPC_URL);
}

export interface ElectionEligibility {
  attester: string;
  policyHash: string;
  policy: EligibilityPolicy;
  enrollStart: number;
  enrollEnd: number;
}

/**
 * Reads an election's eligibility terms and checks that the policy published in
 * its metadata is the one its hash commits to.
 *
 * A mismatch is reported rather than repaired. It means the metadata was
 * written by something that disagrees with this server about the canonical
 * form, or that the two were never consistent, and either way signing an
 * attestation against rules nobody can verify would defeat the point of
 * publishing the hash.
 */
export async function readElectionEligibility(
  electionAddress: string,
): Promise<ElectionEligibility> {
  if (!isAddress(electionAddress)) throw new Error('election must be a valid address');
  if (!isChainConfigured()) throw new Error('CHAIN_RPC_URL not configured');

  const election = new Contract(electionAddress, ELECTION_ABI, getProvider());
  const [attester, onChainHash, metadataJson, enrollStart, enrollEnd] = await Promise.all([
    election.eligibilityAttester() as Promise<string>,
    election.eligibilityPolicyHash() as Promise<string>,
    election.metadataJson() as Promise<string>,
    election.enrollStart() as Promise<bigint>,
    election.enrollEnd() as Promise<bigint>,
  ]);

  let policy: EligibilityPolicy = {};
  if (metadataJson) {
    try {
      const metadata = JSON.parse(metadataJson) as { eligibility?: unknown };
      policy = parsePolicy(metadata.eligibility);
    } catch {
      throw new Error('election metadata does not carry a readable eligibility policy');
    }
  }

  if (policyHash(policy) !== onChainHash.toLowerCase()) {
    throw new Error('election policy does not match its published hash');
  }

  return {
    attester,
    policyHash: onChainHash.toLowerCase(),
    policy,
    enrollStart: Number(enrollStart),
    enrollEnd: Number(enrollEnd),
  };
}

export interface EnrolmentMode {
  /** The key this election trusts for private enrolment, or zero for none. */
  platformAttester: string;
  /** The organizer's own gatekeeper, or zero when the election is ungated. */
  eligibilityAttester: string;
  /**
   * Unix seconds, from the contract's `immutable createdAt`. Zero for an
   * election deployed before it existed, which also has no platform attester
   * and so never reaches the tag.
   */
  createdAt: number;
}

/**
 * Which door this election's enrolment goes through.
 *
 * Elections deployed before private enrolment existed answer zero for the
 * platform attester and keep the public paths, where the voter's one platform
 * commitment lands in the tree and the registry says publicly whose it is.
 * Anything deployed since refuses those paths outright, so the two can never
 * both be open on one election and give one human two leaves.
 *
 * `platformAttester` is read rather than assumed, because it is frozen into the
 * election at deployment: a server that had rotated its key would otherwise
 * sign attestations that election can never accept.
 */
export async function readEnrolmentMode(electionAddress: string): Promise<EnrolmentMode> {
  if (!isAddress(electionAddress)) throw new Error('election must be a valid address');
  if (!isChainConfigured()) throw new Error('CHAIN_RPC_URL not configured');

  const election = new Contract(electionAddress, ELECTION_ABI, getProvider());
  const [platformAttester, eligibilityAttester, createdAt] = await Promise.all([
    // An election deployed before this existed has no such function, and the
    // call reverts rather than returning zero.
    election.platformAttester().catch(() => ZeroAddress) as Promise<string>,
    election.eligibilityAttester() as Promise<string>,
    /**
     * WHEN IT WAS DEPLOYED, which is the one date about an election that
     * cannot move. `enrollEnd` would read better as the anchor for retiring a
     * tag key, since it says when the tag stops being needed, but an organizer
     * can call `closeEnrollmentEarly` and pull it backwards: the key would
     * change under a live enrolment and the same human would be handed a
     * second tag. `createdAt` is `immutable` in the contract, assigned from
     * `block.timestamp` in the constructor. See `humanTagFor`.
     */
    election.createdAt().catch(() => 0n) as Promise<bigint>,
  ]);

  return { platformAttester, eligibilityAttester, createdAt: Number(createdAt) };
}

/**
 * The time the CHAIN believes it is, which is the only clock that matters.
 *
 * `ElectionV4.enrollAttested` refuses an attestation when
 * `block.timestamp > deadline`, and this server was computing that deadline
 * from its own wall clock. On a network whose blocks arrive every couple of
 * seconds the two agree closely enough that nothing shows. On any chain that
 * drifts, they do not: a local node whose clock was advanced past finished
 * elections ran a week ahead, so every attestation was born expired and no
 * amount of retrying could produce a valid one.
 *
 * Never cached. A stale answer here is the whole failure being described.
 */
export async function getChainTime(): Promise<number> {
  const block = await getProvider().getBlock('latest');
  if (!block) throw new Error('could not read the latest block');
  return Number(block.timestamp);
}

/**
 * The timestamp the NEXT block will carry, which is the one that judges us.
 *
 * An attestation is never evaluated in the last block that was mined. It is
 * evaluated in the block that includes the enrolment, and `block.timestamp`
 * there is the pending block's, not the latest one's.
 *
 * On a live chain the two differ by one block time and nothing shows. On a node
 * carrying a time offset they do not: measured here with the latest block
 * frozen at 19:07:30 while the pending block already stood at 19:34:46, because
 * the seed script advances the clock with `evm_increaseTime` to create
 * historical elections and the offset keeps running afterwards. A fifteen
 * minute deadline measured from the latest block was therefore twelve minutes
 * in the past before it was signed. `eth_call` accepted the very same call
 * while `eth_estimateGas` rejected it, which is exactly this gap: one simulates
 * against the latest block and the other against the next.
 *
 * Falls back to the latest block, which is what most nodes outside development
 * answer for "pending" anyway.
 */
async function nextBlockTime(): Promise<number> {
  try {
    // THE RAW CALL, because `provider.getBlock('pending')` throws. A pending
    // block has `number: null` and ethers v6 rejects the whole payload as
    // BAD_DATA before any field can be read, so the tidy-looking version of
    // this swallowed its own exception and quietly returned the latest block:
    // the exact value it was written to stop using.
    const pending = (await getProvider().send('eth_getBlockByNumber', ['pending', false])) as
      | { timestamp?: string }
      | null;
    if (pending?.timestamp) return Number(BigInt(pending.timestamp));
  } catch {
    // A node that does not serve a pending block is not an error here: the
    // latest one is a fine approximation wherever blocks arrive steadily.
  }
  return getChainTime();
}

/**
 * The base an attestation deadline is measured from: whichever clock is
 * furthest ahead.
 *
 * Taking the chain alone would be wrong in the other direction, on an idle node
 * whose last block is hours old: the deadline would be short by exactly that
 * gap. The latest of the readings satisfies all of them.
 */
export async function attestationBaseTime(): Promise<number> {
  const [chain, next] = await Promise.all([getChainTime(), nextBlockTime()]);
  return Math.max(Math.floor(Date.now() / 1000), chain, next);
}

/** Chain id the attester must sign against, read once and cached. */
let cachedChainId: bigint | null = null;

export async function getChainId(): Promise<bigint> {
  if (cachedChainId === null) {
    cachedChainId = (await getProvider().getNetwork()).chainId;
  }
  return cachedChainId;
}
