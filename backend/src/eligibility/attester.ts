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
 * The epoch an election belongs to: the UTC month it was created in.
 *
 * A key is retired by epoch, so the epoch has to be a property of the election
 * that NOTHING can move. `enrollEnd` would read better, since it says when the
 * tag stops being needed, but `closeEnrollmentEarly` pulls it backwards and the
 * key would change under a live enrolment: the same human would be handed a
 * second tag and the contract would accept a second leaf. `createdAt` is
 * `immutable` in `ElectionV4`, assigned from `block.timestamp` once.
 */
export function epochOf(createdAtSeconds: number): string {
  const d = new Date(createdAtSeconds * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The keys that turn a human into a per-election tag, one per epoch.
 *
 * WHY IT IS SECRET. The tag has to be the same number every time this person
 * enrols in this election, so the contract can refuse them twice, and a
 * different number in every other election, or the chain is back to publishing
 * who joined what. A plain hash of the World ID nullifier and the address
 * fails the second half: those nullifiers are on chain, so anyone could
 * recompute every tag and recognise the same person everywhere.
 *
 * WHY IT IS NOT THE SIGNING KEY, which it used to be derived from. One secret
 * to deploy was the argument, and it welded together two risks that are nothing
 * alike. A leaked SIGNING key is bad and bounded: forged enrolments from that
 * moment, noticed, and you rotate. A leaked TAG key is retroactive and silent:
 * the World ID nullifiers are public and the tags are on chain, so it
 * reconstructs who joined what across every election ever held, and rotating
 * repairs nothing. Welded, you could not rotate one without the other — and
 * rotating to recover from a signing compromise would have changed every tag,
 * handing a second leaf to anybody mid-enrolment. Recovering from one incident
 * would have caused another.
 *
 * WHY THERE IS MORE THAN ONE, AND WHY THEY CAN BE DELETED. Forward secrecy
 * cannot be derived; it has to be thrown away. An election created in epoch E
 * can only enrol while its own window is open, and after that nothing ever
 * recomputes its tags: the contract has already stored the ones it accepted.
 * So once every election created in E has closed enrolment, deleting E's key
 * puts those enrolments beyond reach of everyone, the platform included. That
 * is the difference between a secret nobody may leak and a secret that no
 * longer exists.
 *
 * FAILING CLOSED ON A MISSING EPOCH is the whole safety of the scheme. Falling
 * back to another key would quietly issue a different tag for an election that
 * already has one on chain, which is the double-leaf bug this is built to
 * avoid. A retired epoch must refuse, loudly, not improvise.
 */
function tagKeys(): Record<string, string> {
  const raw = process.env.ENROLMENT_TAG_KEYS;
  if (!raw) throw new Error('ENROLMENT_TAG_KEYS not configured');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ENROLMENT_TAG_KEYS must be JSON: {"YYYY-MM":"<hex>"}');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ENROLMENT_TAG_KEYS must be JSON: {"YYYY-MM":"<hex>"}');
  }
  return parsed as Record<string, string>;
}

function tagKey(epoch: string): Buffer {
  const key = tagKeys()[epoch];
  if (!key) {
    throw new Error(
      `No enrolment tag key for epoch ${epoch}. A key is retired once every ` +
        'election created in its epoch has closed enrolment; an election still ' +
        'enrolling needs its own key present. Never substitute another.',
    );
  }
  return createHmac('sha256', 'votain/enrolment-tag/v2').update(key).digest();
}

/**
 * The value that answers "has this person already enrolled HERE".
 *
 * Deterministic, so a voter who retries lands on the same tag and is refused
 * the second leaf. Unrecognisable outside this election, so the roll of one
 * election says nothing about the roll of another.
 */
export function humanTagFor(
  worldIdNullifier: string,
  electionAddress: string,
  createdAtSeconds: number,
): string {
  const scoped = solidityPackedKeccak256(
    ['bytes32', 'uint256', 'address'],
    [
      '0x' + tagKey(epochOf(createdAtSeconds)).toString('hex'),
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
