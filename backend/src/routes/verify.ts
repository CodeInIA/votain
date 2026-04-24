import { Router, Request, Response } from 'express';
import { SDJwtInstance } from '@sd-jwt/core';
import type { SDJWTConfig, JwtPayload } from '@sd-jwt/types';
import crypto from 'crypto';
import { getIssuerKeyPair, issueSigner } from '../utils/keys.js';
import { signRequest } from '@worldcoin/idkit-core/signing';

const router = Router();
const { privateKey } = getIssuerKeyPair();

// El payload extiende JwtPayload para cumplir el constraint del genérico
type VotainCredentialPayload = JwtPayload & {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
};

const generateSalt = (): string => crypto.randomBytes(16).toString('base64url');

// SDJWTConfig sin genérico — así acepta el constructor
const sdJwtConfig: SDJWTConfig = {
  signer: async (data: string): Promise<string> => {
    return await issueSigner(data, privateKey);
  },
  hasher: async (data: string | Buffer | ArrayBuffer): Promise<Uint8Array> => {
    let inputData: Buffer;
    if (typeof data === 'string') {
      inputData = Buffer.from(data, 'utf-8');
    } else if (Buffer.isBuffer(data)) {
      inputData = data;
    } else {
      inputData = Buffer.from(data);
    }
    return new Uint8Array(crypto.createHash('sha256').update(inputData).digest());
  },
  signAlg: 'EdDSA',
  saltGenerator: generateSalt,
};

// El genérico tipea .issue() y .verify(), no el constructor
const sdJwt = new SDJwtInstance<VotainCredentialPayload>(sdJwtConfig);

// ────────────────────────────────────────────────
// POST /rp-signature
// ────────────────────────────────────────────────
router.post('/rp-signature', async (req: Request, res: Response) => {
  try {
    const { action } = req.body as { action?: string };

    if (!process.env.DEVELOPER_KEY) {
      throw new Error('DEVELOPER_KEY not configured');
    }

    const { sig, nonce, createdAt, expiresAt } = signRequest({
      signingKeyHex: process.env.DEVELOPER_KEY,
      action: action ?? process.env.WORLD_ID_ACTION ?? 'vote-registration',
    });

    return res.status(200).json({
      sig,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating RP signature:', error);
    return res.status(500).json({ error: 'Internal server error', message });
  }
});

// ────────────────────────────────────────────────
// POST /verify-human
// ────────────────────────────────────────────────
router.post('/verify-human', async (req: Request, res: Response) => {
  try {
    const idkitResponse = req.body as {
      responses?: Array<{ nullifier?: string }>;
      nullifier_hash?: string;
    };

    const rpId = process.env.WORLD_ID_RP_ID;
    if (!rpId) throw new Error('WORLD_ID_RP_ID not configured');

    console.log('Verify payload received:', JSON.stringify(idkitResponse, null, 2));

    // Verificar con la API v4 de Worldcoin
    const verifyRes = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(idkitResponse),
    });

    if (!verifyRes.ok) {
      const wldError: unknown = await verifyRes.json();
      console.error('World ID verification failed:', wldError);
      return res.status(400).json({ error: 'Invalid World ID proof', details: wldError });
    }

    // Extraer nullifier_hash compatible con protocolo v3 y v4
    const nullifier_hash: string =
      idkitResponse.responses?.[0]?.nullifier ??
      idkitResponse.nullifier_hash ??
      '';

    // Construir el payload de la credencial
    const now = Math.floor(Date.now() / 1000);
    const credentialPayload: VotainCredentialPayload = {
      iss: 'https://issuer.votain.local',
      sub: nullifier_hash,
      iat: now,
      exp: now + 365 * 24 * 60 * 60,
    };

    const issuedCredential = await sdJwt.issue(credentialPayload, {});

    return res.status(200).json({
      success: true,
      message: 'Human verified successfully',
      sdJwt: issuedCredential,
      nullifier: nullifier_hash,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error verifying human:', error);
    return res.status(500).json({ error: 'Internal server error', message });
  }
});

export default router;