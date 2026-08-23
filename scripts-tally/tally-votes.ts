/**
 * Votain off-chain tally.
 *
 * Pipeline:
 *   1. Read every VoteCast event from an election.
 *   2. Coercion resistance: keep only the HIGHEST nonce per nullifier.
 *   3. Homomorphically sum the surviving Paillier ciphertexts.
 *   4. Decrypt the aggregate with the organizer's private key and unpack the
 *      per-option counters (base-B packing, blank vote = last option).
 *   5. Apply the privacy quorum, determine the outcome per voting type.
 *   6. Write an auditable JSON, optionally pin it to IPFS (Pinata) and publish
 *      the results on-chain via ElectionV4.publishResults.
 *
 * Usage:
 *   npm run tally -- <electionAddress> [--publish] [--pin]
 *
 * Env (.env):
 *   RPC_URL                  Amoy RPC
 *   PAILLIER_KEY_FILE        path to the JSON keypair exported by the organizer
 *   ORGANIZER_PRIVATE_KEY    (only with --publish) EOA that owns the election
 *   PINATA_JWT               (only with --pin) Pinata API JWT
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { PublicKey, PrivateKey } from "paillier-bigint";

const COUNTER_BASE = 1_000_000n;

const ELECTION_ABI = [
  "function numOptions() view returns (uint256)",
  "function votingType() view returns (uint8)",
  "function thresholdValue() view returns (uint256)",
  "function paillierPublicKey() view returns (string)",
  "function metadataJson() view returns (string)",
  "function name() view returns (string)",
  "function publishResults(string ipfsCid, uint256[] tallyResults)",
  "event VoteCast(uint256 indexed nullifier, bytes voteCiphertext, uint256 nonce, uint256 timestamp)",
];

interface SerializedKeyPair {
  publicKey: { n: string; g: string };
  privateKey: { lambda: string; mu: string };
}

const fromHex = (s: string): bigint => BigInt(s);

function restoreKeyPair(s: SerializedKeyPair): { publicKey: PublicKey; privateKey: PrivateKey } {
  const publicKey = new PublicKey(fromHex(s.publicKey.n), fromHex(s.publicKey.g));
  const privateKey = new PrivateKey(fromHex(s.privateKey.lambda), fromHex(s.privateKey.mu), publicKey);
  return { publicKey, privateKey };
}

const VOTING_TYPE = ["SIMPLE_PLURALITY", "ABSOLUTE_MAJORITY", "SUPERMAJORITY_TWO_THIRDS", "WITNESS_THRESHOLD"];

function determineOutcome(
  votingType: number,
  counts: bigint[],
  numOptions: number,
  threshold: bigint,
): { outcome: string; winnerIndex?: number } {
  const totalCast = counts.reduce((a, b) => a + b, 0n);

  if (votingType === 3) {
    // WITNESS_THRESHOLD: option 0 is "Yes"
    return { outcome: counts[0] >= threshold ? "APPROVED" : "REJECTED" };
  }
  if (votingType === 2) {
    // SUPERMAJORITY_TWO_THIRDS
    if (totalCast === 0n) return { outcome: "REJECTED" };
    return { outcome: counts[0] * 3n >= totalCast * 2n ? "APPROVED" : "REJECTED" };
  }

  // Plurality-style: leading candidate (blank excluded)
  let max = 0n;
  let maxIdx = 0;
  let tie = false;
  for (let i = 0; i < numOptions; i++) {
    if (counts[i] > max) {
      max = counts[i];
      maxIdx = i;
      tie = false;
    } else if (counts[i] === max && max > 0n) {
      tie = true;
    }
  }
  if (max === 0n) return { outcome: "TIE" };
  if (votingType === 1 && max * 2n <= totalCast) return { outcome: "THRESHOLD_NOT_MET" };
  return tie ? { outcome: "TIE" } : { outcome: "WINNER", winnerIndex: maxIdx };
}

async function pinToIpfs(json: object): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT not set");

  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ pinataContent: json }),
  });
  if (!res.ok) throw new Error(`Pinata error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { IpfsHash: string };
  return data.IpfsHash;
}

/// Range accepted by the strictest free Amoy endpoints (drpc, publicnode).
const MAX_LOG_RANGE = 10_000;

/**
 * Reads every VoteCast event for an election.
 *
 * Starts from FROM_BLOCK when set (the deployment block, printed by
 * contracts/scripts/deploy.ts into deployments/amoy.json), otherwise from
 * genesis. Retries in fixed windows when the endpoint rejects the range, so the
 * audit works on any provider rather than only on the unlimited ones.
 */
async function queryAllVoteCast(
  election: Contract,
  provider: JsonRpcProvider,
): Promise<Awaited<ReturnType<Contract["queryFilter"]>>> {
  const from = Number(process.env.FROM_BLOCK ?? 0);
  const filter = election.filters.VoteCast();

  try {
    return await election.queryFilter(filter, from);
  } catch (error: unknown) {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    const isRangeError =
      message.includes("block range") ||
      message.includes("ranges over") ||
      message.includes("range over") ||
      message.includes("more than 10000") ||
      message.includes("log response size");
    if (!isRangeError) throw error;

    console.warn("RPC rejected the full log range, falling back to windowed queries");
    const head = await provider.getBlockNumber();
    const out: Awaited<ReturnType<Contract["queryFilter"]>> = [];
    for (let start = from; start <= head; start += MAX_LOG_RANGE) {
      const end = Math.min(start + MAX_LOG_RANGE - 1, head);
      out.push(...(await election.queryFilter(filter, start, end)));
    }
    return out;
  }
}

