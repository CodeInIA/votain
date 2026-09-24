/**
 * Compiles the ballot circuit per size, runs its trusted setup and writes the
 * Solidity verifier each size needs.
 *
 * SIZES. A ballot carries one ciphertext per option plus the blank vote, so the
 * circuit is compiled for a fixed number of SLOTS and an election uses the
 * smallest size that fits it (the unused slots are forced to zero). `build`
 * produces the sizes every development and test run needs; `build:all` adds
 * the larger ones, whose setup needs a bigger powers-of-tau file and takes far
 * longer.
 *
 * THE CEREMONY, stated plainly. Groth16 needs a trusted setup: whoever knows
 * the randomness used in it can forge proofs, which here means forging ballots.
 * With CEREMONY_ENTROPY unset this script uses a FIXED, PUBLIC entropy so every
 * machine builds byte-identical artefacts for development and CI. Those
 * artefacts are INSECURE by construction and must never back a real election.
 * A deployment sets CEREMONY_ENTROPY to a secret (better: runs a multi-party
 * contribution on top of a public powers-of-tau), publishes the resulting
 * verifiers with the deployment and discards the entropy.
 *
 * PHASE 1. Generated locally unless PTAU names a public powers-of-tau file of
 * at least 2^17 (the Hermez or PSE perpetual ceremonies publish them; download
 * one and point PTAU at it). A deployment should use one: phase 1 from a
 * ceremony with many contributors, phase 2 from its own. Locally the file is
 * generated once and cached in build/: a quarter of an hour at 2^17 on a laptop,
 * nearer forty minutes on a CI runner, which is why CI caches it on its own
 * (`--ptau 17`).
 *
 * CACHING. A size whose zkey is newer than its r1cs is not set up again, only
 * re-exported, so rerunning the script is cheap. `--force` redoes everything.
 *
 * Outputs:
 *   circuits/build/ballot_s<N>.{wasm,zkey,vkey.json}       the artefacts
 *   contracts/contracts/verifiers/BallotVerifierS<N>.sol  one verifier per size
 *   frontend/public/circuits/<kind>_s<N>.{wasm,zkey,vkey.json}  served to voters and auditors
 *   circuits/build/manifest.json                          sizes, hashes, entropy kind
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const VERIFIERS = join(ROOT, "..", "contracts", "contracts", "verifiers");
const PUBLIC = join(ROOT, "..", "frontend", "public", "circuits");

/** Slots per size: options plus the blank vote. The contract's ceiling is 50 options. */
const DEFAULT_SIZES = [5, 9];
const ALL_SIZES = [5, 9, 17, 33, 51];
const MAX_DEPTH = 20;

const DEV_ENTROPY = "votain-INSECURE-development-ceremony-do-not-use-in-production";
const entropy = process.env.CEREMONY_ENTROPY || DEV_ENTROPY;
const insecure = entropy === DEV_ENTROPY;

const sizes = process.argv.includes("--all") ? ALL_SIZES : DEFAULT_SIZES;
const FORCE = process.argv.includes("--force");
const logger = { debug() {}, info() {}, log() {}, warn: console.warn, error: console.error };

for (const dir of [BUILD, VERIFIERS, PUBLIC]) mkdirSync(dir, { recursive: true });
if (insecure) {
  console.warn("WARNING: CEREMONY_ENTROPY is not set. Building with the public development");
  console.warn("entropy: anyone can forge proofs against these verifiers. Never deploy them.");
}

const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex");

const CIRCUITS = {
  ballot: {
    source: "ballot.circom",
    main: slots =>
      `component main {public [votersRoot, ballotsRoot, scope, keysHash, slots, epoch, voteA, voteB, cancelA, cancelB]}` +
      ` = Ballot(${slots}, ${MAX_DEPTH});`,
    verifier: "BallotVerifier",
    iface: "IBallotVerifier",
    method: "verifyBallot",
  },
  tally: {
    source: "tally.circom",
    main: slots => `component main {public [keysHash, slots, aggA, aggB, quorum, publish]} = Tally(${slots});`,
    verifier: "TallyVerifier",
    iface: "ITallyVerifier",
    method: "verifyTally",
  },
};

function compile(kind, slots) {
  const circuit = CIRCUITS[kind];
  const name = `${kind}_s${slots}`;
  const main = join(BUILD, `${name}.circom`);
  writeFileSync(main, `pragma circom 2.1.5;\ninclude "../src/${circuit.source}";\n${circuit.main(slots)}\n`);
  const r1cs = join(BUILD, `${name}.r1cs`);
  if (!existsSync(r1cs) || FORCE) {
    console.log(`compiling ${name}`);
    execFileSync(
      join(ROOT, "node_modules", ".bin", "circom2"),
      [main, "--r1cs", "--wasm", "-l", join(ROOT, "node_modules"), "-l", join(ROOT, "node_modules", "circomlib", "circuits"), "-l", join(ROOT, "src"), "-o", BUILD],
      { stdio: "inherit" },
    );
  }
  return { name, r1cs, wasm: join(BUILD, `${name}_js`, `${name}.wasm`) };
}

