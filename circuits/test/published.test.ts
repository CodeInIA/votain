/**
 * The pure half of publishing: which files a deployment serves, the folder a
 * ceremony lands in, and the bytecode check that ties a key to its verifier.
 * The network half (upload, download, eth_getCode) is exercised by running
 * `publish:circuits` and by CI's `check:published`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bytecodeHolds, ceremonyFolder, fileNames, vkeyConstants } from "../scripts/published.mjs";

describe("fileNames", () => {
  test("lists every file of every size, smallest size first", () => {
    assert.deepEqual(fileNames([9, 5]), [
      "ballot_s5.wasm", "ballot_s5.zkey", "ballot_s5.vkey.json",
      "tally_s5.wasm", "tally_s5.zkey", "tally_s5.vkey.json",
      "ballot_s9.wasm", "ballot_s9.zkey", "ballot_s9.vkey.json",
      "tally_s9.wasm", "tally_s9.zkey", "tally_s9.vkey.json",
    ]);
  });
});

describe("ceremonyFolder", () => {
  const files = { "ballot_s5.zkey": "aa", "tally_s5.zkey": "bb", "ballot_s5.wasm": "cc" };

  test("is the same for the same ceremony, whatever the key order", () => {
    const reordered = { "ballot_s5.wasm": "cc", "tally_s5.zkey": "bb", "ballot_s5.zkey": "aa" };
    assert.equal(ceremonyFolder(files), ceremonyFolder(reordered));
  });

  test("changes when a zkey does, and ignores the wasm", () => {
    assert.notEqual(ceremonyFolder(files), ceremonyFolder({ ...files, "tally_s5.zkey": "bc" }));
    assert.equal(ceremonyFolder(files), ceremonyFolder({ ...files, "ballot_s5.wasm": "dd" }));
  });

  test("is a plain path segment", () => {
    assert.match(ceremonyFolder(files), /^ceremony-[0-9a-f]{16}$/);
  });
});

describe("bytecodeHolds", () => {
  const word = (hex: string) => hex.padStart(64, "0");

  test("finds a constant pushed as a full word", () => {
    const value = BigInt("0x" + "ab".repeat(32));
    assert.equal(bytecodeHolds("0x60" + "7f" + "ab".repeat(32) + "56", value.toString()), true);
  });

  test("finds one whose leading zero bytes solc dropped", () => {
    // Top byte zero: solc emits PUSH31 (0x7e) and the 31 remaining bytes.
    const hex = "00" + "cd".repeat(31);
    assert.equal(bytecodeHolds("0x" + "7e" + "cd".repeat(31), BigInt("0x" + hex).toString()), true);
  });

  test("does not mistake a longer push's tail for the constant", () => {
    const hex = "00" + "cd".repeat(31);
    // The same 31 bytes, but under a PUSH32 with another top byte: a different value.
    assert.equal(bytecodeHolds("0x" + "7f" + "ee" + "cd".repeat(31), BigInt("0x" + hex).toString()), false);
  });

  test("refuses a constant that is not there", () => {
    assert.equal(bytecodeHolds("0x" + word("1234"), "99"), false);
  });
});

describe("vkeyConstants", () => {
  test("takes delta's four coordinates and each IC point's two, dropping the projective 1", () => {
    const vkey = {
      vk_delta_2: [["1", "2"], ["3", "4"], ["1", "0"]],
      IC: [["5", "6", "1"], ["7", "8", "1"]],
    };
    assert.deepEqual(vkeyConstants(vkey), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  });
});