async function main() {
  const address = process.argv[2];
  if (!address) {
    console.error("Usage: npm run tally -- <electionAddress> [--publish] [--pin]");
    process.exit(1);
  }
  const doPublish = process.argv.includes("--publish");
  const doPin = process.argv.includes("--pin");

  // Tenderly serves eth_getLogs over the full block range. drpc and publicnode
  // cap it at 10000 blocks; queryAllVoteCast() below falls back to windowed
  // queries so the audit still completes on those endpoints.
  const provider = new JsonRpcProvider(
    process.env.RPC_URL ?? "https://polygon-amoy.gateway.tenderly.co",
  );
  const election = new Contract(address, ELECTION_ABI, provider);

  const [numOptionsBn, votingTypeBn, thresholdBn, pkJson, name] = await Promise.all([
    election.numOptions(),
    election.votingType(),
    election.thresholdValue(),
    election.paillierPublicKey(),
    election.name(),
  ]);
  const numOptions = Number(numOptionsBn);
  const votingType = Number(votingTypeBn);
  const totalSlots = numOptions + 1; // + blank vote

  // 1. All votes. An auditor must see every ballot or the tally is wrong, so a
  //    truncated log range is never acceptable here.
  const events = await queryAllVoteCast(election, provider);
  console.log(`Found ${events.length} VoteCast events`);

  // 2. Coercion resistance: highest nonce per nullifier wins
  const latest = new Map<string, { ciphertext: string; nonce: bigint }>();
  for (const e of events) {
    const args = (e as unknown as { args: { nullifier: bigint; voteCiphertext: string; nonce: bigint } }).args;
    const key = args.nullifier.toString();
    const existing = latest.get(key);
    if (!existing || args.nonce > existing.nonce) {
      latest.set(key, { ciphertext: args.voteCiphertext, nonce: args.nonce });
    }
  }
  const finalVotes = [...latest.values()];
  console.log(`${finalVotes.length} unique voters after coercion-resistance dedup`);

  // Privacy quorum (metadata): never reveal a tally computed from too few voters
  let privacyQuorum = 0;
  try {
    const meta = JSON.parse(await election.metadataJson()) as { privacyQuorum?: number };
    privacyQuorum = meta.privacyQuorum ?? 0;
  } catch { /* no metadata */ }

  if (finalVotes.length < privacyQuorum) {
    console.error(`Privacy quorum not met (${finalVotes.length} < ${privacyQuorum}). Election should be VOIDED.`);
    process.exit(2);
  }

  // 3. Homomorphic sum
  const { publicKey, privateKey } = restoreKeyPair(
    JSON.parse(readFileSync(process.env.PAILLIER_KEY_FILE ?? "paillier-key.json", "utf-8")) as SerializedKeyPair,
  );
  // Sanity: the key file must match the on-chain public key
  if ("0x" + publicKey.n.toString(16) !== JSON.parse(pkJson).n) {
    console.warn("WARNING: key file public key does not match the on-chain Paillier public key");
  }

  let counts: bigint[];
  if (finalVotes.length === 0) {
    counts = new Array(totalSlots).fill(0n);
  } else {
    const aggregate = finalVotes.map(v => BigInt(v.ciphertext)).reduce((acc, c) => publicKey.addition(acc, c));
    // 4. Decrypt + unpack
    let remaining = privateKey.decrypt(aggregate);
    counts = [];
    for (let i = 0; i < totalSlots; i++) {
      counts.push(remaining % COUNTER_BASE);
      remaining /= COUNTER_BASE;
    }
    if (remaining !== 0n) throw new Error("tally overflow: a counter exceeded COUNTER_BASE");
  }

  // 5. Outcome
  const { outcome, winnerIndex } = determineOutcome(votingType, counts, numOptions, thresholdBn);

  // 6. Auditable JSON
  const audit = {
    election: { address, name, votingType: VOTING_TYPE[votingType], numOptions },
    computedAt: new Date().toISOString(),
    totalVotesCast: events.length,
    uniqueVoters: finalVotes.length,
    tally: counts.map(c => Number(c)),
    outcome,
    winnerIndex,
  };

  const outFile = `tally-${address.slice(0, 10)}.json`;
  writeFileSync(outFile, JSON.stringify(audit, null, 2) + "\n");
  console.log(`\nTally:`, audit.tally, `→ ${outcome}${winnerIndex !== undefined ? ` (option ${winnerIndex})` : ""}`);
  console.log(`Audit trail written to ${outFile}`);

  // Optional: pin to IPFS
  let cid = "";
  if (doPin) {
    cid = await pinToIpfs(audit);
    console.log(`Pinned to IPFS: ${cid}`);
  }

  // Optional: publish on-chain
  if (doPublish) {
    if (!process.env.ORGANIZER_PRIVATE_KEY) throw new Error("ORGANIZER_PRIVATE_KEY not set");
    const signer = new Wallet(process.env.ORGANIZER_PRIVATE_KEY, provider);
    const writer = election.connect(signer) as unknown as {
      publishResults: (cid: string, tally: bigint[]) => Promise<{ wait: () => Promise<{ hash: string }> }>;
    };
    const tx = await writer.publishResults(cid, counts);
    const receipt = await tx.wait();
    console.log(`Results published on-chain: ${receipt.hash}`);
  }
}

await main();
