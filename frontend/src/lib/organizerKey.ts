/**
 * The organizer's tally master secret, derived from their wallet.
 *
 * WHY THE WALLET AND NOT THE PASSKEY. An organizer already has a wallet and
 * cannot act without one: elections are owned by the address and every lifecycle
 * call is a transaction from it. So the wallet is what identifies them, and a
 * secret derived from it is available wherever they can work at all.
 *
 * The passkey was the previous source and it failed at exactly the thing this
 * has to do, which is work on a second device. Chrome and Firefox on Windows
 * return a PRF secret when a credential is created and refuse to evaluate it on
 * an assertion, measured across seven combinations of residency,
 * allowCredentials and user verification, over http://localhost and over HTTPS.
 * An organizer there could sign in and then not open their own elections.
 *
 * WHY A SIGNATURE IS A KEY. ECDSA as every wallet implements it is deterministic
 * (RFC 6979): the nonce comes from the private key and the message rather than
 * from randomness, so signing the same payload twice returns the same bytes.
 * Verified against MetaMask, three signatures of one message, byte identical.
 * That makes a signature a reproducible secret that never leaves the wallet.
 *
 * WHY EIP-712 AND NOT personal_sign. Typed data is rendered by the wallet as
 * named fields rather than as a wall of text, so somebody can see what they are
 * signing; and the domain separator carries the chain id, so a signature
 * gathered on one chain cannot be replayed as the key for another.
 *
 * WHAT IT COSTS, and it is not nothing: whoever holds the wallet can now also
 * decrypt the ballots. Before, a stolen wallet could cancel an election and
 * publish a false result, both of which are detectable and reversible, but could
 * not read how anybody voted, which is neither.
 *
 * An optional passkey that restored the separation was built and then removed.
 * Do not add it back without reading "The organizer's passkey, and why there is
 * not one" in `docs/dev/architecture.md`.
 */
import type { Signer } from "ethers";

/** Stable across every device and chain-bound through the domain separator. */
const DOMAIN = { name: "Votain", version: "1" } as const;

const TYPES = {
  TallyKey: [
    { name: "purpose", type: "string" },
    { name: "organizer", type: "address" },
  ],
} as const;

const PURPOSE = "Derive my organizer tally master secret";

const HKDF_INFO = new TextEncoder().encode("votain:organizer-tally-master:v1");

export class WalletSignatureRefusedError extends Error {
  constructor() {
    super("The wallet did not sign, so the tally key cannot be derived");
    this.name = "WalletSignatureRefusedError";
  }
}

/**
 * Signatures already gathered this session, by address.
 *
 * Asking for the same signature again returns the same bytes, so the only cost
 * of not caching is another wallet prompt for a value we already hold. Memory
 * only: nothing about this is worth writing to disk, since it can always be
 * asked for again.
 */
const sessionSignatures = new Map<string, string>();

/** Forgets cached signatures. Called when an organizer signs out. */
export function clearOrganizerKeyCache(): void {
  sessionSignatures.clear();
}

/** The deterministic signature this organizer's key derives from. */
async function tallySignature(signer: Signer): Promise<string> {
  const address = (await signer.getAddress()).toLowerCase();
  const cached = sessionSignatures.get(address);
  if (cached) return cached;

  const signature = await requestSignature(signer, address);
  sessionSignatures.set(address, signature);
  return signature;
}

/** Asks the wallet, every time. */
async function requestSignature(signer: Signer, address: string): Promise<string> {
  const network = await signer.provider?.getNetwork();
  const domain = { ...DOMAIN, chainId: Number(network?.chainId ?? 0) };

  try {
    return await signer.signTypedData(domain, TYPES as never, {
      purpose: PURPOSE,
      organizer: address,
    });
  } catch (e) {
    const err = e as { code?: number | string };
    if (err?.code === 4001 || err?.code === "ACTION_REJECTED") {
      throw new WalletSignatureRefusedError();
    }
    throw e;
  }
}

/** Where the answer to `signsDeterministically` is remembered, per address. */
const DETERMINISM_KEY_PREFIX = "votain_deterministic_signer:";

/**
 * Whether this wallet signs the same payload to the same bytes, checked once.
 *
 * THE ASSUMPTION ABOVE IS NOT UNIVERSAL. RFC 6979 is what MetaMask and most
 * software wallets do, but an MPC wallet, a smart-contract wallet answering
 * through ERC-1271, or a hardware signer with randomised nonces returns a
 * different signature every time. Deriving a tally key from one of those
 * works exactly once: the next derivation, on this device or another, yields a
 * different key and the election can never be decrypted.
 *
 * So the first time an address is used, it signs twice and the two are
 * compared. A wallet that fails gets a random key for each election instead,
 * kept on this device and offered for export, which is the path an organizer
 * without a derivable key already had. The answer is remembered, so the second
 * prompt happens once per wallet, not once per election.
 */
export async function signsDeterministically(signer: Signer): Promise<boolean> {
  const address = (await signer.getAddress()).toLowerCase();
  const key = DETERMINISM_KEY_PREFIX + address;
  try {
    const known = localStorage.getItem(key);
    if (known === "yes" || known === "no") return known === "yes";
  } catch {
    /* storage unavailable: ask the wallet */
  }

  const first = await tallySignature(signer);
  const second = await requestSignature(signer, address);
  const deterministic = first === second;
  try {
    localStorage.setItem(key, deterministic ? "yes" : "no");
  } catch {
    /* not remembered: asked again next time, which is safe */
  }
  if (!deterministic) sessionSignatures.delete(address);
  return deterministic;
}

/** HKDF over arbitrary key material, to 32 bytes. */
async function hkdf(material: Uint8Array): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey("raw", material as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: HKDF_INFO },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The master secret every election key of this organizer derives from.
 *
 * The wallet and nothing else. Mixing a passkey's PRF output in here was built
 * and then removed: see "The organizer's passkey, and why there is not one" in
 * `docs/dev/architecture.md` for what it bought, what it cost, and why the cost
 * was higher.
 */
export async function organizerMasterSecret(signer: Signer): Promise<Uint8Array> {
  return hkdf(hexToBytes(await tallySignature(signer)));
}
