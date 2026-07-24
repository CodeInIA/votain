# Deployment manifests

Written automatically by `contracts/scripts/deploy.ts` (mirrored from
`contracts/deployments/<network>.json`). The chain client (`src/lib/deployments.ts`)
glob-imports every `*.json` here to resolve contract addresses.

`local.json` is gitignored; `amoy.json` is committed once the contracts are
deployed to Polygon Amoy.
