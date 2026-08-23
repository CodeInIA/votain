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

const BACKEND = import.meta.env.VITE_BACKEND_URL as string | undefined;

/// Hardhat's well-known dev accounts (PUBLIC test keys, worthless on any real
/// network). Used only on the local chain, which has no backend relayer.
export const LOCAL_CHAIN_ID = 31337;
const LOCAL_RELAY_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const LOCAL_REGISTRAR_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

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
      "function relayVote(address election, bytes voteCiphertext, uint256 nullifier, uint256 merkleRoot, uint256 merkleDepth, uint256[2] pA, uint256[2][2] pB, uint256[2] pC)",
    ],
    new Wallet(LOCAL_RELAY_KEY, provider),
  );
  const tx = await paymaster[functionName](...args);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
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
    new Wallet(LOCAL_REGISTRAR_KEY, provider),
  );
  if (await registry.verifiedMembers(commitment)) return;
  // No World ID here, so the commitment stands in as its own nullifier.
  await (await registry.registerMember(commitment, commitment)).wait();
}

// ────────────────────────────────────────────────
// Relayed operations
// ────────────────────────────────────────────────

export async function relayEnroll(
  election: string,
  identityCommitment: bigint,
): Promise<{ txHash: string }> {
  if (isLocalChain()) return localRelay("relayEnroll", [election, identityCommitment]);
  // Enrollment is a public act and the endpoint is session-gated, so the cookie
  // belongs here.
  return post(
    "/api/relay/enroll",
    { election, identityCommitment: identityCommitment.toString() },
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
