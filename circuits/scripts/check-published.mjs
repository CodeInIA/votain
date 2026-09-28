/**
 * Checks that a deployment's published proving files still work.
 *
 *   node scripts/check-published.mjs amoy
 *
 * Run by CI on every push. It downloads each file the manifest names, from the
 * site's origin as a browser would, compares it with the recorded hash, and
 * checks each verification key against the verifier deployed for it. What it
 * catches is the failure nobody would otherwise see until a voter tried: a
 * bucket deleted or emptied, CORS switched off, or a manifest pointing at
 * another ceremony's files. None of those shows up in a build.
 *
 * A manifest with no `circuits` entry is not an error here, only a warning:
 * the site then falls back to VITE_CIRCUITS_URL, which this cannot see.
 */
import { checkAgainstChain, fetchPublished, fileNames, readDeployment, rpcFor, sha256 } from "./published.mjs";

const network = process.argv[2] ?? "amoy";

async function main() {
  const deployment = readDeployment(network);
  const published = deployment.circuits;
  if (!published) {
    console.warn(`::warning::The ${network} manifest names no published circuits (run \`npm run publish:circuits -- ${network}\` in circuits/).`);
    return;
  }

  const problems = [];
  const vkeys = {};
  for (const name of fileNames(published.sizes)) {
    const expected = published.files[name];
    if (!expected) {
      problems.push(`${name}: not listed in the manifest`);
      continue;
    }
    try {
      const bytes = await fetchPublished(`${published.url}/${name}`);
      if (sha256(bytes) !== expected) problems.push(`${name}: changed since it was published`);
      else if (name.endsWith(".vkey.json")) vkeys[name.replace(".vkey.json", "")] = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (!problems.length) {
    problems.push(...(await checkAgainstChain({ deployment, sizes: published.sizes, vkeys, rpcUrl: rpcFor(network) })));
  }

  if (problems.length) {
    for (const problem of problems) console.error(`::error::${problem}`);
    console.error(`Voting on ${network} would fail: the browser proves with these files.`);
    process.exit(1);
  }
  console.log(`${network}: ${fileNames(published.sizes).length} files at ${published.url} are intact, readable from the site, and match the deployed verifiers.`);
}

main().catch(error => {
  console.error(`::error::${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
