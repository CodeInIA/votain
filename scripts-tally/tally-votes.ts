/**
 * Votain off-chain tally, and the auditor's check of a published one.
 *
 * TALLY (the organizer, holding the keys):
 *   1. Read the election's aggregate: the sum the contract kept of every
 *      ballot, votes and cancellations, which encrypts each voter's LAST vote.
 *   2. Decrypt it with the tally keys to the counts, and prove the decryption
 *      with the tally circuit, the same one the browser runs.
 *   3. Apply the privacy quorum (the contract's own): above it, publish the
 *      counts; below it, prove only that and void the election.
 *   4. Write an auditable JSON, optionally pin it to IPFS (Pinata) and send the
 *      result with its proof to the election, which verifies it on chain.
 *
 * VERIFY (anyone, with no key):
 *   Re-adds every BallotCast on chain and checks the sum is the aggregate the
 *   result was proved against, then re-verifies the published proof against
 *   the tally circuit's verification key, independently of the chain's own
 *   verifier. Exits non-zero if either fails.
 *
 * Usage:
 *   npm run tally -- <electionAddress> [--publish] [--pin]
 *   npm run tally -- <electionAddress> --verify
 *
 * Env (.env):
 *   RPC_URL                  Amoy RPC
 *   TALLY_KEY_FILE           (tally) key file exported by the organizer from the election screen
 *   CIRCUITS_DIR             where tally_s<N>.{wasm,zkey,vkey.json} live (default: the frontend's copy)
 *   ORGANIZER_PRIVATE_KEY    (only with --publish) EOA that owns the election
 *   PINATA_JWT               (only with --pin) Pinata API JWT
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { poseidon3 } from "poseidon-lite";
import * as snarkjs from "snarkjs";

import {
  aggregate as addBallots,
  BASE,
  decryptTally,
  equals,
  keysHash,
  multiply,
  solidityProof,
  tallyCircuitInputs,
  unflattenPoints,
  type Ballot,
  type Point,
  type SolidityProof,
} from "../frontend/src/lib/ballotCrypto.js";

const CIRCUITS_DIR =
  process.env.CIRCUITS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "public", "circuits");

const PROOF = "(uint256[2] a, uint256[2][2] b, uint256[2] c)";
const ELECTION_ABI = [
  "function numOptions() view returns (uint256)",
  "function votingType() view returns (uint8)",
  "function thresholdValue() view returns (uint256)",
  "function name() view returns (string)",
  "function privacyQuorum() view returns (uint256)",
  "function resultsPublished() view returns (bool)",
  "function tally() view returns (uint256[])",
  "function voters() view returns (uint256)",
  "function voteCount() view returns (uint256)",
  "function circuitSlots() view returns (uint256)",
  "function tallyKeys() view returns (uint256[])",
  "function aggregate() view returns (uint256[2] a, uint256[] b)",
  `function publishResults(string ipfsCid, uint256[] tallyResults, ${PROOF} proof)`,
  `function voidBelowQuorum(uint256 votersBelow, ${PROOF} proof)`,
  "event BallotCast(uint256 indexed tag, uint256 index, uint256 leaf, uint256[2] voteA, uint256[] voteB, uint256[2] cancelA, uint256[] cancelB, uint256 timestamp)",
  "event ResultsPublished(string ipfsCid, uint256[] tally, uint8 outcome, uint256 winnerIndex)",
];

const VOTING_TYPE = ["SIMPLE_PLURALITY", "ABSOLUTE_MAJORITY", "SUPERMAJORITY_TWO_THIRDS", "WITNESS_THRESHOLD"];

/** Mirrors `ElectionV4._computeOutcome`, rule for rule. The contract's answer is the binding one. */
export function determineOutcome(
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
    // SUPERMAJORITY_TWO_THIRDS: two options are a motion, more are candidates
    // of whom the leader must still clear two thirds.
    if (totalCast === 0n) return { outcome: numOptions === 2 ? "REJECTED" : "THRESHOLD_NOT_MET" };
    if (numOptions === 2) return { outcome: counts[0] * 3n >= totalCast * 2n ? "APPROVED" : "REJECTED" };
    let lead = 0n;
    let leadIdx = 0;
    for (let i = 0; i < numOptions; i++) {
      if (counts[i] > lead) {
        lead = counts[i];
        leadIdx = i;
      }
    }
    return lead * 3n >= totalCast * 2n
      ? { outcome: "APPROVED", winnerIndex: leadIdx }
      : { outcome: "THRESHOLD_NOT_MET" };
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

/** What the election states about its tally: keys, sizes and the aggregate. */
async function readElection(election: Contract) {
  const [numOptions, slots, keys, aggregate, quorum, ballots] = await Promise.all([
    election.numOptions() as Promise<bigint>,
    election.circuitSlots() as Promise<bigint>,
    election.tallyKeys() as Promise<bigint[]>,
    election.aggregate() as Promise<[bigint[], bigint[]]>,
    election.privacyQuorum() as Promise<bigint>,
    election.voteCount() as Promise<bigint>,
  ]);
  return {
    numOptions: Number(numOptions),
    circuitSlots: Number(slots),
    keys: unflattenPoints(keys),
    total: { a: [aggregate[0][0], aggregate[0][1]] as Point, b: unflattenPoints(aggregate[1]) },
    quorum,
    ballots: Number(ballots),
  };
}

/** The tally circuit's public signals, in its order, as the contract builds them. */
function tallySignals(
  state: Awaited<ReturnType<typeof readElection>>,
  counts: readonly bigint[],
  voters: bigint,
  publish: boolean,
): string[] {
  const n = state.circuitSlots;
  const pad = (i: number): Point => state.total.b[i] ?? [0n, 1n];
  return [
    ...Array.from({ length: n }, (_, i) => counts[i] ?? 0n),
    voters,
    keysHash(poseidon3, state.keys, n),
    BigInt(state.keys.length),
    ...state.total.a,
    ...Array.from({ length: n }, (_, i) => pad(i)).flat(),
    state.quorum,
    publish ? 1n : 0n,
  ].map(String);
}

/** `--verify`: checks a published result against the chain, with no key. */
async function verifyPublished(address: string, election: Contract, provider: JsonRpcProvider) {
  if (!(await election.resultsPublished())) {
    console.error("No results have been published for this election yet.");
    process.exit(2);
  }
  const state = await readElection(election);
  const [published, voters] = await Promise.all([
    election.tally() as Promise<bigint[]>,
    election.voters() as Promise<bigint>,
  ]);

  // 1. The aggregate is the sum of the ballots everyone can see.
  const events = await queryAll(election, provider, election.filters.BallotCast());
  const ballots: Ballot[] = events.map(e => {
    const args = (e as unknown as { args: Record<string, bigint | bigint[]> }).args;
    const a = (key: string) => args[key] as bigint[];
    return {
      tag: args.tag as bigint,
      voteA: [a("voteA")[0], a("voteA")[1]],
      voteB: unflattenPoints(a("voteB")),
      cancelA: [a("cancelA")[0], a("cancelA")[1]],
      cancelB: unflattenPoints(a("cancelB")),
    };
  });
  const recomputed = addBallots(ballots, state.keys.length);
  const sums = equals(recomputed.a, state.total.a) && recomputed.b.every((p, i) => equals(p, state.total.b[i]));
  if (!sums) {
    console.error(`${address}: DOES NOT VERIFY: the ${ballots.length} ballots on chain do not add up to the aggregate`);
    process.exit(4);
  }

  // 2. The published proof, re-verified here against the circuit's own key.
  const [event] = await queryAll(election, provider, election.filters.ResultsPublished());
  const tx = await provider.getTransaction(event.transactionHash);
  const call = tx && election.interface.parseTransaction(tx);
  if (!call || call.name !== "publishResults") {
    console.error(`${address}: the result was not published by a direct publishResults call; checked the sums only.`);
    process.exit(3);
  }
  const proof = call.args.proof as SolidityProof;
  const vkey = JSON.parse(readFileSync(join(CIRCUITS_DIR, `tally_s${state.circuitSlots}.vkey.json`), "utf-8"));
  const snark = {
    pi_a: [proof.a[0], proof.a[1], 1n].map(String),
    pi_b: [[proof.b[0][1], proof.b[0][0]], [proof.b[1][1], proof.b[1][0]], [1n, 0n]].map(p => p.map(String)),
    pi_c: [proof.c[0], proof.c[1], 1n].map(String),
    protocol: "groth16",
    curve: "bn128",
  };
  if (!(await snarkjs.groth16.verify(vkey, tallySignals(state, [...published], voters, true), snark))) {
    console.error(`${address}: DOES NOT VERIFY: the published proof fails against the tally circuit's key`);
    process.exit(4);
  }
  console.log(
    `${address}: verified. The ${ballots.length} ballots on chain add up to the aggregate, and the ` +
      `published counts [${published.join(", ")}] are proved to be its decryption: ${voters} voter${voters === 1n ? "" : "s"}.`,
  );
}

/** Reads a key file exported from the election screen (`tallyKey.ts` writes it). */
function readKeyFile(path: string): { secrets: bigint[]; keys: Point[] } {
  const file = JSON.parse(readFileSync(path, "utf-8")) as { version?: number; secrets?: string[] };
  if (file.version !== 2 || !Array.isArray(file.secrets)) throw new Error(`${path} is not a Votain tally key file`);
  const secrets = file.secrets.map(s => BigInt(s));
  return { secrets, keys: secrets.map(x => multiply(BASE, x)) };
}

async function main() {
  const address = process.argv[2];
  if (!address) {
    console.error("Usage: npm run tally -- <electionAddress> [--publish] [--pin] | --verify");
    process.exit(1);
  }
  const doPublish = process.argv.includes("--publish");
  const doPin = process.argv.includes("--pin");
  const doVerify = process.argv.includes("--verify");

  // Tenderly serves eth_getLogs over the full block range. drpc and publicnode
  // cap it at 10000 blocks; queryAll() falls back to windowed queries so the
  // audit still completes on those endpoints.
  const provider = new JsonRpcProvider(process.env.RPC_URL ?? "https://polygon-amoy.gateway.tenderly.co");
  const election = new Contract(address, ELECTION_ABI, provider);
  if (doVerify) {
    await verifyPublished(address, election, provider);
    // snarkjs keeps its curve's worker threads alive, so without this the
    // process answers and then never returns to the shell.
    process.exit(0);
  }

  const [votingTypeBn, thresholdBn, name] = await Promise.all([
    election.votingType() as Promise<bigint>,
    election.thresholdValue() as Promise<bigint>,
    election.name() as Promise<string>,
  ]);
  const votingType = Number(votingTypeBn);
  const state = await readElection(election);

  // 1-2. Decrypt the aggregate with keys that must be this election's own.
  const keyFile = readKeyFile(process.env.TALLY_KEY_FILE ?? "tally-key.json");
  if (keyFile.keys.length !== state.keys.length || !keyFile.keys.every((k, i) => equals(k, state.keys[i]))) {
    throw new Error("the key file does not belong to this election's on-chain keys");
  }
  const counts = decryptTally(keyFile.secrets, state.total, state.ballots);
  const voters = counts.reduce((a, b) => a + b, 0n);
  const quorumMet = voters >= state.quorum;
  console.log(`${state.ballots} ballots cast by ${voters} voters`);

  // 3. Prove, in whichever mode the quorum allows.
  const inputs = tallyCircuitInputs({
    poseidon3,
    circuitSlots: state.circuitSlots,
    keys: state.keys,
    secrets: keyFile.secrets,
    counts,
    aggregate: state.total,
    quorum: state.quorum,
    publish: quorumMet,
  });
  const base = join(CIRCUITS_DIR, `tally_s${state.circuitSlots}`);
  const { proof: snark } = await snarkjs.groth16.fullProve(inputs, `${base}.wasm`, `${base}.zkey`);
  const proof = solidityProof(snark);

  const signer = () => {
    if (!process.env.ORGANIZER_PRIVATE_KEY) throw new Error("ORGANIZER_PRIVATE_KEY not set");
    return election.connect(new Wallet(process.env.ORGANIZER_PRIVATE_KEY, provider)) as Contract;
  };

  if (!quorumMet) {
    console.error(`Privacy quorum not met (${voters} < ${state.quorum}): the counts stay secret.`);
    if (doPublish) {
      const receipt = await (await signer().voidBelowQuorum(voters, proof)).wait();
      console.log(`Voided below the quorum, with the proof: ${receipt.hash}`);
    } else {
      console.error("Run with --publish to void it with the proof.");
    }
    process.exit(2);
  }

  const { outcome, winnerIndex } = determineOutcome(votingType, counts, state.numOptions, thresholdBn);

  // 4. Auditable JSON
  const audit = {
    election: { address, name, votingType: VOTING_TYPE[votingType], numOptions: state.numOptions },
    computedAt: new Date().toISOString(),
    ballotsCast: state.ballots,
    voters: Number(voters),
    tally: counts.map(c => Number(c)),
    proof: { a: proof.a.map(String), b: proof.b.map(p => p.map(String)), c: proof.c.map(String) },
    outcome,
    winnerIndex,
  };

  const outFile = `tally-${address.slice(0, 10)}.json`;
  writeFileSync(outFile, JSON.stringify(audit, null, 2) + "\n");
  console.log(`\nTally:`, audit.tally, `→ ${outcome}${winnerIndex !== undefined ? ` (option ${winnerIndex})` : ""}`);
  console.log(`Audit trail written to ${outFile}`);

  let cid = "";
  if (doPin) {
    cid = await pinToIpfs(audit);
    console.log(`Pinned to IPFS: ${cid}`);
  }

  if (doPublish) {
    const receipt = await (await signer().publishResults(cid, counts, proof)).wait();
    console.log(`Results published on-chain: ${receipt.hash}`);
  }
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
