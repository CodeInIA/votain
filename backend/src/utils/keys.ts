import crypto from 'crypto';

/**
 * The issuer's Ed25519 key pair, from `ISSUER_PRIVATE_KEY` (PKCS#8 DER, base64).
 *
 * Fails at start-up rather than at the first sign-in: a server that cannot
 * sign credentials has nothing useful to offer.
 */
export function getIssuerKeyPair() {
  const privateKeyBase64 = process.env.ISSUER_PRIVATE_KEY;
  if (!privateKeyBase64) {
    throw new Error('ISSUER_PRIVATE_KEY not set in .env');
  }

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  // createPublicKey derives the public key from a private key PEM. @types/node 26
  // narrowed the overloads and no longer accepts a KeyObject argument directly.
  const publicKey = crypto.createPublicKey(
    privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
  );

  return { publicKey, privateKey };
}

/** Signs SD-JWT input with Ed25519, which hashes internally, as base64url. */
export const issueSigner = async (data: string, privateKey: crypto.KeyObject): Promise<string> => {
  const signature = crypto.sign(null, Buffer.from(data, 'utf-8'), privateKey);
  return signature.toString('base64url');
};
