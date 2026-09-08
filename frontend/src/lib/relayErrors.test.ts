import { describe, it, expect, beforeAll } from "vitest";
import { id } from "ethers";

import i18n, { bootstrapI18n, setLanguage } from "../i18n/config";
import { GasTankEmptyError, relayErrorMessage, revertNameOf } from "./relay";

/**
 * The bug these cover: every one of these failures reached the voter as
 * "transaction failed". The worst of them is the gas tank, because it is the
 * one failure the voter did not cause and cannot fix, and being told nothing
 * leaves them retrying a ballot that will never go through.
 */

// i18next is no longer initialised on import: the language is fetched as its
// own chunk, so the bootstrap has to run before any key resolves. English is
// then forced, because these assertions are on the English wording.
beforeAll(async () => {
  await bootstrapI18n();
  await setLanguage("en");
});

describe("relayErrorMessage", () => {
  it("explains an empty gas tank, and says whose problem it is", () => {
    const message = relayErrorMessage(new GasTankEmptyError());
    expect(message).toBe(i18n.t("errors.gas_tank_empty"));
    // The two things a voter needs: it is not their fault, and who can fix it.
    expect(message).toMatch(/organizer/i);
    expect(message).not.toMatch(/InsufficientBalance/i);
  });

  it("names the revert reasons the contract can throw", () => {
    const cases: Array<[string, string]> = [
      ["execution reverted (unknown custom error) EnrollmentNotOpen()", "errors.enrollment_closed"],
      ["AlreadyEnrolled()", "errors.already_enrolled"],
      ["PersonhoodNullifierUsed()", "errors.personhood_used"],
      ["NotPlatformVerified()", "errors.not_platform_verified"],
      ["AttestationRequired()", "errors.attestation_required"],
      ["AttestationExpired()", "errors.attestation_expired"],
    ];
    for (const [raw, key] of cases) {
      expect(relayErrorMessage(new Error(raw))).toBe(i18n.t(key));
    }
  });

  it("follows the active language", async () => {
    await setLanguage("es");
    expect(relayErrorMessage(new GasTankEmptyError())).toBe(i18n.t("errors.gas_tank_empty"));
    expect(relayErrorMessage(new GasTankEmptyError())).toMatch(/organizador/i);
    await setLanguage("en");
  });

  it("reads the real ethers error a drained tank produces", () => {
    // Captured from the local chain: the organizer's tank was emptied and an
    // enrollment relayed through the paymaster. Note what ethers hands back.
    // Gas estimation fails at the PROVIDER, which has no ABI, so the error
    // carries the selector and no name at all: `revert` is null and the message
    // says "unknown custom error". Matching on either of those, which is what
    // this code used to do, matches nothing, and that is why the voter was told
    // "transaction failed" and no more.
    const real = Object.assign(
      new Error(
        'execution reverted (unknown custom error) (action="estimateGas", ' +
          'data="0xf4d678b8", reason=null, invocation=null, revert=null, ' +
          "code=CALL_EXCEPTION, version=6.17.0)",
      ),
      { code: "CALL_EXCEPTION", action: "estimateGas", data: "0xf4d678b8", revert: null },
    );

    expect(revertNameOf(real)).toBe("InsufficientBalance");
    expect(relayErrorMessage(real)).toBe(i18n.t("errors.gas_tank_empty"));
  });

  it("prefers the name ethers decoded when it managed to decode one", () => {
    const decoded = Object.assign(new Error("execution reverted"), {
      revert: { name: "AlreadyEnrolled", args: [] },
      data: "0x6d6d97d9",
    });
    expect(revertNameOf(decoded)).toBe("AlreadyEnrolled");
    expect(relayErrorMessage(decoded)).toBe(i18n.t("errors.already_enrolled"));
  });

  it("recognises the failure after it has crossed the wire as text", () => {
    // On Amoy the relay runs on the server, so the browser never sees an error
    // OBJECT: it gets the composed message out of a JSON body. The selector is
    // still in there, and it is the only part that is.
    const fromBackend =
      'execution reverted (unknown custom error) (action="estimateGas", data="0xf4d678b8", ' +
      "reason=null, invocation=null, revert=null, code=CALL_EXCEPTION, version=6.17.0)";
    expect(revertNameOf(fromBackend)).toBe("InsufficientBalance");
    expect(relayErrorMessage(fromBackend)).toBe(i18n.t("errors.gas_tank_empty"));
  });

  it("hardcodes selectors that really are the hash of their error signature", () => {
    // The table is written by hand so that reading it costs no keccak in the
    // bundle. This is what stops a typo in it from quietly turning every one of
    // these back into an unexplained failure.
    const names = [
      "InsufficientBalance",
      "EnrollmentNotOpen",
      "AlreadyEnrolled",
      "NotPlatformVerified",
      "PersonhoodNullifierUsed",
      "MissingPersonhoodNullifier",
      "AttestationRequired",
      "UnexpectedAttestation",
      "AttestationExpired",
      "BadAttestation",
    ];
    for (const name of names) {
      expect(revertNameOf({ data: id(`${name}()`).slice(0, 10) })).toBe(name);
    }
  });

  it("passes an unrecognised failure through verbatim", () => {
    // Losing the detail would be worse than showing it: an unknown failure is
    // the one case where the raw text is the only clue anybody has.
    expect(relayErrorMessage(new Error("nonce too low"))).toBe("nonce too low");
    expect(relayErrorMessage("plain string")).toBe("plain string");
  });
});