/** A phase-1 file of 2^power: the public one in PTAU, or generated locally and cached. */
async function powersOfTau(power) {
  if (process.env.PTAU) return process.env.PTAU;
  const cachedFor = p => join(BUILD, `pot${p}_${insecure ? "dev" : "custom"}.ptau`);
  // Any cached file at least this large will do: a bigger phase 1 serves a
  // smaller circuit, and generating a second one would cost as long again.
  for (let p = power; p <= 28; p++) if (existsSync(cachedFor(p))) return cachedFor(p);
  const final = cachedFor(power);
  console.log(`powers of tau 2^${power} (slow)`);
  const p0 = join(BUILD, `pot${power}_0.ptau`);
  const p1 = join(BUILD, `pot${power}_1.ptau`);
  await snarkjs.powersOfTau.newAccumulator(await snarkjs.curves.getCurveFromName("bn128"), power, p0, logger);
  await snarkjs.powersOfTau.contribute(p0, p1, "votain", entropy, logger);
  await snarkjs.powersOfTau.preparePhase2(p1, final, logger);
  rmSync(p0);
  rmSync(p1);
  return final;
}

async function setup(kind, slots) {
  const circuit = CIRCUITS[kind];
  const { name, r1cs, wasm } = compile(kind, slots);
  const info = await snarkjs.r1cs.info(r1cs, logger);
  // Groth16 needs 2^power >= constraints + public signals + 1.
  const power = Math.max(12, Math.ceil(Math.log2(info.nConstraints + info.nPubInputs + info.nOutputs + 1)));
  const ptau = await powersOfTau(power);

  const zkey0 = join(BUILD, `${name}_0.zkey`);
  const zkey = join(BUILD, `${name}.zkey`);
  const cached = !FORCE && existsSync(zkey) && statSync(zkey).mtimeMs > statSync(r1cs).mtimeMs;
  if (cached) {
    console.log(`setup ${name}: cached`);
  } else {
    console.log(`setup ${name}: ${info.nConstraints} constraints, ${info.nPubInputs + info.nOutputs} public signals`);
    await snarkjs.zKey.newZKey(r1cs, ptau, zkey0, logger);
    await snarkjs.zKey.contribute(zkey0, zkey, "votain", entropy, logger);
    rmSync(zkey0);
  }
  const vkey = await snarkjs.zKey.exportVerificationKey(zkey, logger);
  writeFileSync(join(BUILD, `${name}.vkey.json`), JSON.stringify(vkey, null, 2));

  const templates = { groth16: readFileSync(join(ROOT, "node_modules", "snarkjs", "templates", "verifier_groth16.sol.ejs"), "utf8") };
  const generated = await snarkjs.zKey.exportSolidityVerifier(zkey, templates, logger);
  const publicCount = info.nPubInputs + info.nOutputs;
  writeFileSync(join(VERIFIERS, `${circuit.verifier}S${slots}.sol`), wrapVerifier(circuit, generated, slots, publicCount));

  copyFileSync(wasm, join(PUBLIC, `${name}.wasm`));
  copyFileSync(zkey, join(PUBLIC, `${name}.zkey`));
  // Small, and what an auditor checks a published proof against.
  copyFileSync(join(BUILD, `${name}.vkey.json`), join(PUBLIC, `${name}.vkey.json`));
  return { kind, slots, constraints: info.nConstraints, publicSignals: publicCount, wasm: sha256(wasm), zkey: sha256(zkey) };
}

/**
 * Renames the generated verifier and gives it the interface elections call.
 *
 * The generated `verifyProof` takes a FIXED-size array, whose length differs
 * per size, so an election could not call every size the same way. The wrapper
 * takes a dynamic array, checks its length and forwards it.
 */
function wrapVerifier(circuit, source, slots, publicCount) {
  const { verifier, iface, method } = circuit;
  const renamed = source
    .replace(/pragma solidity [^;]+;/, "pragma solidity ^0.8.37;")
    .replace("contract Groth16Verifier {", `import {${iface}} from "../${iface}.sol";\n\n/// @notice GENERATED by circuits/scripts/build.mjs for ${slots} slots. Do not edit.\ncontract ${verifier}S${slots} is ${iface} {`);
  const wrapper = `
    /// @inheritdoc ${iface}
    function slots() external pure returns (uint256) {
        return ${slots};
    }

    /// @inheritdoc ${iface}
    function ${method}(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[] calldata pub
    ) external view returns (bool) {
        if (pub.length != ${publicCount}) return false;
        uint[${publicCount}] memory fixedPub;
        for (uint i = 0; i < ${publicCount}; i++) fixedPub[i] = pub[i];
        return this.verifyProof(a, b, c, fixedPub);
    }
}
`;
  return renamed.replace(/\}\s*$/, wrapper);
}

// `--ptau <power>`: only the local phase 1 of that size, so CI can generate it
// in a step of its own and cache it apart from everything that depends on it.
const ptauFlag = process.argv.indexOf("--ptau");
if (ptauFlag !== -1) {
  console.log(await powersOfTau(Number(process.argv[ptauFlag + 1])));
  process.exit(0);
}

// `--compile`: only the witness calculators of the smallest size, which is all
// the witness tests need. Seconds rather than a trusted setup.
if (process.argv.includes("--compile")) {
  for (const kind of Object.keys(CIRCUITS)) compile(kind, DEFAULT_SIZES[0]);
  process.exit(0);
}

const built = [];
for (const slots of sizes) {
  built.push(await setup("ballot", slots));
  built.push(await setup("tally", slots));
}
writeFileSync(
  join(BUILD, "manifest.json"),
  JSON.stringify({ maxDepth: MAX_DEPTH, ceremony: insecure ? "INSECURE-development" : "custom", sizes: built }, null, 2) + "\n",
);
console.log("done:", built.map(b => `${b.kind}S${b.slots}=${b.constraints}`).join(", "));
process.exit(0);
