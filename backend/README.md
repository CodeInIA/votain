# backend/

Node.js + Express SD-JWT issuer. Verifies World ID v4 proofs and issues short-lived Verifiable Credentials as `httpOnly` cookies. Target deployment: Phala Network TEE (Intel TDX).

```bash
npm install
cp .env.example .env   # fill in ISSUER_PRIVATE_KEY, WORLD_ID_APP_ID, ...
npm run dev            # http://localhost:3000
```

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the full stack, endpoint reference, environment variables and known technical debt. See the [root README](../README.md) for project context.
