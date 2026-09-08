/**
 * Voter transaction relaying.
 *
 * A voter never sends their own transaction, and not only because they hold no
 * POL. If each voter had their own sending address, that address would appear
 * publicly on both their `enroll` and their `castVote`, letting anyone link
 * commitment to nullifier and, through PlatformRegistry, back to the human.
 * The Semaphore proof would be pointless: the transport layer would leak the
 * very thing it hides.
 *
 * So every voter operation goes to the issuer's relayer, which submits it
 * through ElectionPaymaster. On chain, all voters look like the same caller.
 *
 * The relayer cannot forge anything: `enroll` is gated on the registry and
 * `castVote` on a zero-knowledge proof, both checked by the contracts. Its only
 * power is to delay or withhold, and because relaying is permissionless on the
 * contract, a censored voter can always submit their own transaction.
 */
import { chainInfo, addresses } from "./deployments";
import i18n from "../i18n/config";

const BACKEND = import.meta.env.VITE_BACKEND_URL as string | undefined;

export const LOCAL_CHAIN_ID = 31337;

/**
 * Signers for the local chain, which has no backend relayer of its own.
 *
 * Hardhat's well-known dev accounts, public and worthless on any real
 * network, but they were written into the source and so travelled into every
 * production bundle. Nothing could be stolen with them; the problem is that a
 * shipped build of a voting application contained the string "private key" at
 * all, which is a question nobody should have to answer twice.
 *
 * `import.meta.env.DEV` is a compile-time constant, so in a production build
 * the fallback is dead code and the literals are dropped from the bundle
 * entirely. Pointing a production build at a local chain is still possible,
 * it just has to say so through the environment.
 */
const HARDHAT_ACCOUNT_1 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const HARDHAT_ACCOUNT_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const LOCAL_RELAY_KEY =
  (import.meta.env.VITE_LOCAL_RELAY_KEY as string | undefined) ??
  (import.meta.env.DEV ? HARDHAT_ACCOUNT_1 : undefined);
const LOCAL_REGISTRAR_KEY =
  (import.meta.env.VITE_LOCAL_REGISTRAR_KEY as string | undefined) ??
  (import.meta.env.DEV ? HARDHAT_ACCOUNT_0 : undefined);

/** Refuses clearly rather than letting ethers report an undefined key. */
function localSigner(key: string | undefined, which: string): string {
  if (!key) {
    throw new Error(
      `No local ${which} key: this build has none compiled in. Set ` +
        `VITE_LOCAL_${which.toUpperCase()}_KEY to use the local chain from a production build.`,
    );
  }
  return key;
}

export function isLocalChain(): boolean {
  return chainInfo.chainId === LOCAL_CHAIN_ID;
}

/**
 * @param credentials "include" sends the voter's session cookie; "omit" must be
 * used for the ballot. The `voter_vc` cookie's subject IS the voter's World ID
 * nullifier, so attaching it to a vote would put that nullifier in the same HTTP
 * request as the Semaphore nullifier and the ciphertext: handing any proxy,
 * access log or issuer operator the exact human-to-ballot link that relaying
 * through one contract exists to destroy on chain. The route never reads it,
 * but "the handler ignores it" is not the same as "it was never sent".
 */
async function post(
  path: string,
  body: unknown,
  credentials: RequestCredentials,
): Promise<{ txHash: string }> {
  if (!BACKEND) throw new Error("VITE_BACKEND_URL is not configured");

  const res = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    if (isTankEmpty(detail.error ?? "")) throw new GasTankEmptyError();
    throw new Error(detail.error ?? `Relay failed: ${res.status}`);
  }
  return (await res.json()) as Promise<{ txHash: string }>;
}

// ────────────────────────────────────────────────
// Local dev fallback
// ────────────────────────────────────────────────

/**
 * Local chain only: submits directly through the paymaster with a funded
 * Hardhat account, mirroring what the backend relayer does on Amoy.
 */
async function localRelay(functionName: string, args: unknown[]): Promise<{ txHash: string }> {
  const { Contract, JsonRpcProvider, Wallet } = await import("ethers");
  const provider = new JsonRpcProvider(chainInfo.rpcUrl, chainInfo.chainId, {
    staticNetwork: true,
  });
  const paymaster = new Contract(
    requirePaymaster(),
    [
      "function relayEnroll(address election, uint256 identityCommitment)",
      "function relayEnrollAttested(address election, uint256 identityCommitment, uint256 personhoodNullifier, uint256 deadline, bytes signature)",
      "function relayVote(address election, bytes voteCiphertext, uint256 nullifier, uint256 merkleRoot, uint256 merkleDepth, uint256[2] pA, uint256[2][2] pB, uint256[2] pC)",
      ...RELAY_ERROR_ABI,
    ],
    new Wallet(localSigner(LOCAL_RELAY_KEY, 'relay'), provider),
  );
  try {
    const tx = await paymaster[functionName](...args);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  } catch (error: unknown) {
    if (isTankEmpty(error)) throw new GasTankEmptyError();
    throw error;
  }
}

