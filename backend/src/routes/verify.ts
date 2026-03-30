import { Router, Request, Response } from 'express';
import { SDJwtInstance } from '@sd-jwt/core';
import crypto from 'crypto';
import { getIssuerKeyPair, issueSigner } from '../utils/keys.js';

const router = Router();
const { publicKey, privateKey } = getIssuerKeyPair();

// Custom random string generator required by @sd-jwt/core for salts
const generateSalt = () => {
  return crypto.randomBytes(16).toString('base64url');
};

router.post('/verify-human', async (req: Request, res: Response) => {
  try {
    const { proof, nullifier_hash, credential_type, action, signal, attributes } = req.body;

    // 1. Verify World ID Proof via Worldcoin API
    const worldIdAppId = process.env.WORLD_ID_APP_ID;
    const worldIdAction = process.env.WORLD_ID_ACTION;

    if (!worldIdAppId) {
      throw new Error('WORLD_ID_APP_ID not configured');
    }

    const verifyRes = await fetch(`https://developer.worldcoin.org/api/v1/verify/${worldIdAppId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nullifier_hash,
        action: action || worldIdAction,
        signal,
        proof,
        credential_type: credential_type || "orb",
      }),
    });

    const wldResponse = await verifyRes.json();

    // Verify Worldcoin response
    if (verifyRes.status !== 200) {
      if (process.env.NODE_ENV !== "development") {
        return res.status(400).json({ error: 'Invalid World ID proof', details: wldResponse });
      } else {
        console.log("Development mode: Mocking valid proof verification");
      }
    }

    // 2. Proof is valid, generate Verifiable Credential (SD-JWT)
    // We bind the Semaphore 'identityCommitment' derived from 'signal' to the human's VC.
    
    // Create the payload for the SD-JWT
    const credentialPayload = {
      iss: 'https://issuer.votain.local',
      sub: signal, // The Semaphore Identity Commitment submitted securely via the World ID signal
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year expiration
    };

    // Instantiate SDJwtInstance with proper signer and hash configuration
    const sdJwt = new SDJwtInstance({
      signer: async (data: string) => await issueSigner(data, privateKey),
      hasher: async (data: string | Buffer | ArrayBuffer) => {
        let inputData: Buffer;
        if (typeof data === 'string') {
          inputData = Buffer.from(data, 'utf-8');
        } else if (Buffer.isBuffer(data)) {
          inputData = data;
        } else {
          inputData = Buffer.from(data);
        }
        
        // In the exact @sd-jwt/core version 0.19 it is strictly typed to expect Uint8Array<ArrayBufferLike> back.
        // Copying the buffer natively avoids NodeJS memory pool offset problems
        return new Uint8Array(crypto.createHash('sha256').update(inputData).digest());
      },
      signAlg: 'EdDSA', // Ed25519 standard
      saltGenerator: generateSalt,
    });

    // Make the user attributes selectively disclosable 
    // e.g. { ageOver18: true, country: 'ES' } => User can choose to only reveal 'ageOver18' to the frontend verifier
    const issuedCredential = await sdJwt.issue(credentialPayload, attributes || {});

    return res.status(200).json({
      success: true,
      message: 'Human verified successfully',
      sdJwt: issuedCredential, 
      nullifier: nullifier_hash
    });
    
  } catch (error: any) {
    console.error('Error verifying human:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

export default router;