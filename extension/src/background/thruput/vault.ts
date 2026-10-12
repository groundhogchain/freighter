import { Keypair } from "stellar-sdk";
import {
  signTransaction,
  serializeSignedTransaction,
  hashSignedTransaction,
  toHex0x,
} from "@groundhogchain/client";
import {
  CryptographicScheme,
  ed25519PublicKey,
  ed25519Signature,
  networkHash,
  sha256Hash,
  type Transaction,
} from "@groundhogchain/protocol";
import { WalletProviderError } from "@groundhogchain/client/provider";

import { buildStore } from "background/store";
import {
  allAccountsSelector,
  hashKeySelector,
  publicKeySelector,
} from "background/ducks/session";
import {
  browserLocalStorage,
  dataStorageAccess,
} from "background/helpers/dataStorageAccess";
import { getEncryptedTemporaryData } from "background/helpers/session";
import { getKeyIdList, HW_PREFIX } from "background/helpers/account";
import { thruputAccount } from "thruput/accounts";

const localStore = dataStorageAccess(browserLocalStorage);

export const getThruputVault = async () => {
  const store = await buildStore();
  const state = store.getState();
  const sessionKey = hashKeySelector(state)?.key || "";
  const accounts = sessionKey
    ? allAccountsSelector(state)
        .filter((account) => !account.hardwareWalletType)
        .map((account) => ({
          ...thruputAccount(account.publicKey, account.name),
          ...(account.importSource
            ? { importSource: account.importSource }
            : {}),
        }))
    : [];
  // This session marker stays in the background. Never include it in messages.
  return {
    sessionKey,
    accounts,
    activePublicKey: publicKeySelector(state),
  };
};

/** Only called after transaction policy and explicit user approval. */
export const signThruputTransaction = async (
  transaction: Transaction,
  accountAddress: string,
  chainHash: Uint8Array,
  expectedSession: string,
) => {
  const snapshot = await getThruputVault();
  const account = snapshot.accounts.find((a) => a.address === accountAddress);
  if (!expectedSession || snapshot.sessionKey !== expectedSession || !account) {
    throw new WalletProviderError(4100, "Wallet session changed");
  }
  const store = await buildStore();
  const keyIds = (await getKeyIdList({ localStore })) as string[];
  // Do not assume vault IDs and the filtered account list have matching indexes.
  for (const keyName of keyIds) {
    if (keyName.includes(HW_PREFIX)) continue;
    const secret = await getEncryptedTemporaryData({
      localStore,
      sessionStore: store,
      keyName,
    });
    if (!secret) continue;
    const key = Keypair.fromSecret(secret);
    if (key.publicKey() !== account.stellarPublicKey) continue;
    const signed = await signTransaction(
      transaction,
      [
        {
          publicKeyId: 0n,
          signer: {
            publicKey: {
              scheme: CryptographicScheme.Ed25519,
              ed25519: ed25519PublicKey(new Uint8Array(key.rawPublicKey())),
            },
            sign: async (message) => ({
              scheme: CryptographicScheme.Ed25519,
              ed25519: ed25519Signature(new Uint8Array(key.sign(message))),
            }),
          },
        },
      ],
      networkHash(sha256Hash(new Uint8Array(chainHash))),
    );
    const latest = await getThruputVault();
    if (
      latest.sessionKey !== expectedSession ||
      !latest.accounts.some((a) => a.address === accountAddress)
    ) {
      throw new WalletProviderError(4100, "Wallet session changed");
    }
    return {
      signedTransaction: toHex0x(serializeSignedTransaction(signed)),
      hash: toHex0x(hashSignedTransaction(signed)),
    };
  }
  throw new WalletProviderError(4100, "Software account is unavailable");
};
