import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";
import "dotenv/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    profiles: {
      // The optimizer runs here too, not just in `production`. ElectionFactory
      // embeds ElectionV4's creation code, and unoptimized it sits past the
      // 24576-byte Spurious Dragon limit, so an unoptimized build cannot deploy
      // the stack at all. Building tests the same way the deployment does also
      // keeps the suite from passing on bytecode nobody will ever run.
      default: {
        version: "0.8.37",
        settings: {
          evmVersion: "paris",
          optimizer: { enabled: true, runs: 200 },
        },
      },
      production: {
        version: "0.8.37",
        settings: {
          evmVersion: "paris",
          optimizer: { enabled: true, runs: 200 },
        },
      },
    },
  },
  networks: {
    amoy: {
      type: "http",
      // rpc-amoy.polygon.technology was the old default and no longer resolves.
      url: process.env.AMOY_RPC_URL ?? "https://polygon-amoy.drpc.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    // Local node (`npx hardhat node`): lets the whole dApp run against a real
    // chain without any funded key, using Hardhat's well-known dev accounts.
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
  // hardhat-verify ships with the toolbox. It talks to the Etherscan V2 unified
  // API, so a single etherscan.io key covers Polygon Amoy (chainid 80002) and
  // there is no separate PolygonScan key any more.
  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY ?? "",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
});
