import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, verifyTypedData } from 'ethers';

import { humanTagFor, signPrivateEnrollment, ATTESTATION_TTL_SECONDS } from './attester.js';

/**
 * The tag that lets an election refuse the same person twice without anyone
 * else being able to recognise them.
 *
 * THE PROBLEM. The chain used to carry the voter's one platform commitment in
 * every election they joined, and the registry says publicly whose it is, so
 * the list of elections a named person took part in was there for the reading.
 * The fix is a commitment per election and a tag per election, and the tag is
 * the delicate half: it has to be STABLE here, so a second enrolment is
 * refused, and UNRECOGNISABLE elsewhere, so nothing links the two.
 *
 * Which is why it is keyed. A plain hash of the World ID nullifier and the
 * address would satisfy the first half and fail the second: those nullifiers
 * are on chain, so anybody could recompute every tag for every election and
 * match them up. The key makes that recomputation impossible without this
 * server's secret.
 */

// Local test key, never used anywhere else.
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const OTHER_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba';
const ELECTION = '0x979DC264DAE62e8957090F0b6D45B9b0652D1Dee';
const OTHER_ELECTION = '0x2e234DAe75C793f67A35089C9d99245E1C58470b';
const CHAIN_ID = 31337n;
const COMMITMENT = '12345678901234567890';
const WORLD_ID = '98765432109876543210';
/** Unix seconds inside 2026-09, which is the epoch the keys below cover. */
const CREATED = Math.floor(Date.UTC(2026, 8, 20) / 1000);
const CREATED_OTRO_MES = Math.floor(Date.UTC(2026, 9, 2) / 1000);

beforeEach(() => {
  process.env.ELIGIBILITY_ATTESTER_PRIVATE_KEY = KEY;
  process.env.ENROLMENT_TAG_KEYS = JSON.stringify({ '2026-09': 'a'.repeat(64) });
});

afterEach(() => {
  delete process.env.ELIGIBILITY_ATTESTER_PRIVATE_KEY;
  delete process.env.ENROLMENT_TAG_KEYS;
});

describe('the human tag', () => {
  test('is the same every time for one person in one election', () => {
    assert.equal(humanTagFor(WORLD_ID, ELECTION, CREATED), humanTagFor(WORLD_ID, ELECTION, CREATED));
  });

  test('is different for the same person in another election', () => {
    assert.notEqual(humanTagFor(WORLD_ID, ELECTION, CREATED), humanTagFor(WORLD_ID, OTHER_ELECTION, CREATED));
  });

  test('is different for another person in the same election', () => {
    assert.notEqual(humanTagFor(WORLD_ID, ELECTION, CREATED), humanTagFor('11111', ELECTION, CREATED));
  });

  test('does not care how the address was capitalised', () => {
    assert.equal(humanTagFor(WORLD_ID, ELECTION, CREATED), humanTagFor(WORLD_ID, ELECTION.toLowerCase(), CREATED));
  });

  test('cannot be recomputed without the tag key', () => {
    const conLaNuestra = humanTagFor(WORLD_ID, ELECTION, CREATED);
    process.env.ENROLMENT_TAG_KEYS = JSON.stringify({ '2026-09': 'b'.repeat(64) });
    assert.notEqual(conLaNuestra, humanTagFor(WORLD_ID, ELECTION, CREATED));
  });

  test('survives rotating the SIGNING key, which is the point of separating them', () => {
    // This test used to assert the opposite, back when the tag was derived
    // from the signing key. Rotating that key to recover from a forged
    // signature would have changed every tag, and anybody mid-enrolment would
    // have been handed a second one: recovering from one incident causing
    // another. The two secrets are independent now.
    const antes = humanTagFor(WORLD_ID, ELECTION, CREATED);
    process.env.ELIGIBILITY_ATTESTER_PRIVATE_KEY = OTHER_KEY;
    assert.equal(antes, humanTagFor(WORLD_ID, ELECTION, CREATED));
  });

  test('is different under the key of another epoch', () => {
    process.env.ENROLMENT_TAG_KEYS = JSON.stringify({
      '2026-09': 'a'.repeat(64),
      '2026-10': 'c'.repeat(64),
    });
    assert.notEqual(
      humanTagFor(WORLD_ID, ELECTION, CREATED),
      humanTagFor(WORLD_ID, ELECTION, CREATED_OTRO_MES),
    );
  });

  test('refuses a retired epoch instead of substituting another key', () => {
    // The whole safety of retiring keys. Falling back would issue a second,
    // different tag for an election that already has one on chain, which is
    // the double-leaf bug this scheme exists to prevent.
    process.env.ENROLMENT_TAG_KEYS = JSON.stringify({ '2026-10': 'c'.repeat(64) });
    assert.throws(() => humanTagFor(WORLD_ID, ELECTION, CREATED), /2026-09/);
  });

  test('is a decimal string the contract can take as a uint256', () => {
    const tag = humanTagFor(WORLD_ID, ELECTION, CREATED);
    assert.match(tag, /^\d+$/);
    assert.ok(BigInt(tag) > 0n);
    assert.ok(BigInt(tag) < 2n ** 256n);
  });
});

describe('signing a private enrolment', () => {
  test('recovers to the attester, over the values the contract will hash', async () => {
    const tag = humanTagFor(WORLD_ID, ELECTION, CREATED);
    const now = 1_800_000_000;
    const { signature, deadline, humanTag } = await signPrivateEnrollment(
      ELECTION,
      CHAIN_ID,
      COMMITMENT,
      tag,
      now,
    );

    assert.equal(humanTag, tag);
    assert.equal(deadline, now + ATTESTATION_TTL_SECONDS);

    const recovered = verifyTypedData(
      { name: 'VotainElection', version: '1', chainId: CHAIN_ID, verifyingContract: ELECTION },
      {
        PrivateEnrollment: [
          { name: 'identityCommitment', type: 'uint256' },
          { name: 'humanTag', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      { identityCommitment: BigInt(COMMITMENT), humanTag: BigInt(tag), deadline },
      signature,
    );

    assert.equal(recovered, new Wallet(KEY).address);
  });

  test('is bound to one election, so it cannot be moved to another', async () => {
    const tag = humanTagFor(WORLD_ID, ELECTION, CREATED);
    const now = 1_800_000_000;
    const { signature, deadline } = await signPrivateEnrollment(
      ELECTION,
      CHAIN_ID,
      COMMITMENT,
      tag,
      now,
    );

    const recovered = verifyTypedData(
      // The same message, judged by the election next door.
      { name: 'VotainElection', version: '1', chainId: CHAIN_ID, verifyingContract: OTHER_ELECTION },
      {
        PrivateEnrollment: [
          { name: 'identityCommitment', type: 'uint256' },
          { name: 'humanTag', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      { identityCommitment: BigInt(COMMITMENT), humanTag: BigInt(tag), deadline },
      signature,
    );

    assert.notEqual(recovered, new Wallet(KEY).address);
  });

  test('refuses to sign without a tag, which would stand for everybody', async () => {
    await assert.rejects(
      () => signPrivateEnrollment(ELECTION, CHAIN_ID, COMMITMENT, '0'),
      /no human tag/,
    );
  });
});
