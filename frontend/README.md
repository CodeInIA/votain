# frontend/

React 19 + Vite + Tailwind 4 + ZeroDev v5 (Account Abstraction + Passkeys). Voter and organizer dApp for Votain. Target deployment: IPFS via Fleek with automatic CD from `main`.

```bash
npm install
cp .env.example .env   # fill in VITE_WORLD_ID_APP_ID, VITE_ZERODEV_PROJECT_ID, ...
npm run dev            # http://localhost:5173
npm run build
```

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the full stack, routes, environment variables and known technical debt. See the [root README](../README.md) for project context.
