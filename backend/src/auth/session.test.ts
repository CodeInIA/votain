/**
 * Session verification tests.
 *
 * The regression these lock down: `/api/me` and the identity vault used to
 * decode the cookie's JWT payload without checking its signature, so a
 * handcrafted token authenticated as any voter. Because the vault write path
 * registers the resulting commitment in PlatformRegistry, that let an attacker
 * enrol arbitrary identities and defeat Sybil resistance.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

// Throwaway Ed25519 issuer key, installed before the module under test loads.
const { privateKey } = crypto.generateKeyPairSync('ed25519');
process.env.ISSUER_PRIVATE_KEY = privateKey
  .export({ format: 'der', type: 'pkcs8' })
  .toString('base64');

const { sdJwt } = await import('../sd/issuer.js');
const { verifySession } = await import('./session.js');
type VotainCredentialPayload = import('../sd/issuer.js').VotainCredentialPayload;

const NULLIFIER = '0xrealvoter';

function basePayload(overrides: Partial<VotainCredentialPayload> = {}): VotainCredentialPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://issuer.votain.local',
    sub: NULLIFIER,
    iat: now,
    exp: now + 3600,
    vct: 'votain:voter-credential:v1',
    ...overrides,
  };
}

/// Forges the shape of a JWT without access to the issuer key.
function forge(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.not-a-real-signature`;
}

describe('verifySession', () => {
  let credential: string;

  before(async () => {
    credential = await sdJwt.issue(basePayload(), {});
  });

  it('accepts a credential this issuer really signed', async () => {
    const session = await verifySession(credential);
    assert.equal(session?.nullifier, NULLIFIER);
  });

  it('rejects a forged token with a valid-looking payload', async () => {
    const attacker = forge(basePayload({ sub: '0xsomeone-else' }));
    assert.equal(await verifySession(attacker), null);
  });

  it('rejects a token signed by a different key', async () => {
    const other = crypto.generateKeyPairSync('ed25519');
    process.env.ISSUER_PRIVATE_KEY = other.privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    // Freshly imported instance signs with the attacker's key.
    const rogue = await import(`../sd/issuer.js?rogue=${Date.now()}`);
    const foreign: string = await rogue.sdJwt.issue(basePayload(), {});

    assert.equal(await verifySession(foreign), null);
  });

  it('rejects an expired credential', async () => {
    const expired = await sdJwt.issue(basePayload({ exp: Math.floor(Date.now() / 1000) - 10 }), {});
    assert.equal(await verifySession(expired), null);
  });

  it('rejects a missing or empty cookie', async () => {
    assert.equal(await verifySession(undefined), null);
    assert.equal(await verifySession(''), null);
    assert.equal(await verifySession('garbage'), null);
  });

  it('rejects a credential whose payload was swapped under a real signature', async () => {
    const [header, , signature] = credential.split('.');
    const swapped = Buffer.from(JSON.stringify(basePayload({ sub: '0xhijacked' }))).toString(
      'base64url',
    );
    assert.equal(await verifySession(`${header}.${swapped}.${signature}`), null);
  });
});
