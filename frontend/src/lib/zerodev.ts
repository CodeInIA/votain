/**
 * ZeroDev v5 smart-account layer for voters.
 *
 * Voters never hold an EOA: a passkey-secured Kernel account sends their
 * enroll/vote calls as ERC-4337 UserOperations with gas sponsored by the
 * ZeroDev paymaster (free tier on Amoy).
 *
 * Requires (ZeroDev dashboard, free tier):
 *   VITE_ZERODEV_RPC          bundler+paymaster RPC for the project
 *   VITE_ZERODEV_PASSKEY_URL  passkey server URL for the project
 */
import { createPublicClient, http, encodeFunctionData, parseAbi, type Chain } from "viem";
import { polygonAmoy } from "viem/chains";
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  type KernelAccountClient,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import {
  toPasskeyValidator,
  toWebAuthnKey,
  WebAuthnMode,
  PasskeyValidatorContractVersion,
} from "@zerodev/passkey-validator";

const ZERODEV_RPC = import.meta.env.VITE_ZERODEV_RPC as string | undefined;
const PASSKEY_SERVER_URL = import.meta.env.VITE_ZERODEV_PASSKEY_URL as string | undefined;

const CHAIN: Chain = polygonAmoy;
const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1;

export function isZeroDevConfigured(): boolean {
  return Boolean(ZERODEV_RPC && PASSKEY_SERVER_URL);
}

function requireConfig(): { rpc: string; passkeyUrl: string } {
  if (!ZERODEV_RPC || !PASSKEY_SERVER_URL) {
    throw new Error("ZeroDev not configured — set VITE_ZERODEV_RPC and VITE_ZERODEV_PASSKEY_URL");
  }
  return { rpc: ZERODEV_RPC, passkeyUrl: PASSKEY_SERVER_URL };
}

let cachedClient: KernelAccountClient | undefined;
let cachedAddress: `0x${string}` | undefined;

/**
 * Registers a new passkey (or logs into an existing one) and builds the
 * sponsored Kernel account client.
 */
export async function connectSmartAccount(
  passkeyName: string,
  mode: "register" | "login",
): Promise<{ address: `0x${string}` }> {
  const { rpc, passkeyUrl } = requireConfig();

  const publicClient = createPublicClient({ chain: CHAIN, transport: http(rpc) });

  const webAuthnKey = await toWebAuthnKey({
    passkeyName,
    passkeyServerUrl: passkeyUrl,
    mode: mode === "register" ? WebAuthnMode.Register : WebAuthnMode.Login,
    passkeyServerHeaders: {},
  });

  const passkeyValidator = await toPasskeyValidator(publicClient, {
    webAuthnKey,
    entryPoint,
    kernelVersion,
    // V0_0_2_UNPATCHED is the version supported by Kernel v3.1.
    validatorContractVersion: PasskeyValidatorContractVersion.V0_0_2_UNPATCHED,
  });

  const account = await createKernelAccount(publicClient, {
    plugins: { sudo: passkeyValidator },
    entryPoint,
    kernelVersion,
  });

  const paymasterClient = createZeroDevPaymasterClient({ chain: CHAIN, transport: http(rpc) });

  cachedClient = createKernelAccountClient({
    account,
    chain: CHAIN,
    bundlerTransport: http(rpc),
    client: publicClient,
    paymaster: {
      getPaymasterData: userOperation => paymasterClient.sponsorUserOperation({ userOperation }),
    },
  });
  cachedAddress = account.address;

  return { address: account.address };
}

export function getSmartAccountAddress(): `0x${string}` | undefined {
  return cachedAddress;
}

export function disconnectSmartAccount(): void {
  cachedClient = undefined;
  cachedAddress = undefined;
}

/**
 * Sends a single sponsored contract call as a UserOperation and waits for the
 * receipt. `humanReadableAbi` is an ethers-style fragment list.
 */
export async function sendSponsoredCall(params: {
  to: `0x${string}`;
  humanReadableAbi: readonly string[];
  functionName: string;
  args: unknown[];
}): Promise<{ userOpHash: string; txHash: string }> {
  if (!cachedClient?.account) {
    throw new Error("Smart account not connected — call connectSmartAccount first");
  }

  const data = encodeFunctionData({
    abi: parseAbi(params.humanReadableAbi as string[]),
    functionName: params.functionName,
    args: params.args,
  });

  const userOpHash = await cachedClient.sendUserOperation({
    callData: await cachedClient.account.encodeCalls([{ to: params.to, value: 0n, data }]),
  });

  const receipt = await cachedClient.waitForUserOperationReceipt({ hash: userOpHash });
  return { userOpHash, txHash: receipt.receipt.transactionHash };
}
