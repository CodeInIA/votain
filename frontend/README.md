# frontend/

React 19 + Vite + Tailwind 4. Voter and organizer dApp for Votain. Semaphore V4 identities derived from a 12-word recovery phrase, sealed on the device under a WebAuthn passkey's PRF secret. Ballots are encrypted and proved in the browser. Deployed on IPFS via 4EVERLAND at `votain.app`, with CD from `main`.

```bash
npm install
npm test                # 597 tests
npm run test:e2e -- --workers=1   # Playwright smoke, every screen on three devices
cp .env.example .env   # fill in VITE_BACKEND_URL, the contract addresses, ... (World ID lives in backend/.env)
npm run dev            # http://localhost:5173
npm run build
```

## How it is put together

Screens never talk to the chain or the issuer directly: they go through hooks,
and the hooks through `src/lib/`, where each concern has one module.

```mermaid
flowchart TB
  subgraph pages["src/pages"]
    public["public/<br/>Discover, results, verify receipt,<br/>how it works, terms, privacy"]
    election["ElectionPage<br/>one election, public and voter"]
    voterp["voter/<br/>sign in, identity, proof, confirmation,<br/>change vote, history"]
    orgp["organizer/<br/>create, manage, gas, members"]
  end

  hooks["src/hooks<br/>useElection, useVoteCost, useElectionFunding,<br/>useVoterIdentity, useScheduleWatch, ..."]

  subgraph lib["src/lib"]
    voting["voting.ts<br/>enrol, cast, receipts, history"]
    ballot["ballot.ts<br/>voter's chain, epoch, prove"]
    crypto["ballotCrypto.ts<br/>ElGamal on Baby Jubjub,<br/>circuit inputs, tally decryption"]
    tally["tally.ts + tallyKey.ts<br/>decrypt the aggregate, prove it"]
    identity["semaphore.ts, electionIdentity.ts,<br/>recoveryPhrase.ts, passkeyPrf.ts"]
    relay["relay.ts<br/>relayed calls, revert names"]
    chainread["contracts.ts, chainElections.ts, logs.ts"]
    backendlib["backend.ts, worldId.ts, eligibility.ts"]
  end

  snark["snarkjs<br/>Groth16 in the browser"]
  files[("public/circuits or VITE_CIRCUITS_URL<br/>ballot_s*, tally_s*")]
  api["Issuer backend<br/>/api"]
  rpc["Polygon RPC<br/>/rpc locally"]
  wallet["Organizer wallet<br/>WalletConnect / injected"]

  pages --> hooks --> lib
  voting --> ballot --> crypto
  voting --> identity
  voting --> relay
  tally --> crypto
  ballot --> snark
  tally --> snark
  snark -. "fetched once" .-> files
  relay --> api
  backendlib --> api
  chainread --> rpc
  ballot --> chainread
  orgp --> wallet
```

`ballotCrypto.ts` has no dependencies on purpose: the tally CLI, the contract
tests and the demo seed import the same file, so the browser, the auditor and
the tests encrypt, prove and decrypt with one implementation.

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the full stack, routes, environment variables and known technical debt. See the [root README](../README.md) for project context.
