import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";
import "dotenv/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    profiles: {
      default: {
        version: "0.8.36",
        settings: {
          evmVersion: "paris",
        },
      },
      production: {
        version: "0.8.36",
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
      url: process.env.AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    // Local node (`npx hardhat node`) — lets the whole dApp run against a real
    // chain without any funded key, using Hardhat's well-known dev accounts.
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
});
