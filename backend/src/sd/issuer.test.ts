/**
 * SD-JWT issuer round-trip tests: issue → selectively present → verify,
 * plus Status List 2021 bitstring encode/decode.
 *
 * Run: npm test (node --test via tsx)
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

// Provide a throwaway Ed25519 issuer key before the module under test loads.
const { privateKey } = crypto.generateKeyPairSync('ed25519');
process.env.ISSUER_PRIVATE_KEY = privateKey
  .export({ format: 'der', type: 'pkcs8' })
  .toString('base64');

const { sdJwt, SELECTIVE_DISCLOSURE_FRAME } = await import('./issuer.js');
const { encodedList, checkBit, statusListCredential } = await import('../status/statusList.js');
type VotainCredentialPayload = import('./issuer.js').VotainCredentialPayload;

describe('SD-JWT issue → present → verify', () => {
  let credential: string;

  before(async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: VotainCredentialPayload = {
      iss: 'https://issuer.votain.local',
      sub: '0xnullifier',
      iat: now,
      exp: now + 3600,
      vct: 'votain:voter-credential:v1',
      country: 'ES',
      ageOver18: true,
      region: 'Madrid',
    };
    credential = await sdJwt.issue(payload, SELECTIVE_DISCLOSURE_FRAME);
  });

  it('issues a credential with selective-disclosure digests', () => {
    // SD-JWT format: <jwt>~<disclosure>~<disclosure>~<disclosure>~
    const parts = credential.split('~').filter(Boolean);
    assert.equal(parts.length, 4); // jwt + 3 disclosures

    // The raw JWT payload must NOT contain the plaintext claims
    const payload = JSON.parse(
      Buffer.from(credential.split('.')[1], 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
    assert.equal(payload.country, undefined);
    assert.ok(Array.isArray(payload._sd));
  });

  it('presents only the requested claim and verifies it', async () => {
    const presentation = await sdJwt.present<{ ageOver18: boolean }>(credential, {
      ageOver18: true,
    });

    // Presentation carries fewer disclosures than the full credential
    assert.ok(presentation.split('~').filter(Boolean).length < 4);

    const verified = await sdJwt.verify(presentation, { requiredClaims: ['ageOver18'] });
    const claims = verified.payload as { ageOver18?: boolean; country?: string };
    assert.equal(claims.ageOver18, true);
    assert.equal(claims.country, undefined); // undisclosed stays hidden
  });

  it('rejects a tampered credential', async () => {
    const tampered = credential.replace(/^(.{40})./, '$1x');
    await assert.rejects(sdJwt.verify(tampered));
  });
});

describe('Status List 2021', () => {
  it('encodes and reads back revocation bits', () => {
    const encoded = encodedList();
    assert.equal(checkBit(encoded, 7), false);
  });

  it('builds a well-formed StatusList2021Credential', () => {
    const vc = statusListCredential('http://localhost:3000', 'voters-1');
    assert.ok(vc['@context'].includes('https://w3id.org/vc/status-list/2021/v1'));
    assert.equal(vc.credentialSubject.statusPurpose, 'revocation');
    assert.ok(typeof vc.credentialSubject.encodedList === 'string');
  });
});
