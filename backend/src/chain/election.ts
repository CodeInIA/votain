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
import { Contract, JsonRpcProvider, isAddress } from 'ethers';
import { parsePolicy, policyHash, type EligibilityPolicy } from '../eligibility/policy.js';

const ELECTION_ABI = [
  'function eligibilityAttester() view returns (address)',
  'function eligibilityPolicyHash() view returns (bytes32)',
  'function metadataJson() view returns (string)',
  'function enrollStart() view returns (uint256)',
  'function enrollEnd() view returns (uint256)',
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
 * The base an attestation deadline is measured from: whichever clock is
 * further ahead.
 *
 * Taking the chain alone would be wrong in the other direction, on an idle node
 * whose last block is hours old: the deadline would be short by exactly that
 * gap. The later of the two satisfies both readings.
 */
export async function attestationBaseTime(): Promise<number> {
  return Math.max(Math.floor(Date.now() / 1000), await getChainTime());
}

/** Chain id the attester must sign against, read once and cached. */
let cachedChainId: bigint | null = null;

export async function getChainId(): Promise<bigint> {
  if (cachedChainId === null) {
    cachedChainId = (await getProvider().getNetwork()).chainId;
  }
  return cachedChainId;
}
