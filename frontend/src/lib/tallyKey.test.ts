import { describe, it, expect } from 'vitest';
import { deriveKeysFromSecret } from './tallyKey';

/**
 * Regression vector for the organizer's tally key.
 *
 * The key is never stored: it is re-derived from the passkey PRF secret every
 * time the organizer runs a tally. That makes the derivation a COMPATIBILITY
 * SURFACE, not an implementation detail. Any change that yields a different
 * keypair for the same (secret, keyNonce) silently destroys the ability to
 * decrypt every election created before the change.
 *
 * These values were produced by the implementation as it stood before the prime
 * search was optimised. The optimisation only skips candidates that trial
 * division proves composite, so the first prime the walk reaches is unchanged
 * and this vector still holds. If it ever fails, the derivation moved and old
 * elections became undecryptable: that is a breaking change, not a test to fix.
 */
const SECRET = new Uint8Array(32).fill(7);
const KEY_NONCE = '0xdeadbeefdeadbeefdeadbeefdeadbeef';

const EXPECTED_N = '0xc9e24745a8169fee95c36f418afa9892c8301677b7f3090fc3e7934038d9b202f2f0c5245b484868788f5323512856c6fc0c0f0f5b107c86a4f1d042414cb0884c3463bd64fda1d1538a156d9014afca0f7cbc6b5d338246d309594eb60775c9d421439e1eea3d7b7f663bd4e6aaa6fd121297302011c45a8da5ea50b48048b084adfe5be855ab73204dc0e38d088773b25de2b06ef0e92f51ddad6f3ae562899e637ecd657291fd4c5feec3ba548f84670772e898df1f328506c510c6a9410045431e8dd68561d1b9f68d20ec10d8356b2eda4df98617d33decbf43dac5e9f9adb3b97e4fb76a32d5fef36202727696dd00468cda90a677da7824b7d6585f83';
const EXPECTED_G = '0xc9e24745a8169fee95c36f418afa9892c8301677b7f3090fc3e7934038d9b202f2f0c5245b484868788f5323512856c6fc0c0f0f5b107c86a4f1d042414cb0884c3463bd64fda1d1538a156d9014afca0f7cbc6b5d338246d309594eb60775c9d421439e1eea3d7b7f663bd4e6aaa6fd121297302011c45a8da5ea50b48048b084adfe5be855ab73204dc0e38d088773b25de2b06ef0e92f51ddad6f3ae562899e637ecd657291fd4c5feec3ba548f84670772e898df1f328506c510c6a9410045431e8dd68561d1b9f68d20ec10d8356b2eda4df98617d33decbf43dac5e9f9adb3b97e4fb76a32d5fef36202727696dd00468cda90a677da7824b7d6585f84';
const EXPECTED_LAMBDA = '0xc9e24745a8169fee95c36f418afa9892c8301677b7f3090fc3e7934038d9b202f2f0c5245b484868788f5323512856c6fc0c0f0f5b107c86a4f1d042414cb0884c3463bd64fda1d1538a156d9014afca0f7cbc6b5d338246d309594eb60775c9d421439e1eea3d7b7f663bd4e6aaa6fd121297302011c45a8da5ea50b48048ae976e38af00c22def75e63eb524edd7f89ca3c972ca3e672082d4032363914b483794e1573aecf39c5bbae118f5d406ab38e929aa8470139b4cd99d0649dc43ce831b5f418561891f091fc0ed8ec915322e6f4d08f1998bdfcaed36fbee85afe63952c8838bc384fa7d839f2856f8e78f5e9d1d37a70e6c92244ae0cacd538d10';
const EXPECTED_MU = '0x892e092faa6fdddcf0585fa658ace1bd2db903163b0264faf118ad8b9e20a512598d42f8c081a667bd96d50303a0b8481ad71d29d27c61124d9643100acc702cc7045371ce82930ffb185dc3ff9f06945d7183a022648630d6399da7acd3c57bdc037be483246f9fc66c94cb410b38b9d008da9d470b3e8ae0a5334cfcfb9b4d76c4c630627ba17c360c9032b4c2bf7d895e624571f26658de838aacbfe2a0d599d565446115d3bc0137338d3fd5cc7e1636aba48fe7b4a1fc158f315feea595a5700e40561b517aef5a240693e8724bd5aa8387c80e023ffa87e3ce01d8b754cf4e39a8ae1a2f2be06c88b3e74194cb4ab8216cc9c8f7e583f67417dbdd0066';

describe('tally key derivation', () => {
  it('reproduces the pinned keypair for a fixed secret and nonce', async () => {
    const keys = await deriveKeysFromSecret(SECRET, KEY_NONCE);
    expect(keys.publicKey.n).toBe(EXPECTED_N);
    expect(keys.publicKey.g).toBe(EXPECTED_G);
    expect(keys.privateKey.lambda).toBe(EXPECTED_LAMBDA);
    expect(keys.privateKey.mu).toBe(EXPECTED_MU);
  }, 900000);

  it('produces a modulus of exactly the configured size', async () => {
    const keys = await deriveKeysFromSecret(SECRET, KEY_NONCE);
    expect(BigInt(keys.publicKey.n).toString(2).length).toBe(2048);
  }, 900000);

  it('gives different keys for different nonces', async () => {
    const a = await deriveKeysFromSecret(SECRET, KEY_NONCE);
    const b = await deriveKeysFromSecret(SECRET, '0x00000000000000000000000000000001');
    expect(a.publicKey.n).not.toBe(b.publicKey.n);
  }, 900000);
});
