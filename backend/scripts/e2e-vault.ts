/**
 * The identity vault, end to end, against a real chain.
 *
 * The vault used to be a JSON file on this server, and its rules were unit
 * tested against that file. They are the chain's rules now, so testing them
 * against a stub would only prove the stub. This drives the real module against
 * a real `PlatformRegistry` and checks the things a voter's access depends on:
 * that a sealed blob comes back byte for byte, that one human keeps exactly one
 * commitment, and that recovery leaves nothing behind that could open a door
 * the registry has already walled up.
 *
 * Needs a node with the contracts deployed, and the same env the server reads:
 *   CHAIN_RPC_URL, REGISTRY_ADDRESS, REGISTRAR_PRIVATE_KEY
 *
 *   npx tsx scripts/e2e-vault.ts
 */
import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';

config();

const { getVault, putVaultEntry, removeVaultEntry, resetVault, CommitmentMismatchError } =
  await import('../src/identity/vault.js');
const { registerOnChain, rotateOnChain, isRegistrarConfigured } = await import(
  '../src/chain/registrar.js'
);

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

/** A fresh human every run, so repeated runs never collide on chain. */
function freshNullifier(): string {
  return BigInt(`0x${randomBytes(24).toString('hex')}`).toString();
}

function freshCommitment(): string {
  return BigInt(`0x${randomBytes(24).toString('hex')}`).toString();
}

const b64 = (bytes: number) => randomBytes(bytes).toString('base64url');

async function main(): Promise<void> {
  if (!isRegistrarConfigured()) {
    console.error('CHAIN_RPC_URL, REGISTRY_ADDRESS and REGISTRAR_PRIVATE_KEY must be set.');
    process.exit(1);
  }

  console.log('\n1. A registered human with no vault yet');
  const human = freshNullifier();
  const commitment = freshCommitment();

  check('an unknown human has no vault at all', (await getVault(human)) === null);

  const registration = await registerOnChain(human, commitment);
  check('registered on chain', registration.registered, registration.txHash?.slice(0, 12));

  const empty = await getVault(human);
  check('registered but unsealed reads as a real, empty vault', empty?.entries.length === 0);
  check('and already carries the commitment', empty?.commitment === commitment);

  console.log('\n2. Sealing, and getting the same bytes back');
  const credentialA = b64(32);
  const blobA = b64(92);
  await putVaultEntry(human, commitment, { credentialId: credentialA, blob: blobA });

  const stored = await getVault(human);
  check('one entry stored', stored?.entries.length === 1);
  check('credential id survives the round trip', stored?.entries[0].credentialId === credentialA);
  check('the ciphertext survives byte for byte', stored?.entries[0].blob === blobA);
  check('and carries the chain time it was added', Boolean(stored?.entries[0].addedAt));

  console.log('\n3. A second passkey opens the same identity');
  const credentialB = b64(32);
  const blobB = b64(92);
  await putVaultEntry(human, commitment, { credentialId: credentialB, blob: blobB });

  const two = await getVault(human);
  check('two entries', two?.entries.length === 2);
  check('the commitment did not move', two?.commitment === commitment);
  check(
    'each passkey keeps its own ciphertext',
    two?.entries.find(e => e.credentialId === credentialA)?.blob === blobA &&
      two?.entries.find(e => e.credentialId === credentialB)?.blob === blobB,
  );

  console.log('\n4. One human, one identity');
  let refused = false;
  try {
    await putVaultEntry(human, freshCommitment(), { credentialId: b64(32), blob: b64(92) });
  } catch (error) {
    refused = error instanceof CommitmentMismatchError;
  }
  check('a second commitment for the same human is refused', refused);

  console.log('\n5. Re-sealing a passkey replaces its copy');
  const resealed = b64(92);
  await putVaultEntry(human, commitment, { credentialId: credentialA, blob: resealed });
  const afterReseal = await getVault(human);
  check('still two entries, not three', afterReseal?.entries.length === 2);
  check(
    'and the passkey now opens the new ciphertext',
    afterReseal?.entries.find(e => e.credentialId === credentialA)?.blob === resealed,
  );

  console.log('\n6. Unlinking a device');
  await removeVaultEntry(human, credentialB);
  const afterRemove = await getVault(human);
  check('the removed passkey is no longer offered', afterRemove?.entries.length === 1);
  check('the remaining one is untouched', afterRemove?.entries[0].credentialId === credentialA);

  console.log('\n7. Recovery leaves nothing stale behind');
  const newCommitment = freshCommitment();
  const rotated = await rotateOnChain(human, newCommitment);
  check('rotated on chain', rotated.registered, rotated.txHash?.slice(0, 12));

  const credentialC = b64(32);
  const blobC = b64(92);
  await resetVault(human, newCommitment, { credentialId: credentialC, blob: blobC });

  const recovered = await getVault(human);
  check('exactly one entry survives', recovered?.entries.length === 1);
  check('it is the new passkey', recovered?.entries[0].credentialId === credentialC);
  check('the commitment followed the rotation', recovered?.commitment === newCommitment);
  check(
    'and the pre-rotation blobs are gone, so no dead key is offered',
    !recovered?.entries.some(e => e.blob === blobA || e.blob === resealed),
  );

  console.log('\n8. Vaults do not leak between humans');
  const other = freshNullifier();
  const otherCommitment = freshCommitment();
  await registerOnChain(other, otherCommitment);
  await putVaultEntry(other, otherCommitment, { credentialId: b64(32), blob: b64(92) });

  const mine = await getVault(human);
  const theirs = await getVault(other);
  check('each human sees only their own entries', mine?.entries.length === 1 && theirs?.entries.length === 1);
  check('and their own commitment', theirs?.commitment === otherCommitment);

  console.log(`\nRESULT  ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