/**
 * Turns a drained gas tank into a sentence the voter can act on.
 *
 * The tank is per ORGANIZER and shared by all their elections, so it can empty
 * mid-vote and every voter across every one of their elections is blocked at
 * once. Left raw, that surfaces as an opaque `InsufficientBalance()` revert or
 * an ethers estimation failure, which reads like the voter did something wrong.
 */
export class GasTankEmptyError extends Error {
  constructor() {
    super(
      "The organizer's gas tank is empty, so votes cannot be submitted right now. " +
        "This is not a problem with your ballot: ask the organizer to top it up and try again.",
    );
    this.name = "GasTankEmptyError";
  }
}

/**
 * The custom errors a relayed call can revert with.
 *
 * These let ethers name a revert it decodes through the contract interface, so
 * `error.revert.name` is populated where it can be. They are NOT what fixes the
 * gas tank case, and it is worth being exact about why: a relayed enrollment
 * fails during GAS ESTIMATION, which happens at the provider, and the provider
 * has no ABI. Measured against the local chain, that error arrives with
 * `revert: null` and the message `execution reverted (unknown custom error)`
 * no matter what is declared here. The four-byte selector in `error.data` is
 * the only thing that survives, which is what `SELECTOR_NAMES` reads.
 */
const RELAY_ERROR_ABI = [
  "error InsufficientBalance()",
  "error EnrollmentNotOpen()",
  "error AlreadyEnrolled()",
  "error NotPlatformVerified()",
  "error PersonhoodNullifierUsed()",
  "error MissingPersonhoodNullifier()",
  "error AttestationRequired()",
  "error UnexpectedAttestation()",
  "error AttestationExpired()",
  "error BadAttestation()",
  "error UnknownElection()",
  "error VotingNotOpen()",
  "error UnknownOrExpiredRoot()",
  "error InvalidProof()",
  "error WrongPhase()",
];

/**
 * Selector to name, for the case where the fragments above did not get used:
 * a stale ABI, a revert bubbling through a contract this file does not model,
 * or an ethers version that words its message differently. `relayErrors.test.ts`
 * recomputes every one of these from its signature, so a wrong constant fails
 * the suite rather than silently going back to "transaction failed".
 */
const SELECTOR_NAMES: Record<string, string> = {
  "0xf4d678b8": "InsufficientBalance",
  "0x87ee6831": "EnrollmentNotOpen",
  "0x6d6d97d9": "AlreadyEnrolled",
  "0x0f488f5c": "NotPlatformVerified",
  "0xa837452e": "PersonhoodNullifierUsed",
  "0xf5a55ba8": "MissingPersonhoodNullifier",
  "0xe40b6d2e": "AttestationRequired",
  "0x7a651f34": "UnexpectedAttestation",
  "0x716dcc39": "AttestationExpired",
  "0x342bd384": "BadAttestation",
};

/** What the chain actually refused with, by whichever route the error kept it. */
export function revertNameOf(error: unknown): string | null {
  const decoded = (error as { revert?: { name?: string } } | null)?.revert?.name;
  if (typeof decoded === "string" && decoded) return decoded;

  const data = (error as { data?: unknown } | null)?.data;
  if (typeof data === "string" && data.length >= 10) {
    const name = SELECTOR_NAMES[data.slice(0, 10).toLowerCase()];
    if (name) return name;
  }

  // Last resort, the text. This is the case that matters on Amoy: the relay
  // runs on the server, and what crosses the wire is the composed message, not
  // the error object. That message still carries the selector inside it, as
  // `data="0x..."`, so both the name and the selector are worth looking for.
  const message = error instanceof Error ? error.message : String(error);
  const named = Object.values(SELECTOR_NAMES).find(name => message.includes(name));
  if (named) return named;

  const lower = message.toLowerCase();
  const bySelector = Object.keys(SELECTOR_NAMES).find(selector => lower.includes(selector));
  return bySelector ? SELECTOR_NAMES[bySelector] : null;
}

function isTankEmpty(error: unknown): boolean {
  if (revertNameOf(error) === "InsufficientBalance") return true;
  // Not a custom error at all: the relayer account itself is out of funds, or a
  // node phrased it in prose.
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes("insufficientbalance") || message.includes("insufficient balance");
}

/** One sentence per revert a voter can actually run into. */
const ERROR_MESSAGE_KEY: Record<string, string> = {
  EnrollmentNotOpen: "errors.enrollment_closed",
  AlreadyEnrolled: "errors.already_enrolled",
  PersonhoodNullifierUsed: "errors.personhood_used",
  NotPlatformVerified: "errors.not_platform_verified",
  AttestationRequired: "errors.attestation_required",
  AttestationExpired: "errors.attestation_expired",
};

