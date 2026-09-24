/**
 * Votain off-chain tally, and the auditor's check of a published one.
 *
 * TALLY (the organizer, holding the key):
 *   1. Read every VoteCast event from an election.
 *   2. Coercion resistance: keep only the HIGHEST nonce per nullifier.
 *   3. Prove the tally with `tallyProof.ts`, the same code the browser runs:
 *      valid ballots are summed and the sum opened to the counters; invalid
 *      ones are excluded and each opened in public.
 *   4. Apply the privacy quorum (the contract's own), determine the outcome.
 *   5. Write an auditable JSON, optionally pin it to IPFS (Pinata) and publish
 *      the results with their proof via ElectionV4.publishResults.
 *
 * VERIFY (anyone, with no key):
 *   Reads the published counters and `TallyProofPublished`, and checks them
 *   against every VoteCast on chain. Exits non-zero if they do not match.
 *
 * Usage:
 *   npm run tally -- <electionAddress> [--publish] [--pin]
 *   npm run tally -- <electionAddress> --verify
 *
 * Env (.env):
 *   RPC_URL                  Amoy RPC
 *   PAILLIER_KEY_FILE        (tally) path to the JSON keypair exported by the organizer
 *   ORGANIZER_PRIVATE_KEY    (only with --publish) EOA that owns the election
 *   PINATA_JWT               (only with --pin) Pinata API JWT
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { PublicKey, PrivateKey } from "paillier-bigint";
import {
  decodeTallyProof,
  encodeTallyProof,
  finalBallots,
  proveTally,
  verifyTally,
  type FinalBallot,
} from "../frontend/src/lib/tallyProof.js";

/**
 * Fallback only. The base is fixed into every ballot at encryption time, so an
 * election is decoded in the base IT recorded (metadataJson.counterBase), and
 * this is what the ones created before that field existed used.
 */
const LEGACY_COUNTER_BASE = 1_000_000n;

/** Reads the base one election was encoded with. */
function counterBaseOf(metadataJson: string): bigint {
  try {
    const meta = JSON.parse(metadataJson) as { counterBase?: string };
    return meta.counterBase ? BigInt(meta.counterBase) : LEGACY_COUNTER_BASE;
  } catch {
    return LEGACY_COUNTER_BASE;
  }
}

