import StellarHDWallet from "stellar-hd-wallet";
import { Keypair } from "stellar-sdk";
import {
  BrowserStorageKeyStore,
  KeyManager,
  ScryptEncrypter,
} from "@stellar/typescript-wallet-sdk-km";
import type { BrowserStorageConfigParams } from "@stellar/typescript-wallet-sdk-km/lib/Plugins/BrowserStorageFacade";
import type { Account } from "@shared/api/types";
import { SERVICE_TYPES } from "@shared/constants/services";
import {
  browserLocalStorage,
  dataStorageAccess,
} from "background/helpers/dataStorageAccess";
import { SessionTimer } from "background/helpers/session";
import { buildStore } from "background/store";
import { allAccountsSelector } from "background/ducks/session";
import { importAccount } from "background/messageListener/handlers/importAccount";
import { getThruputVault } from "./vault";

export type ThruputImport =
  | { kind: "thruput-prototype-v1"; mnemonic: string; index: number }
  | { kind: "thruput-seed-v1"; seed: string };

/** Explicit, versioned recovery; never reinterpret an ordinary Stellar restore. */
export const deriveThruputImport = (input: ThruputImport) => {
  let seed: Uint8Array;
  let importSource: NonNullable<Account["importSource"]>;
  if (input.kind === "thruput-prototype-v1") {
    if (
      !Number.isSafeInteger(input.index) ||
      input.index < 0 ||
      input.index >= 0x80000000
    )
      throw new Error("Invalid account index");
    const phrase = input.mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
    const path = `m/44'/1'/${input.index}'`;
    seed = StellarHDWallet.fromMnemonic(phrase).derive(path);
    importSource = { kind: input.kind, derivationPath: path };
  } else {
    const hex = input.seed.trim().replace(/^0x/, "");
    if (!/^[a-fA-F0-9]{64}$/.test(hex))
      throw new Error("Expected a 32-byte private-key seed");
    seed = Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));
    importSource = { kind: input.kind };
  }
  try {
    return { key: Keypair.fromRawEd25519Seed(Buffer.from(seed)), importSource };
  } finally {
    seed.fill(0);
  }
};

export const importThruputAccount = async (
  input: ThruputImport,
  password: string,
) => {
  const { key, importSource } = deriveThruputImport(input);
  const vault = await getThruputVault();
  if (!vault.sessionKey) throw new Error("Unlock the wallet first");
  const sessionStore = await buildStore();
  if (
    allAccountsSelector(sessionStore.getState()).some(
      (account) => account.publicKey === key.publicKey(),
    )
  )
    throw new Error("Account is already present");
  const keyStore = new BrowserStorageKeyStore();
  keyStore.configure({
    storage: browserLocalStorage as BrowserStorageConfigParams["storage"],
  });
  const keyManager = new KeyManager({ keyStore });
  keyManager.registerEncrypter(ScryptEncrypter);
  const localStore = dataStorageAccess(browserLocalStorage);
  const result = await importAccount({
    request: {
      type: SERVICE_TYPES.IMPORT_ACCOUNT,
      activePublicKey: vault.activePublicKey,
      password,
      privateKey: key.secret(),
    },
    sessionStore,
    localStore,
    keyManager,
    sessionTimer: new SessionTimer(localStore),
    importSource,
  });
  if (result.error) throw new Error(result.error);
  return { publicKey: key.publicKey() };
};
