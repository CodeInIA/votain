import crypto from 'crypto';

// For Phase 2 local development, we simulate a simple ED25519 keypair for the Issuer.
// In production, the private key would be securely loaded from KMS or .env
export function getIssuerKeyPair() {
  const privateKeyBase64 = process.env.ISSUER_PRIVATE_KEY;
  if (!privateKeyBase64) {
    throw new Error('ISSUER_PRIVATE_KEY not set in .env');
  }
  
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8'
  });
  const publicKey = crypto.createPublicKey(privateKey);
  
  return { publicKey, privateKey };
}

// Helper to sign the SD-JWT (mocking the exact algorithm/header requirements based on @sd-jwt/core config)
// The actual implementation depends on the exact @sd-jwt/core and jsonwebtoken signature approach.
export const issueSigner = async (
  data: string,
  privateKey: crypto.KeyObject
): Promise<string> => {
  const signature = crypto.sign(
    null,                         // null = Ed25519 maneja el hash internamente
    Buffer.from(data, 'utf-8'),
    privateKey
  );
  return signature.toString('base64url');
};