const ELECTION_ABI = [
  "function numOptions() view returns (uint256)",
  "function votingType() view returns (uint8)",
  "function thresholdValue() view returns (uint256)",
  "function paillierPublicKey() view returns (string)",
  "function metadataJson() view returns (string)",
  "function name() view returns (string)",
  "function privacyQuorum() view returns (uint256)",
  "function resultsPublished() view returns (bool)",
  "function tally() view returns (uint256[])",
  "function publishResults(string ipfsCid, uint256[] tallyResults, uint256 invalidBallots, bytes tallyProof)",
  "event VoteCast(uint256 indexed nullifier, bytes voteCiphertext, uint256 nonce, uint256 timestamp)",
  "event TallyProofPublished(uint256 invalidBallots, bytes proof)",
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
 * Reads every event matching `filter` for an election.
 *
 * Starts from FROM_BLOCK when set (the deployment block, printed by
 * contracts/scripts/deploy.ts into deployments/amoy.json), otherwise from
 * genesis. Retries in fixed windows when the endpoint rejects the range, so the
 * audit works on any provider rather than only on the unlimited ones.
 */
async function queryAll(
  election: Contract,
  provider: JsonRpcProvider,
  filter: Parameters<Contract["queryFilter"]>[0],
): Promise<Awaited<ReturnType<Contract["queryFilter"]>>> {
  const from = Number(process.env.FROM_BLOCK ?? 0);

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

/** The surviving ballot of every voter, from every VoteCast on chain. */
async function readFinalBallots(
  election: Contract,
  provider: JsonRpcProvider,
): Promise<{ ballots: FinalBallot[]; cast: number }> {
  // An auditor must see every ballot or the tally is wrong, so a truncated log
  // range is never acceptable here.
  const events = await queryAll(election, provider, election.filters.VoteCast());
  const ballots = finalBallots(
    events.map(e => {
      const args = (e as unknown as { args: { nullifier: bigint; voteCiphertext: string; nonce: bigint } }).args;
      return { nullifier: args.nullifier, nonce: args.nonce, ciphertext: args.voteCiphertext };
    }),
  );
  return { ballots, cast: events.length };
}

/** `--verify`: checks a published result against the chain, with no key. */
async function verifyPublished(address: string, election: Contract, provider: JsonRpcProvider) {
  if (!(await election.resultsPublished())) {
    console.error("No results have been published for this election yet.");
    process.exit(2);
  }
  const [pkJson, metadataJson, published] = await Promise.all([
    election.paillierPublicKey() as Promise<string>,
    election.metadataJson() as Promise<string>,
    election.tally() as Promise<bigint[]>,
  ]);
  const proofs = await queryAll(election, provider, election.filters.TallyProofPublished());
  if (proofs.length === 0) {
    console.error("Published without a proof (a contract from before tally proofs): nothing to verify.");
    process.exit(3);
  }
  const args = (proofs[0] as unknown as { args: { invalidBallots: bigint; proof: string } }).args;
  const { ballots } = await readFinalBallots(election, provider);
  const { n, g } = JSON.parse(pkJson) as { n: string; g: string };

  const verdict = verifyTally({
    publicKey: { n: BigInt(n), g: BigInt(g) },
    ballots,
    counts: [...published],
    invalidBallots: args.invalidBallots,
    proof: decodeTallyProof(args.proof),
    base: counterBaseOf(metadataJson),
  });
  if (!verdict.ok) {
    console.error(`${address}: DOES NOT VERIFY: ${verdict.reason}`);
    process.exit(4);
  }
  console.log(
    `${address}: verified. ${verdict.validBallots} valid ballots add up to the published counts ` +
      `[${published.join(", ")}]; ${verdict.invalidBallots} excluded, each opened in the proof.`,
  );
}

async function main() {
  const address = process.argv[2];
  if (!address) {
    console.error("Usage: npm run tally -- <electionAddress> [--publish] [--pin]");
    process.exit(1);
  }
  const doPublish = process.argv.includes("--publish");
  const doPin = process.argv.includes("--pin");
  const doVerify = process.argv.includes("--verify");

  // Tenderly serves eth_getLogs over the full block range. drpc and publicnode
  // cap it at 10000 blocks; queryAllVoteCast() below falls back to windowed
  // queries so the audit still completes on those endpoints.
  const provider = new JsonRpcProvider(
    process.env.RPC_URL ?? "https://polygon-amoy.gateway.tenderly.co",
  );
  const election = new Contract(address, ELECTION_ABI, provider);
  if (doVerify) return verifyPublished(address, election, provider);

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

  // 1-2. All votes, and each voter's last one.
  const { ballots, cast } = await readFinalBallots(election, provider);
  console.log(`Found ${cast} VoteCast events, ${ballots.length} voters after coercion-resistance dedup`);

  const metadataJson: string = await election.metadataJson();

  // The contract's own privacy quorum, which is the one publishResults
  // enforces; the copy in the metadata is for display and could disagree.
  const privacyQuorum = Number(await election.privacyQuorum());
  if (ballots.length < privacyQuorum) {
    console.error(`Privacy quorum not met (${ballots.length} < ${privacyQuorum}). Election should be VOIDED.`);
    process.exit(2);
  }

  const { publicKey, privateKey } = restoreKeyPair(
    JSON.parse(readFileSync(process.env.PAILLIER_KEY_FILE ?? "paillier-key.json", "utf-8")) as SerializedKeyPair,
  );
  // The key file must match the on-chain public key, or every opening fails.
  if ("0x" + publicKey.n.toString(16) !== JSON.parse(pkJson).n) {
    throw new Error("the key file does not belong to this election's on-chain public key");
  }

  // 3. Prove.
  const proven = proveTally({
    publicKey: { n: publicKey.n, g: publicKey.g },
    lambda: privateKey.lambda,
    decrypt: c => privateKey.decrypt(c),
    ballots,
    slots: totalSlots,
    base: counterBaseOf(metadataJson),
  });
  const counts = proven.counts;
  const proofBytes = encodeTallyProof(proven.proof);
  if (proven.invalidBallots > 0) {
    console.log(`${proven.invalidBallots} ballot(s) excluded as invalid, each opened in the proof`);
  }

  // 5. Outcome
  const { outcome, winnerIndex } = determineOutcome(votingType, counts, numOptions, thresholdBn);

  // 6. Auditable JSON
  const audit = {
    election: { address, name, votingType: VOTING_TYPE[votingType], numOptions },
    computedAt: new Date().toISOString(),
    totalVotesCast: cast,
    uniqueVoters: ballots.length,
    invalidBallots: proven.invalidBallots,
    tally: counts.map(c => Number(c)),
    tallyProof: proofBytes,
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
      publishResults: (
        cid: string,
        tally: bigint[],
        invalidBallots: bigint,
        proof: string,
      ) => Promise<{ wait: () => Promise<{ hash: string }> }>;
    };
    const tx = await writer.publishResults(cid, counts, BigInt(proven.invalidBallots), proofBytes);
    const receipt = await tx.wait();
    console.log(`Results published on-chain: ${receipt.hash}`);
  }
}

await main();
