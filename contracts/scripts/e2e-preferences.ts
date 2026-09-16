/**
 * End-to-end walkthrough of a voter's saved elections, on the local chain.
 *
 * The claim being tested is a privacy claim, and it is the only reason this
 * feature is allowed to touch the chain at all: a voter's list of saved
 * elections is stored where anyone can read it, and nobody can read it. A unit
 * test can check that a mapping holds bytes. What it cannot check is that the
 * bytes a browser produces, stored by the contract a relayer calls, come back
 * as the same list and as nothing else.
 *
 * So this seals a list exactly as `frontend/src/lib/savedElections.ts` does,
 * with the same HKDF info string, the same AES-GCM shape and the same JSON,
 * writes it through `setPreferences`, and then:
 *
 *   1. Reads it back and opens it with the voter's secret.
 *   2. Confirms the election addresses appear NOWHERE in what the chain stores.
 *   3. Confirms another voter's secret opens nothing.
 *   4. Confirms the refusals: an unknown human, an oversized blob, a stranger
 *      writing over somebody else's settings.
 *   5. Confirms clearing works, since unsaving the last election has to.
 *
 * Run against a node started with `npx hardhat node`:
 *   npx hardhat run scripts/e2e-preferences.ts --network localhost
 */
import { network } from "hardhat";

const { ethers } = await network.getOrCreate();

/** The frontend's string. If these ever differ, neither side opens the other. */
const HKDF_INFO = "votain/preferences-key/v1";
const IV_BYTES = 12;

const NULLIFIER = 4242424242n;
const COMMITMENT = 987654321n;
const OTHER_NULLIFIER = 777777n;
const OTHER_COMMITMENT = 111111n;

const ELECTION = "0x979DC264DAE62e8957090F0b6D45B9b0652D1Dee";
const OTHER_ELECTION = "0x2e234DAe75C793f67A35089C9d99245E1C58470b";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? `  (${detail})` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

// ────────────────────────────────────────────────
// The browser's half, reproduced
// ────────────────────────────────────────────────

type Entries = Record<string, number>;

async function preferencesKey(secret: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(secret: string, entries: Entries): Promise<Uint8Array> {
  const key = await preferencesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify({ v: 1, e: entries })),
    ),
  );
  const blob = new Uint8Array(iv.length + ciphertext.length);
  blob.set(iv, 0);
  blob.set(ciphertext, iv.length);
  return blob;
}

async function open(secret: string, blob: Uint8Array): Promise<Entries | null> {
  try {
    const key = await preferencesKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: blob.slice(0, IV_BYTES) },
      key,
      blob.slice(IV_BYTES),
    );
    return (JSON.parse(new TextDecoder().decode(plaintext)) as { e: Entries }).e;
  } catch {
    return null;
  }
}

const toHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`;

const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));

// ────────────────────────────────────────────────

async function main(): Promise<void> {
  const [owner, stranger] = await ethers.getSigners();

  console.log("\nSaved elections, end to end\n");

  const PlatformRegistry = await ethers.getContractFactory("PlatformRegistry");
  const registry = await PlatformRegistry.deploy();
  await registry.waitForDeployment();
  await (await registry.registerMember(NULLIFIER, COMMITMENT)).wait();
  await (await registry.registerMember(OTHER_NULLIFIER, OTHER_COMMITMENT)).wait();
  console.log(`  registry at ${await registry.getAddress()}\n`);

  // 1. A voter saves two elections on one device.
  const secret = "12345678901234567890";
  const otherSecret = "98765432109876543210";
  const entries: Entries = {
    [ELECTION.toLowerCase().slice(2)]: 1726500000,
    [OTHER_ELECTION.toLowerCase().slice(2)]: 1726600000,
  };

  const blob = await seal(secret, entries);
  await (await registry.setPreferences(NULLIFIER, toHex(blob))).wait();

  const stored: string = await registry.preferencesOf(NULLIFIER);
  check("the chain hands back exactly what was written", stored === toHex(blob), `${blob.length} bytes`);

  // 2. Another device, with nothing but the secret, reads the list back.
  const reopened = await open(secret, fromHex(stored));
  check(
    "a second device opens it with the same secret",
    JSON.stringify(reopened) === JSON.stringify(entries),
  );

  // 3. THE PRIVACY CLAIM. What is on chain must not name the elections.
  const naked = stored.toLowerCase();
  check(
    "the saved elections appear nowhere in what the chain stores",
    !naked.includes(ELECTION.toLowerCase().slice(2)) &&
      !naked.includes(OTHER_ELECTION.toLowerCase().slice(2)),
  );

  // 4. Nor may anyone else read it, including the platform that wrote it.
  check("another voter's secret opens nothing", (await open(otherSecret, fromHex(stored))) === null);

  // 5. Each human's settings are their own.
  const theirs = await seal(otherSecret, { [ELECTION.toLowerCase().slice(2)]: 1726700000 });
  await (await registry.setPreferences(OTHER_NULLIFIER, toHex(theirs))).wait();
  check(
    "one human's settings do not disturb another's",
    (await registry.preferencesOf(NULLIFIER)) === toHex(blob),
  );

  // 6. Replacing, which is how a change is stored.
  const changed = await seal(secret, { [ELECTION.toLowerCase().slice(2)]: -1726800000 });
  await (await registry.setPreferences(NULLIFIER, toHex(changed))).wait();
  const afterChange = await open(secret, fromHex(await registry.preferencesOf(NULLIFIER)));
  check(
    "unsaving is stored as a fact, not as an absence",
    afterChange !== null && afterChange[ELECTION.toLowerCase().slice(2)] === -1726800000,
  );

  // 7. Clearing, which unsaving the last election has to reach.
  await (await registry.setPreferences(NULLIFIER, "0x")).wait();
  check("a voter can clear them", (await registry.preferencesOf(NULLIFIER)) === "0x");

  // 8. The refusals.
  let refused = false;
  try {
    await registry.setPreferences(999n, toHex(blob));
  } catch {
    refused = true;
  }
  check("refuses settings for a human the registry does not know", refused);

  refused = false;
  try {
    const cap = Number(await registry.MAX_PREFERENCES_BYTES());
    await registry.setPreferences(NULLIFIER, `0x${"ab".repeat(cap + 1)}`);
  } catch {
    refused = true;
  }
  check("refuses a blob past the cap that bounds the relayer's gas", refused);

  refused = false;
  try {
    await registry.connect(stranger).setPreferences(NULLIFIER, toHex(blob));
  } catch {
    refused = true;
  }
  check("refuses a stranger writing over somebody's settings", refused);

  // 9. What one change costs, since the platform pays for it.
  await (await registry.setPreferences(NULLIFIER, toHex(blob))).wait();
  const gas = await registry.setPreferences.estimateGas(NULLIFIER, toHex(await seal(secret, entries)));
  console.log(`\n  one change of a two election list costs ${gas} gas\n`);

  console.log(`  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

await main();
