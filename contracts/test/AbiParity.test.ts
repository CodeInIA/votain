/**
 * Every hand-written ABI fragment in the frontend, the backend and the auditor's
 * CLI must exist, exactly, in the compiled contracts.
 *
 * WHY THIS EXISTS. Those packages talk to the contracts through human-readable
 * fragments typed by hand, and nothing compiled them against the contracts. A
 * signature that drifted, a parameter added to `relayEnrollPrivate` and not to
 * the local relay's copy of it, compiled, linted and passed every unit test,
 * and failed only when a voter pressed the button. This reads each fragment out
 * of the source text and looks it up in the artifacts, so drift fails here.
 */
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

const { ethers } = await network.create();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Files that declare fragments, relative to the repository root. */
const SOURCES = [
  "frontend/src/lib/contracts.ts",
  "frontend/src/lib/relay.ts",
  "frontend/src/lib/organizerDomains.ts",
  "backend/src/chain/relayer.ts",
  "backend/src/chain/registrar.ts",
  "backend/src/chain/election.ts",
  "scripts-tally/tally-votes.ts",
];

const CONTRACTS = [
  "ElectionV4",
  "ElectionFactory",
  "ElectionPaymaster",
  "PlatformRegistry",
  "OrganizerDomains",
];

/** Every string literal that starts like a fragment, with `${PROOF}`-style constants expanded. */
function fragmentsIn(file: string): string[] {
  const text = readFileSync(join(ROOT, file), "utf-8");
  const constants = new Map<string, string>();
  for (const m of text.matchAll(/const (\w+) = "([^"]+)";/g)) constants.set(m[1], m[2]);
  const out: string[] = [];
  for (const m of text.matchAll(/["'`]((?:function|event|error) [^"'`]+)["'`]/g)) {
    out.push(m[1].replace(/\$\{(\w+)\}/g, (_, name: string) => constants.get(name) ?? `\${${name}}`));
  }
  return out;
}

describe("hand-written ABIs match the compiled contracts", () => {
  const compiled = new Map<string, InstanceType<typeof ethers.Interface>>();

  before(async () => {
    for (const name of CONTRACTS) {
      const artifact = await import(`../artifacts/contracts/${name}.sol/${name}.json`, { with: { type: "json" } });
      compiled.set(name, new ethers.Interface(artifact.default.abi));
    }
  });

  for (const file of SOURCES) {
    it(`every fragment in ${file}`, () => {
      const fragments = fragmentsIn(file);
      expect(fragments.length, `no fragments found in ${file}`).to.be.greaterThan(0);

      for (const text of fragments) {
        const wanted = ethers.Fragment.from(text);
        const sighash = wanted.format("sighash");
        const matches = [...compiled.values()].flatMap(iface =>
          iface.fragments.filter(f => f.type === wanted.type && f.format("sighash") === sighash),
        );
        expect(matches, `${file}: "${text}" matches nothing in ${CONTRACTS.join(", ")}`).to.not.be.empty;

        // A view function must also return what the caller decodes.
        if (wanted instanceof ethers.FunctionFragment) {
          const outputs = (f: InstanceType<typeof ethers.FunctionFragment>) =>
            f.outputs.map(o => o.format("sighash")).join(",");
          expect(
            matches.some(f => outputs(f as InstanceType<typeof ethers.FunctionFragment>) === outputs(wanted)),
            `${file}: "${text}" returns something else in the contract`,
          ).to.equal(true);
        }
        // An event must index the same parameters, or filtering by them finds nothing.
        if (wanted instanceof ethers.EventFragment) {
          const indexed = (f: InstanceType<typeof ethers.EventFragment>) => f.inputs.map(i => Boolean(i.indexed)).join(",");
          expect(
            matches.some(f => indexed(f as InstanceType<typeof ethers.EventFragment>) === indexed(wanted)),
            `${file}: "${text}" indexes different parameters in the contract`,
          ).to.equal(true);
        }
      }
    });
  }
});
