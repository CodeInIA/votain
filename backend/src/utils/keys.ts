import crypto from 'crypto';

// For Phase 2 local development, we simulate a simple ED25519 keypair for the Issuer.
// In production, the private key would be securely loaded from KMS or .env
export function getIssuerKeyPair() {
  // Try to use a persistent mock keypair so signatures don't invalidate on restart during dev,
  // or just generate on the fly if strictly testing.
  
  // Here we dynamically generate a key pair for the SD-JWT signature for simplicity in Phase 2
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  
  return { publicKey, privateKey };
}

// Helper to sign the SD-JWT (mocking the exact algorithm/header requirements based on @sd-jwt/core config)
// The actual implementation depends on the exact @sd-jwt/core and jsonwebtoken signature approach.
export const issueSigner = async (data: string, privateKey: crypto.KeyObject): Promise<string> => {
  const sign = crypto.createSign('Ed25519');
  sign.update(data);
  sign.end();
  return sign.sign(privateKey).toString('base64url');
};
