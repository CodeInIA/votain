import { describe, it, expect } from "vitest";
import { wrapSecret, unwrapSecret } from "./identityVault";

const IDENTITY_SECRET = "cQoM+8Sxq3wJ1kZq0m2H6b0oHhF0hVYb0m3nQ2xJ8bE=";

function prf(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

describe("identity vault sealing", () => {
  it("round-trips the identity secret through one passkey's PRF", async () => {
    const blob = await wrapSecret(prf(1), IDENTITY_SECRET);
    expect(await unwrapSecret(prf(1), blob)).toBe(IDENTITY_SECRET);
  });

  // The whole multi-device design rests on this: the SAME secret sealed under
  // each passkey, so every device resolves to one identity and one ballot.
  it("lets several passkeys open the same identity", async () => {
    const phone = await wrapSecret(prf(1), IDENTITY_SECRET);
    const laptop = await wrapSecret(prf(2), IDENTITY_SECRET);

    expect(await unwrapSecret(prf(1), phone)).toBe(IDENTITY_SECRET);
    expect(await unwrapSecret(prf(2), laptop)).toBe(IDENTITY_SECRET);
  });

  it("does not open with the wrong passkey", async () => {
    const blob = await wrapSecret(prf(1), IDENTITY_SECRET);
    expect(await unwrapSecret(prf(9), blob)).toBeNull();
  });

  it("uses a fresh IV per wrap, so blobs never repeat", async () => {
    const a = await wrapSecret(prf(1), IDENTITY_SECRET);
    const b = await wrapSecret(prf(1), IDENTITY_SECRET);
    expect(a).not.toBe(b);
  });

  it("rejects a tampered blob rather than returning garbage", async () => {
    const blob = await wrapSecret(prf(1), IDENTITY_SECRET);
    const tampered = blob.slice(0, -2) + (blob.endsWith("A") ? "B" : "A");
    expect(await unwrapSecret(prf(1), tampered)).toBeNull();
  });
});
