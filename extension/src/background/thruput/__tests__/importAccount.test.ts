import { deriveThruputImport } from "../importAccount";
import { thruputAccount } from "thruput/accounts";

// Match native ESM's default import of bip39's CommonJS exports in Babel/Jest.
// The real mnemonic validation, seed generation, and derivation still run.
jest.mock("bip39", () => {
  const actual = jest.requireActual("bip39");
  return { ...actual, default: actual };
});

jest.mock("background/helpers/dataStorageAccess", () => ({
  dataStorageAccess: jest.fn(),
  browserLocalStorage: {},
}));
jest.mock("background/store", () => ({ buildStore: jest.fn() }));
jest.mock("background/messageListener/handlers/importAccount", () => ({
  importAccount: jest.fn(),
}));

const phrase =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("explicit prototype recovery", () => {
  it("matches the existing prototype's independently generated public account vector", () => {
    const { key, importSource } = deriveThruputImport({
      kind: "thruput-prototype-v1",
      mnemonic: phrase,
      index: 0,
    });
    const account = thruputAccount(key.publicKey(), "Fixture");
    expect(account.publicKey).toBe(
      "0xa90eb13b090b4d4c31ae87d864c0cd8db25216c90c1ce6fbfd04ddcdc1aa110c",
    );
    expect(account.address).toBe(
      "0x78f75ea743648e5cba16f3d49314d7b17a7e96fa80d49811218713df036c63d6",
    );
    expect(importSource).toEqual({
      kind: "thruput-prototype-v1",
      derivationPath: "m/44'/1'/0'",
    });
  });

  it("rejects invalid phrases and indexes", () => {
    expect(() =>
      deriveThruputImport({
        kind: "thruput-prototype-v1",
        mnemonic: "invalid",
        index: 0,
      }),
    ).toThrow();
    for (const index of [-1, 0.5, 0x80000000, NaN])
      expect(() =>
        deriveThruputImport({
          kind: "thruput-prototype-v1",
          mnemonic: phrase,
          index,
        }),
      ).toThrow();
  });

  it("imports exactly 32 bytes and does not infer a derivation path for raw seeds", () => {
    const { key, importSource } = deriveThruputImport({
      kind: "thruput-seed-v1",
      seed: `0x${"01".repeat(32)}`,
    });
    expect(key.rawPublicKey()).toHaveLength(32);
    expect(importSource).toEqual({ kind: "thruput-seed-v1" });
    expect(() =>
      deriveThruputImport({ kind: "thruput-seed-v1", seed: "01" }),
    ).toThrow();
  });
});
