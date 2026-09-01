import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, verifyTypedData } from 'ethers';

import { signEnrollAttestation, ATTESTATION_TTL_SECONDS } from './attester.js';

/**
 * The bug these exist for: the deadline was measured from THIS server's wall
 * clock, while `ElectionV4.enrollAttested` judges it against `block.timestamp`.
 * Where the two clocks disagree, every attestation is born expired and no
 * amount of retrying can produce a valid one. Reported from a local chain that
 * had been advanced a week past finished elections, where enrollment failed
 * with `AttestationExpired` forever.
 */

// Local test key, never used anywhere else.
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ELECTION = '0x979DC264DAE62e8957090F0b6D45B9b0652D1Dee';
const CHAIN_ID = 31337n;
const COMMITMENT = '12345678901234567890';
const NULLIFIER = '98765432109876543210';

beforeEach(() => {
  process.env.ELIGIBILITY_ATTESTER_PRIVATE_KEY = KEY;
});

afterEach(() => {
  delete process.env.ELIGIBILITY_ATTESTER_PRIVATE_KEY;
});

describe('signEnrollAttestation', () => {
  test('measures the deadline from the clock it is given, not from this one', async () => {
    // A chain running a week ahead. The attestation has to be valid THERE,
    // which is the only place it is ever checked.
    const chainNow = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    const signed = await signEnrollAttestation(
      ELECTION,
      CHAIN_ID,
      COMMITMENT,
      NULLIFIER,
      chainNow,
    );

    assert.equal(signed.deadline, chainNow + ATTESTATION_TTL_SECONDS);
    assert.ok(signed.deadline > chainNow, 'a deadline the chain has already passed is worthless');
  });

  test('still defaults to this clock, for the case where they agree', async () => {
    const before = Math.floor(Date.now() / 1000);
    const signed = await signEnrollAttestation(ELECTION, CHAIN_ID, COMMITMENT, NULLIFIER);
    assert.ok(signed.deadline >= before + ATTESTATION_TTL_SECONDS);
  });

  test('behaves on a healthy network exactly as it did before', async () => {
    // The shape of a real chain: blocks every couple of seconds, so the latest
    // block's timestamp trails the wall clock slightly and NEVER leads it, since
    // clients reject a block stamped far in the future. `max` therefore picks
    // the wall clock and the deadline is the one this server would have signed
    // anyway. The fix costs one block read and changes nothing on Amoy.
    const wall = Math.floor(Date.now() / 1000);
    const chainSlightlyBehind = wall - 2;
    const base = Math.max(wall, chainSlightlyBehind);

    const signed = await signEnrollAttestation(ELECTION, CHAIN_ID, COMMITMENT, NULLIFIER, base);

    assert.equal(base, wall, 'the wall clock wins whenever the chain trails it');
    assert.equal(signed.deadline, wall + ATTESTATION_TTL_SECONDS);
  });

  test('never shortens the window, whichever clock is ahead', async () => {
    // The property that makes this safe to deploy: taking the LATER of the two
    // can only move the deadline outwards, so a voter always has the full TTL
    // measured from whichever clock is furthest along.
    const wall = Math.floor(Date.now() / 1000);
    for (const chain of [wall - 3600, wall, wall + 3600]) {
      const signed = await signEnrollAttestation(
        ELECTION,
        CHAIN_ID,
        COMMITMENT,
        NULLIFIER,
        Math.max(wall, chain),
      );
      assert.ok(
        signed.deadline >= wall + ATTESTATION_TTL_SECONDS,
        `deadline was short with the chain at ${chain - wall}s`,
      );
      assert.ok(signed.deadline > chain, 'and always ahead of the chain that judges it');
    }
  });

  test('signs the nullifier, so a relay cannot swap it in transit', async () => {
    const now = 1_700_000_000;
    const signed = await signEnrollAttestation(ELECTION, CHAIN_ID, COMMITMENT, NULLIFIER, now);

    const domain = {
      name: 'VotainElection',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: ELECTION,
    };
    const types = {
      EnrollAttestation: [
        { name: 'identityCommitment', type: 'uint256' },
        { name: 'personhoodNullifier', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };

    const recovered = verifyTypedData(
      domain,
      types,
      {
        identityCommitment: BigInt(COMMITMENT),
        personhoodNullifier: BigInt(NULLIFIER),
        deadline: signed.deadline,
      },
      signed.signature,
    );
    assert.equal(recovered, new Wallet(KEY).address);

    // The same signature against a different nullifier recovers somebody else,
    // which is what the contract's `signer != eligibilityAttester` check reads.
    const swapped = verifyTypedData(
      domain,
      types,
      {
        identityCommitment: BigInt(COMMITMENT),
        personhoodNullifier: BigInt(NULLIFIER) + 1n,
        deadline: signed.deadline,
      },
      signed.signature,
    );
    assert.notEqual(swapped, new Wallet(KEY).address);
  });

  test('refuses to sign without a personhood nullifier', async () => {
    // The contract rejects a zero, and failing here says why instead of leaving
    // the voter with an unexplained revert.
    await assert.rejects(
      () => signEnrollAttestation(ELECTION, CHAIN_ID, COMMITMENT, '0'),
      /no personhood nullifier/,
    );
    await assert.rejects(
      () => signEnrollAttestation(ELECTION, CHAIN_ID, COMMITMENT, ''),
      /no personhood nullifier/,
    );
  });
});