/**
 * A relay failure written for the person looking at it.
 *
 * Every one of these was reaching the UI as a generic "transaction failed",
 * because the pages caught the error, logged it, and set a boolean. A voter
 * turned away by an empty gas tank has done nothing wrong and can do nothing
 * about it except tell the organizer, and that is precisely the sentence they
 * were not being shown.
 *
 * Falls back to the raw message rather than to a generic one: an unrecognised
 * failure is more useful reported verbatim than flattened into "something went
 * wrong".
 */
export function relayErrorMessage(error: unknown): string {
  if (error instanceof GasTankEmptyError) return i18n.t("errors.gas_tank_empty");
  if (isTankEmpty(error)) return i18n.t("errors.gas_tank_empty");

  const key = ERROR_MESSAGE_KEY[revertNameOf(error) ?? ""];
  if (key) return i18n.t(key);

  return error instanceof Error ? error.message : String(error);
}


function requirePaymaster(): string {
  if (!addresses.paymaster) throw new Error("ElectionPaymaster address not configured");
  return addresses.paymaster;
}

/**
 * Local dev only: registers the voter in PlatformRegistry so `enroll` passes
 * its `NotPlatformVerified` check. On Amoy the issuer does this after a real
 * World ID verification. Idempotent.
 */
export async function ensureLocalRegistration(commitment: bigint): Promise<void> {
  if (!isLocalChain() || !addresses.platformRegistry) return;

  const { Contract, JsonRpcProvider, Wallet } = await import("ethers");
  const provider = new JsonRpcProvider(chainInfo.rpcUrl, chainInfo.chainId, {
    staticNetwork: true,
  });
  const registry = new Contract(
    addresses.platformRegistry,
    [
      "function verifiedMembers(uint256 identityCommitment) view returns (bool)",
      "function registerMember(uint256 nullifier, uint256 identityCommitment)",
    ],
    new Wallet(localSigner(LOCAL_REGISTRAR_KEY, 'registrar'), provider),
  );
  if (await registry.verifiedMembers(commitment)) return;
  // No World ID here, so the commitment stands in as its own nullifier.
  await (await registry.registerMember(commitment, commitment)).wait();
}

// ────────────────────────────────────────────────
// Relayed operations
// ────────────────────────────────────────────────

/**
 * Attestation from the eligibility attester, required only by elections that
 * declare an attribute policy. `ElectionV4` exposes a separate entry point for
 * them, so passing this is what decides which one gets called.
 */
export interface EnrollAttestationInput {
  /**
   * The document nullifier for this election, decimal. The contract records it
   * and refuses a second enrollment carrying the same one, which is what stops
   * a voter with two World ID accounts from joining twice.
   */
  personhoodNullifier: string;
  deadline: number;
  signature: string;
}

export async function relayEnroll(
  election: string,
  identityCommitment: bigint,
  attestation?: EnrollAttestationInput,
): Promise<{ txHash: string }> {
  if (isLocalChain()) {
    return attestation
      ? localRelay("relayEnrollAttested", [
          election,
          identityCommitment,
          BigInt(attestation.personhoodNullifier),
          BigInt(attestation.deadline),
          attestation.signature,
        ])
      : localRelay("relayEnroll", [election, identityCommitment]);
  }
  // Enrollment is a public act and the endpoint is session-gated, so the cookie
  // belongs here.
  return post(
    "/api/relay/enroll",
    {
      election,
      identityCommitment: identityCommitment.toString(),
      ...(attestation ?? {}),
    },
    "include",
  );
}

export interface RelayVoteParams {
  election: string;
  voteCiphertext: string;
  nullifier: bigint;
  merkleRoot: bigint;
  merkleDepth: bigint;
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
}

export async function relayVote(p: RelayVoteParams): Promise<{ txHash: string }> {
  if (isLocalChain()) {
    return localRelay("relayVote", [
      p.election,
      p.voteCiphertext,
      p.nullifier,
      p.merkleRoot,
      p.merkleDepth,
      p.pA,
      p.pB,
      p.pC,
    ]);
  }

  // "omit", not "include": see post(). The ZK proof authorises the ballot, so no
  // cookie is needed, and sending one would defeat the anonymity this path exists
  // to provide.
  return post(
    "/api/relay/vote",
    {
      election: p.election,
      voteCiphertext: p.voteCiphertext,
      nullifier: p.nullifier.toString(),
      merkleRoot: p.merkleRoot.toString(),
      merkleDepth: p.merkleDepth.toString(),
      pA: p.pA.map(String),
      pB: p.pB.map(pair => pair.map(String)),
      pC: p.pC.map(String),
    },
    "omit",
  );
}
