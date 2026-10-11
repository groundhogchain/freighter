import {
  parseWalletHex32,
  parseWalletNetworkHash,
  parseSignedTransactionHex,
} from "@groundhogchain/client/provider";
import {
  ThruputNetwork,
  THRUPUT_NETWORKS,
  type ThruputNetworkSelection,
  type ThruputToken,
} from "thruput/networks";
import {
  ThruputOutcome,
  type ThruputApproval,
  type ThruputOutgoing,
} from "thruput/types";

export const THRUPUT_STORAGE_KEY = "thruputWallet.v1";

export interface ThruputStorage extends ThruputNetworkSelection {
  version: 1;
  tokens: Record<string, ThruputToken[]>;
  approvals: ThruputApproval[];
  outgoing: ThruputOutgoing[];
  airdrops: Record<string, string>;
}

export const defaultThruputStorage = (): ThruputStorage => ({
  version: 1,
  network: ThruputNetwork.DEVNET,
  networkHash: THRUPUT_NETWORKS.devnet.networkHash,
  tokens: {},
  approvals: [],
  outgoing: [],
  airdrops: {},
});

/** Corrupt recovery data is preserved on disk and blocks mutation. */
export const parseThruputStorage = (input: unknown): ThruputStorage => {
  if (input === undefined) return defaultThruputStorage();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Thruput storage is damaged");
  }
  const data = input as ThruputStorage;
  if (
    data.version !== 1 ||
    !Object.values(ThruputNetwork).includes(data.network) ||
    !Array.isArray(data.approvals) ||
    !Array.isArray(data.outgoing) ||
    !data.tokens ||
    typeof data.tokens !== "object" ||
    Array.isArray(data.tokens) ||
    !data.airdrops ||
    typeof data.airdrops !== "object" ||
    Array.isArray(data.airdrops)
  ) {
    throw new Error("Unsupported or damaged Thruput storage");
  }
  parseWalletNetworkHash(data.networkHash);
  for (const [network, tokens] of Object.entries(data.tokens)) {
    parseWalletNetworkHash(network);
    if (!Array.isArray(tokens))
      throw new Error("Thruput token storage is damaged");
    for (const token of tokens) {
      parseWalletHex32(token.address);
      if (
        typeof token.symbol !== "string" ||
        token.symbol.length > 32 ||
        !Number.isInteger(token.decimals) ||
        token.decimals < 0 ||
        token.decimals > 38
      )
        throw new Error("Thruput token metadata is damaged");
    }
  }
  for (const item of data.outgoing) {
    parseWalletHex32(item.hash);
    parseWalletHex32(item.account);
    parseWalletNetworkHash(item.networkHash);
    if (
      !Object.values(ThruputNetwork).includes(item.network) ||
      !Object.values(ThruputOutcome).includes(item.outcome) ||
      !Number.isSafeInteger(item.createdAt) ||
      item.createdAt < 0 ||
      (item.diagnostic !== undefined && typeof item.diagnostic !== "string")
    )
      throw new Error("Thruput recovery data is damaged");
  }
  for (const approval of data.approvals) {
    parseWalletHex32(approval.hash);
    parseWalletHex32(approval.account);
    parseWalletNetworkHash(approval.networkHash);
    parseSignedTransactionHex(approval.signedTransaction);
    if (typeof approval.origin !== "string")
      throw new Error("Invalid approval origin");
  }
  for (const nonce of Object.values(data.airdrops)) {
    if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce)) {
      throw new Error("Thruput funding recovery data is damaged");
    }
  }
  return structuredClone(data);
};

export interface ThruputStorageBackend {
  read(): Promise<unknown>;
  write(value: ThruputStorage): Promise<void>;
}

/** One serialized copy-on-write stream; failed persistence never publishes state. */
export class ThruputStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly backend: ThruputStorageBackend) {}

  async read(): Promise<ThruputStorage> {
    await this.tail;
    return parseThruputStorage(await this.backend.read());
  }

  update(change: (next: ThruputStorage) => void): Promise<ThruputStorage> {
    const result = this.tail.then(async () => {
      const next = parseThruputStorage(await this.backend.read());
      change(next);
      parseThruputStorage(next);
      await this.backend.write(next);
      return structuredClone(next);
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}
