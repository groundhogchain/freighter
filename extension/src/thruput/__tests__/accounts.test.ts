import { Keypair } from "stellar-sdk";
import {
  createPubkeyAccount,
  PrivateKeySigner,
  toHex0x,
} from "@groundhogchain/client";
import { parseWalletAccount } from "@groundhogchain/client/provider";
import { thruputAccount } from "../accounts";

describe("Thruput identity for Freighter software keys", () => {
  it("derives the protocol account from the existing signer without changing its Stellar address", () => {
    const seed = new Uint8Array(32).fill(7);
    const stellar = Keypair.fromRawEd25519Seed(Buffer.from(seed));
    const expected = createPubkeyAccount({
      signer: new PrivateKeySigner(seed),
      nonce: 0n,
    });
    const account = thruputAccount(stellar.publicKey(), "Account 1");
    expect(account.stellarPublicKey).toBe(stellar.publicKey());
    expect(account.address).toBe(toHex0x(expected.address));
    expect(account.publicKey).toBe(toHex0x(stellar.rawPublicKey()));
    expect(
      parseWalletAccount({
        address: account.address,
        publicKey: account.publicKey,
        nonce: account.nonce,
      }),
    ).toEqual({
      address: account.address,
      publicKey: account.publicKey,
      nonce: "0",
    });
  });

  it("rejects an invalid Stellar key rather than inventing an address", () => {
    expect(() => thruputAccount("not-a-key", "Account")).toThrow();
  });
});
