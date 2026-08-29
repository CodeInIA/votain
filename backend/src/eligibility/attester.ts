/**
 * Eligibility attester.
 *
 * The last step of the flow, and the only one that produces something the chain
 * will act on. Once a voter's attribute proof has been verified off chain, this
 * signs an EIP-712 attestation saying that one identity commitment may enroll
 * in one election before one deadline. `ElectionV4.enrollAttested` recovers the
 * signer and compares it to the `eligibilityAttester` the election was deployed
 * with.
 *
 * WHY A SIGNATURE. A contract cannot verify a passport attribute proof: it is
 * anchored on another network, and going to look for it would break consensus
 * for the same reason a contract cannot resolve a DNS record. A signature is
 * the one attestation a contract can check on its own, so the trust is placed
 * where it is visible: the attester address is public, immutable, and chosen by
 * the organizer at creation time.
 *
 * WHAT THIS KEY CAN AND CANNOT DO. It can refuse to let an eligible voter in,
 * and it can let an ineligible one in. It cannot vote, cannot read a ballot,
 * cannot enroll anyone twice (the contract still deduplicates by human), and
 * cannot touch an election that did not name it. Losing it does not compromise
 * any tally.
 *
 * Env:
 *   ELIGIBILITY_ATTESTER_PRIVATE_KEY   key whose address elections name as attester
 */
import { Wallet } from 'ethers';

/** Lifetime of an attestation. Long enough to submit, short enough that a
 * leaked one is worthless by the time anyone finds it. */
export const ATTESTATION_TTL_SECONDS = 15 * 60;

const EIP712_TYPES = {
  EnrollAttestation: [
    { name: 'identityCommitment', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export function isAttesterConfigured(): boolean {
  return Boolean(process.env.ELIGIBILITY_ATTESTER_PRIVATE_KEY);
}

function getAttesterWallet(): Wallet {
  const key = process.env.ELIGIBILITY_ATTESTER_PRIVATE_KEY;
  if (!key) throw new Error('ELIGIBILITY_ATTESTER_PRIVATE_KEY not configured');
  return new Wallet(key);
}

/** The address organizers must name when creating a gated election. */
export function attesterAddress(): string {
  return getAttesterWallet().address;
}

export interface EnrollAttestation {
  deadline: number;
  signature: string;
}

/**
 * Signs one enrollment. The domain binds it to this election on this chain, so
 * the same signature presented to a different election is rejected there.
 */
export async function signEnrollAttestation(
  electionAddress: string,
  chainId: bigint,
  identityCommitment: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<EnrollAttestation> {
  const wallet = getAttesterWallet();
  const deadline = nowSeconds + ATTESTATION_TTL_SECONDS;

  const signature = await wallet.signTypedData(
    {
      name: 'VotainElection',
      version: '1',
      chainId,
      verifyingContract: electionAddress,
    },
    EIP712_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>,
    { identityCommitment: BigInt(identityCommitment), deadline },
  );

  return { deadline, signature };
}
