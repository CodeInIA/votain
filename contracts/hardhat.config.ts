import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";
import "dotenv/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    profiles: {
      default: {
        version: "0.8.35",
        settings: {
          evmVersion: "paris",
        },
      },
      production: {
        version: "0.8.35",
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
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
});
