# contracts/

Solidity 0.8.37 smart contracts for Votain: Semaphore V4, a gas tank and relay hub that reimburses whoever submits a voter's transaction, and a coercion-resistant `ElectionV4` with a per-nullifier nonce.

NOT ERC-4337. A per-voter smart account published the link between an enrolment and the ballot that followed it, and hosted paymasters cannot fund gas per organizer. `ElectionPaymaster` says so in its own header.

```bash
npm install
npx hardhat test       # 185 passing
npx hardhat compile
```

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the full stack, contract reference, environment variables and known technical debt. See the [root README](../README.md) for project context.
