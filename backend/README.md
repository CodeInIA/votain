# backend/

Node.js + Express SD-JWT issuer. Verifies World ID v4 proofs of personhood and
[Self](https://self.xyz) document proofs, and issues short-lived Verifiable Credentials as
`httpOnly` cookies. Target deployment: Phala Network TEE (Intel TDX).

Eligibility is provider agnostic: `eligibility/` speaks in policies and attestations, and
`eligibility/self.ts` is the only file that knows Self exists. Age is always asked as a
predicate, so what reaches this server is "over 18", never a date of birth. The document is
read from its own chip by the Self app on the voter's phone and never leaves the device.

```bash
npm install
cp .env.example .env   # fill in ISSUER_PRIVATE_KEY, WORLD_ID_APP_ID, ...
npm run dev            # http://localhost:3000
```

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the full stack, endpoint reference, environment variables and known technical debt. See the [root README](../README.md) for project context.
