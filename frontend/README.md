# frontend/

React 19 + Vite + Tailwind 4. Voter and organizer dApp for Votain. Semaphore V4 identities derived from a 12-word recovery phrase, sealed on the device under a WebAuthn passkey's PRF secret. Target deployment: IPFS via Fleek with automatic CD from `main`.

```bash
npm install
npm test                # 537 tests
cp .env.example .env   # fill in VITE_WORLD_ID_APP_ID, VITE_BACKEND_URL, the contract addresses, ...
npm run dev            # http://localhost:5173
npm run build
```

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the full stack, routes, environment variables and known technical debt. See the [root README](../README.md) for project context.
