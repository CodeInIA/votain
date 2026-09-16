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
import { Wallet, getAddress, solidityPackedKeccak256 } from 'ethers';
import { createHmac } from 'node:crypto';

/** Lifetime of an attestation. Long enough to submit, short enough that a
 * leaked one is worthless by the time anyone finds it. */
export const ATTESTATION_TTL_SECONDS = 15 * 60;

const EIP712_TYPES = {
  EnrollAttestation: [
    { name: 'identityCommitment', type: 'uint256' },
    { name: 'personhoodNullifier', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

const PRIVATE_EIP712_TYPES = {
  PrivateEnrollment: [
    { name: 'identityCommitment', type: 'uint256' },
    { name: 'humanTag', type: 'uint256' },
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

/**
 * The key that turns a human into a per-election tag, and nothing else.
 *
 * WHY IT IS SECRET. The tag has to be the same number every time this person
 * enrols in this election, so the contract can refuse them twice, and a
 * different number in every other election, or the chain is back to publishing
 * who joined what. A plain hash of the World ID nullifier and the address
 * fails the second half: those nullifiers are on chain, so anyone could
 * recompute every tag and recognise the same person everywhere.
 *
 * Derived from the attester key rather than configured separately, so there is
 * one platform secret to deploy and no way to have one of them and not the
 * other. Different info string, so the two uses never produce related values.
 */
function tagKey(): Buffer {
  const key = process.env.ELIGIBILITY_ATTESTER_PRIVATE_KEY;
  if (!key) throw new Error('ELIGIBILITY_ATTESTER_PRIVATE_KEY not configured');
  return createHmac('sha256', 'votain/enrolment-tag/v1').update(key).digest();
}

/**
 * The value that answers "has this person already enrolled HERE".
 *
 * Deterministic, so a voter who retries lands on the same tag and is refused
 * the second leaf. Unrecognisable outside this election, so the roll of one
 * election says nothing about the roll of another.
 */
export function humanTagFor(worldIdNullifier: string, electionAddress: string): string {
  const scoped = solidityPackedKeccak256(
    ['bytes32', 'uint256', 'address'],
    [
      '0x' + tagKey().toString('hex'),
      BigInt(worldIdNullifier),
      getAddress(electionAddress),
    ],
  );
  return BigInt(scoped).toString();
}

export interface PrivateEnrollment {
  /** Decimal string, as the contract and the relay both expect it. */
  humanTag: string;
  deadline: number;
  signature: string;
}

/**
 * Signs one private enrolment.
 *
 * Says two things and no more: the commitment belongs to a human this platform
 * has verified, and that human has not already enrolled in this election. It
 * does not say which human, because the tag is the only thing carrying that and
 * it means nothing outside this address.
 */
export async function signPrivateEnrollment(
  electionAddress: string,
  chainId: bigint,
  identityCommitment: string,
  humanTag: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<PrivateEnrollment> {
  const wallet = getAttesterWallet();
  const deadline = nowSeconds + ATTESTATION_TTL_SECONDS;

  // The contract refuses a zero tag, for the same reason it refuses a zero
  // personhood nullifier: one attestation would otherwise stand for everybody.
  if (!humanTag || BigInt(humanTag) === 0n) {
    throw new Error('refusing to sign a private enrolment with no human tag');
  }

  const signature = await wallet.signTypedData(
    {
      name: 'VotainElection',
      version: '1',
      chainId,
      verifyingContract: electionAddress,
    },
    PRIVATE_EIP712_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>,
    {
      identityCommitment: BigInt(identityCommitment),
      humanTag: BigInt(humanTag),
      deadline,
    },
  );

  return { humanTag, deadline, signature };
}

export interface EnrollAttestation {
  /** Decimal string, as the contract and the relay both expect it. */
  personhoodNullifier: string;
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
  personhoodNullifier: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<EnrollAttestation> {
  const wallet = getAttesterWallet();
  const deadline = nowSeconds + ATTESTATION_TTL_SECONDS;

  // Zero is what the contract reads as "no personhood proof", and it refuses it.
  // Catching it here means the failure names the cause instead of surfacing as
  // a revert the voter cannot interpret.
  if (!personhoodNullifier || BigInt(personhoodNullifier) === 0n) {
    throw new Error('refusing to sign an attestation with no personhood nullifier');
  }

  const signature = await wallet.signTypedData(
    {
      name: 'VotainElection',
      version: '1',
      chainId,
      verifyingContract: electionAddress,
    },
    EIP712_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>,
    {
      identityCommitment: BigInt(identityCommitment),
      personhoodNullifier: BigInt(personhoodNullifier),
      deadline,
    },
  );

  return { personhoodNullifier, deadline, signature };
}
