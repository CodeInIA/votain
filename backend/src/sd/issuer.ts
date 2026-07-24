/**
 * Shared SD-JWT issuer/verifier instance (EdDSA / Ed25519).
 *
 * Selective disclosure: identity attributes (country, ageOver18, region) are
 * issued as _sd claims so the voter can disclose only what an election's
 * eligibility check needs. Sources: World ID Credentials when available;
 * demo values otherwise (source-agnostic schema, see docs).
 */
import crypto from 'crypto';
import {
  SDJwtInstance,
  type SDJWTConfig,
  type JwtPayload,
  type DisclosureFrame,
} from '@sd-jwt/core';
import { getIssuerKeyPair, issueSigner } from '../utils/keys.js';

const { privateKey, publicKey } = getIssuerKeyPair();

export type VotainCredentialPayload = JwtPayload & {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  vct: string;
  cnf?: Record<string, unknown>;
  country?: string;
  ageOver18?: boolean;
  region?: string;
  credentialStatus?: {
    id: string;
    type: 'StatusList2021Entry';
    statusPurpose: 'revocation';
    statusListIndex: string;
    statusListCredential: string;
  };
};

const generateSalt = (): string => crypto.randomBytes(16).toString('base64url');

const hasher = async (data: string | Buffer | ArrayBuffer): Promise<Uint8Array> => {
  let inputData: Buffer;
  if (typeof data === 'string') {
    inputData = Buffer.from(data, 'utf-8');
  } else if (Buffer.isBuffer(data)) {
    inputData = data;
  } else {
    inputData = Buffer.from(data);
  }
  return new Uint8Array(crypto.createHash('sha256').update(inputData).digest());
};

const sdJwtConfig: SDJWTConfig = {
  signer: async (data: string): Promise<string> => issueSigner(data, privateKey),
  verifier: async (data: string, sig: string): Promise<boolean> => {
    return crypto.verify(null, Buffer.from(data, 'utf-8'), publicKey, Buffer.from(sig, 'base64url'));
  },
  hasher,
  signAlg: 'EdDSA',
  saltGenerator: generateSalt,
};

export const sdJwt = new SDJwtInstance<VotainCredentialPayload>(sdJwtConfig);

/** Claims hidden behind selective disclosure digests. */
export const SELECTIVE_DISCLOSURE_FRAME = {
  _sd: ['country', 'ageOver18', 'region'],
} as DisclosureFrame<VotainCredentialPayload>;

export const issuerPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
