/**
 * React hook over the ZeroDev passkey smart-account flow.
 */
import { useCallback, useState } from "react";
import {
  connectSmartAccount,
  disconnectSmartAccount,
  getSmartAccountAddress,
  isZeroDevConfigured,
} from "../lib/zerodev";

interface PasskeysState {
  address: `0x${string}` | undefined;
  connecting: boolean;
  error: string | null;
  configured: boolean;
  register: (name: string) => Promise<`0x${string}` | undefined>;
  login: (name: string) => Promise<`0x${string}` | undefined>;
  disconnect: () => void;
}

export function usePasskeys(): PasskeysState {
  const [address, setAddress] = useState<`0x${string}` | undefined>(getSmartAccountAddress());
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (name: string, mode: "register" | "login") => {
    setConnecting(true);
    setError(null);
    try {
      const { address: addr } = await connectSmartAccount(name, mode);
      setAddress(addr);
      return addr;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setConnecting(false);
    }
  }, []);

  return {
    address,
    connecting,
    error,
    configured: isZeroDevConfigured(),
    register: useCallback((name: string) => connect(name, "register"), [connect]),
    login: useCallback((name: string) => connect(name, "login"), [connect]),
    disconnect: useCallback(() => {
      disconnectSmartAccount();
      setAddress(undefined);
    }, []),
  };
}
