/**
 * What `publish.mjs` and `check-published.mjs` share: which files a deployment
 * serves, where, and the one check that matters, that they are the files of
 * the ceremony whose verifiers are on chain.
 *
 * WHY THE CHAIN AND NOT A HASH LIST. A list of hashes written next to the URL
 * only proves the files did not change since somebody wrote the list down. The
 * question a voter's browser actually depends on is whether a proof made with
 * these files will be accepted, and only the deployed verifier answers that.
 * The verifier carries the verification key as constants in its bytecode, so
 * finding every one of them there ties the published key to that contract.
 *
 * No dependencies beyond Node, so CI can run the check without `npm ci`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PUBLIC = join(ROOT, "frontend", "public", "circuits");

/// Where the browser, and so this check, is served from.
export const SITE_ORIGIN = "https://votain.app";

/// Read-only, batch-friendly and free: see `frontend/src/lib/deployments.ts`.
const RPC = {
  amoy: "https://polygon-amoy-bor-rpc.publicnode.com",
};

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function deploymentPaths(network) {
  return [
    join(ROOT, "contracts", "deployments", `${network}.json`),
    join(ROOT, "frontend", "src", "lib", "deployments", `${network}.json`),
  ];
}

export function readDeployment(network) {
  return JSON.parse(readFileSync(deploymentPaths(network)[0], "utf8"));
}

export function rpcFor(network) {
  const url = process.env.RPC_URL || RPC[network];
  if (!url) throw new Error(`No RPC known for ${network}: set RPC_URL.`);
  return url;
}

/**
 * The files one ceremony serves, per circuit size. Order matters: the
 * deployment lists its verifiers in ascending size, and so does this.
 */
export function circuitNames(sizes) {
  return [...sizes]
    .sort((a, b) => a - b)
    .flatMap(slots => ["ballot", "tally"].map(kind => `${kind}_s${slots}`));
}

export function fileNames(sizes) {
  return circuitNames(sizes).flatMap(name => [`${name}.wasm`, `${name}.zkey`, `${name}.vkey.json`]);
}

/**
 * The folder one ceremony is published under, named after the ceremony itself.
 *
 * CONTENT-ADDRESSED ON PURPOSE. A later ceremony gets a new folder instead of
 * overwriting this one, so a browser still holding an older build never mixes
 * a wasm from one ceremony with a zkey from another, and publishing the same
 * ceremony twice lands on the same folder and uploads nothing.
 */
export function ceremonyFolder(files) {
  const zkeys = Object.entries(files)
    .filter(([name]) => name.endsWith(".zkey"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, hash]) => hash)
    .join("");
  return `ceremony-${sha256(zkeys).slice(0, 16)}`;
}

/**
 * Every verification-key constant that a Groth16 verifier hardcodes, as the
 * 32-byte words its bytecode must contain.
 *
 * alpha, beta and gamma are the same for every circuit of one phase 1; delta
 * is what a phase 2 contribution changes, and the IC points bind the key to
 * this circuit's public inputs. Checking delta and IC is what tells two
 * ceremonies of the same circuit apart.
 */
export function vkeyConstants(vkey) {
  return [...vkey.vk_delta_2.slice(0, 2).flat(), ...vkey.IC.flatMap(point => point.slice(0, 2))];
}

/**
 * Whether one constant appears in the bytecode.
 *
 * solc pushes a constant with its leading zero bytes dropped (PUSH31 for a
 * value whose top byte is zero, and so on), so a plain search for the padded
 * word misses about one constant in a hundred. Both forms are accepted.
 */
export function bytecodeHolds(bytecode, value) {
  const code = bytecode.toLowerCase().replace(/^0x/, "");
  const word = BigInt(value).toString(16).padStart(64, "0");
  if (code.includes(word)) return true;
  const trimmed = word.replace(/^(00)+/, "");
  const push = (0x5f + trimmed.length / 2).toString(16).padStart(2, "0");
  return code.includes(push + trimmed);
}

export async function getCode(rpcUrl, address) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
  });
  const body = await response.json();
  if (!body.result || body.result === "0x") throw new Error(`No code at ${address}`);
  return body.result;
}

/**
 * Checks each verification key against the verifier deployed for it.
 * Returns a list of problems, empty when every key matches its contract.
 */
export async function checkAgainstChain({ deployment, sizes, vkeys, rpcUrl }) {
  const sorted = [...sizes].sort((a, b) => a - b);
  const verifiers = { ballot: deployment.ballotVerifiers ?? [], tally: deployment.tallyVerifiers ?? [] };
  const problems = [];
  for (const kind of ["ballot", "tally"]) {
    if (verifiers[kind].length !== sorted.length) {
      problems.push(`${verifiers[kind].length} ${kind} verifiers deployed for ${sorted.length} sizes`);
      continue;
    }
    for (const [i, slots] of sorted.entries()) {
      const name = `${kind}_s${slots}`;
      const code = await getCode(rpcUrl, verifiers[kind][i]);
      const constants = vkeyConstants(vkeys[name]);
      const missing = constants.filter(value => !bytecodeHolds(code, value)).length;
      if (missing) problems.push(`${name}: ${missing}/${constants.length} key constants absent from ${verifiers[kind][i]}`);
    }
  }
  return problems;
}

/**
 * Downloads one published file the way the browser will: cross-origin, from
 * the site. Returns its bytes, or throws naming what is wrong.
 */
export async function fetchPublished(url) {
  const response = await fetch(url, { headers: { origin: SITE_ORIGIN } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const allowed = response.headers.get("access-control-allow-origin");
  if (allowed !== "*" && allowed !== SITE_ORIGIN) {
    throw new Error(`${url}: no CORS for ${SITE_ORIGIN} (got ${allowed ?? "none"}), so the browser could not read it`);
  }
  return Buffer.from(await response.arrayBuffer());
}
