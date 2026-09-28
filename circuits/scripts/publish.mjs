/**
 * Publishes one deployment's proving files and records where they are.
 *
 *   npm run publish:circuits -- amoy
 *
 * The wasm and zkey files a voter's browser proves with are outputs of the
 * trusted setup, run on the deployer's machine with entropy nobody else may
 * see, and far too large for the repository. So neither CI nor the site build
 * can produce them: this script, run where the ceremony was, uploads them to a
 * 4EVERLAND bucket (S3-compatible) and writes the URL into the deployment
 * manifest, which the frontend already reads for the contract addresses.
 *
 * It REFUSES before uploading anything unless each verification key is the one
 * the deployed verifier holds (see `published.mjs`), and it downloads every
 * file back through the public URL afterwards, as a browser on the site would,
 * before it writes the manifest. A manifest that names the URL is therefore a
 * statement that the files there verify against this deployment.
 *
 * Idempotent: the folder is named after the ceremony, and a file already there
 * with the same hash is not sent again.
 *
 * Reads circuits/.env: FOUREVERLAND_BUCKET, FOUREVERLAND_ACCESS_KEY,
 * FOUREVERLAND_SECRET_KEY, and optionally CIRCUITS_BASE_URL (the bucket's
 * public address, default https://<bucket>.4everbucket.com).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  PUBLIC,
  ROOT,
  ceremonyFolder,
  checkAgainstChain,
  deploymentPaths,
  fetchPublished,
  fileNames,
  readDeployment,
  rpcFor,
  sha256,
} from "./published.mjs";

const network = process.argv[2] ?? "amoy";
if (network === "local" || network === "localhost") {
  console.log("The local chain reads frontend/public/circuits directly: nothing to publish.");
  process.exit(0);
}

const envFile = join(ROOT, "circuits", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const need = name => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set (circuits/.env, see .env.example).`);
  return value;
};

const CONTENT_TYPES = { wasm: "application/wasm", zkey: "application/octet-stream", json: "application/json" };

async function main() {
  // 1. The build this deployment was made from.
  const build = JSON.parse(readFileSync(join(ROOT, "circuits", "build", "manifest.json"), "utf8"));
  if (build.ceremony !== "custom") {
    throw new Error("These are the DEVELOPMENT ceremony's files: a public network must not serve them.");
  }
  const sizes = [...new Set(build.sizes.map(s => s.slots))];
  const names = fileNames(sizes);

  const local = {};
  for (const name of names) {
    const path = join(PUBLIC, name);
    if (!existsSync(path)) throw new Error(`Missing ${path}: run \`npm run build\` in circuits/.`);
    local[name] = { path, hash: sha256(readFileSync(path)) };
  }
  for (const size of build.sizes) {
    const name = `${size.kind}_s${size.slots}`;
    for (const ext of ["wasm", "zkey"]) {
      if (local[`${name}.${ext}`].hash !== size[ext]) {
        throw new Error(`${name}.${ext} in frontend/public/circuits is not the one circuits/build/manifest.json records.`);
      }
    }
  }

  // 2. The keys must be the deployed verifiers' own, or nothing is sent.
  const deployment = readDeployment(network);
  const vkeys = Object.fromEntries(
    names.filter(n => n.endsWith(".vkey.json")).map(n => [n.replace(".vkey.json", ""), JSON.parse(readFileSync(local[n].path, "utf8"))]),
  );
  const problems = await checkAgainstChain({ deployment, sizes, vkeys, rpcUrl: rpcFor(network) });
  if (problems.length) {
    throw new Error(`These files do not belong to the ${network} deployment:\n  ${problems.join("\n  ")}`);
  }
  console.log(`Verification keys match the ${network} verifiers.`);

  // 3. Upload, skipping what is already there.
  const bucket = need("FOUREVERLAND_BUCKET");
  const s3 = new S3Client({
    endpoint: "https://endpoint.4everland.co",
    region: "4everland",
    credentials: { accessKeyId: need("FOUREVERLAND_ACCESS_KEY"), secretAccessKey: need("FOUREVERLAND_SECRET_KEY") },
  });
  const hashes = Object.fromEntries(names.map(n => [n, local[n].hash]));
  const folder = ceremonyFolder(hashes);

  for (const name of names) {
    const Key = `${folder}/${name}`;
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key }));
      if (head.Metadata?.sha256 === local[name].hash) {
        console.log(`  ${name}: already there`);
        continue;
      }
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404) throw error;
    }
    const body = readFileSync(local[name].path);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key,
        Body: body,
        ContentType: CONTENT_TYPES[name.split(".").pop()],
        Metadata: { sha256: local[name].hash },
      }),
    );
    console.log(`  ${name}: uploaded (${(body.length / 1e6).toFixed(1)} MB)`);
  }

  // 4. Read everything back the way the site will, before recording it.
  const base = (process.env.CIRCUITS_BASE_URL?.trim() || `https://${bucket}.4everbucket.com`).replace(/\/$/, "");
  const url = `${base}/${folder}`;
  for (const name of names) {
    const bytes = await fetchPublished(`${url}/${name}`);
    if (sha256(bytes) !== local[name].hash) throw new Error(`${url}/${name} does not match the local file.`);
  }
  console.log(`All ${names.length} files readable from ${url}, cross-origin, and identical.`);

  // 5. Record it where the frontend looks.
  const circuits = { url, sizes: [...sizes].sort((a, b) => a - b), files: hashes };
  for (const path of deploymentPaths(network)) {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...manifest, circuits }, null, 2) + "\n");
    console.log(`Recorded in ${path}`);
  }
  console.log("Commit both manifests: the next site build proves with these files.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
