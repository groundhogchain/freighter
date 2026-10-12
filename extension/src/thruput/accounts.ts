import { StrKey } from "stellar-sdk";
import { derivePubkeyAccountAddress, toHex0x } from "@groundhogchain/client";
import {
  CryptographicScheme,
  ed25519PublicKey,
} from "@groundhogchain/protocol";
import type { WalletAccount } from "@groundhogchain/client/provider";
import type { Account } from "@shared/api/types";

/** One signer can control distinct addresses on Stellar and Thruput. */
export interface ThruputAccount extends WalletAccount {
  stellarPublicKey: string;
  name: string;
  importSource?: Account["importSource"];
}

/** Provider objects use exact schemas; wallet-only metadata stays internal. */
export const toProviderAccount = ({
  address,
  publicKey,
  nonce,
}: WalletAccount): WalletAccount => ({ address, publicKey, nonce });

export const thruputAccount = (
  stellarPublicKey: string,
  name: string,
): ThruputAccount => {
  const key = ed25519PublicKey(
    new Uint8Array(StrKey.decodeEd25519PublicKey(stellarPublicKey)),
  );
  return {
    stellarPublicKey,
    name,
    publicKey: toHex0x(key),
    nonce: "0",
    address: toHex0x(
      derivePubkeyAccountAddress({
        pubkey: { scheme: CryptographicScheme.Ed25519, ed25519: key },
        nonce: 0n,
      }),
    ),
  };
};
