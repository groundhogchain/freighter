import { addressFromHex, fromHex0x, toHex0x } from "@groundhogchain/client";
import { groundhog_erc20_if } from "@groundhogchain/client/contracts";
import {
  WalletProviderError,
  parseWalletHex32,
} from "@groundhogchain/client/provider";
import type { ThruputToken } from "thruput/networks";
import {
  ThruputHistoryKind,
  type ThruputHistoryPage,
  type ThruputHistoryCursors,
} from "thruput/types";
import type { connectThruput } from "./network";

type Client = Awaited<ReturnType<typeof connectThruput>>;

const cursor = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== "string" ||
    value.length > 32770 ||
    !/^0x(?:[0-9a-f]{2})+$/.test(value)
  )
    throw new WalletProviderError(-32602, "Invalid history cursor");
  return value;
};

export const parseHistoryCursors = (value: unknown): ThruputHistoryCursors => {
  if (value === undefined) return { tokens: {} };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WalletProviderError(-32602, "Invalid history cursors");
  const raw = value as Record<string, unknown>;
  if (
    !raw.tokens ||
    typeof raw.tokens !== "object" ||
    Array.isArray(raw.tokens) ||
    Object.keys(raw.tokens).length > 65
  )
    throw new WalletProviderError(-32602, "Invalid token cursors");
  return {
    transactions: cursor(raw.transactions),
    tokens: Object.fromEntries(
      Object.entries(raw.tokens).map(([key, next]) => [
        parseWalletHex32(key),
        cursor(next),
      ]),
    ),
  };
};

export const loadThruputHistory = async (
  client: Client,
  owner: string,
  tokens: ThruputToken[],
  input: ThruputHistoryCursors,
): Promise<ThruputHistoryPage> => {
  const result: ThruputHistoryPage = {
    rows: [],
    cursors: {
      transactions: input.transactions,
      tokens: Object.fromEntries(
        tokens.map((token) => [token.address, input.tokens[token.address]]),
      ),
    },
    coverage: [],
    unavailable: [],
    hasMore: false,
  };
  const event = groundhog_erc20_if.v0_1.events.TransferEvent;
  await Promise.all([
    (async () => {
      if (input.transactions === null) return;
      try {
        const page = await client.getTransactionsByAddress({
          address: addressFromHex(owner),
          anchor: "end",
          order: "descending",
          limit: 20,
          ...(input.transactions
            ? { cursor: fromHex0x(input.transactions) }
            : {}),
        });
        if (
          input.transactions &&
          page.cursor.length &&
          toHex0x(page.cursor) === input.transactions
        )
          throw new Error("History cursor did not advance");
        result.rows.push(
          ...page.refs.map((record) => ({
            id: `tx:${toHex0x(record.txHash)}`,
            kind: ThruputHistoryKind.TRANSACTION,
            hash: toHex0x(record.txHash),
            height: record.height.toString(),
          })),
        );
        result.cursors.transactions = page.cursor.length
          ? toHex0x(page.cursor)
          : null;
        result.coverage.push({
          source: "account",
          oldestBlock: page.oldestBlock.toString(),
          latestBlock: page.latestBlock.toString(),
        });
      } catch {
        result.unavailable.push("account");
      }
    })(),
    ...tokens.map(async (token) => {
      const previous = input.tokens[token.address];
      if (previous === null) return;
      try {
        const page = await client.getContractEvents({
          event,
          contractAddresses: [addressFromHex(token.address)],
          topics: { to: addressFromHex(owner) },
          anchor: "end",
          order: "descending",
          limit: 20,
          ...(previous ? { cursor: fromHex0x(previous) } : {}),
        });
        if (previous && page.cursor.length && toHex0x(page.cursor) === previous)
          throw new Error("Event cursor did not advance");
        result.rows.push(
          ...page.events.map((entry) => ({
            id: `event:${token.address}:${toHex0x(entry.txHash)}:${entry.sequenceNumber}`,
            kind: ThruputHistoryKind.RECEIVED,
            hash: toHex0x(entry.txHash),
            height: entry.blockHeight.toString(),
            token,
            rawAmount: entry.fields.amount.toString(),
          })),
        );
        result.cursors.tokens[token.address] = page.cursor.length
          ? toHex0x(page.cursor)
          : null;
        result.coverage.push({
          source: token.address,
          oldestBlock: page.oldestBlock.toString(),
          latestBlock: page.latestBlock.toString(),
        });
      } catch {
        result.unavailable.push(token.address);
      }
    }),
  ]);
  result.hasMore =
    result.unavailable.length > 0 ||
    result.cursors.transactions !== null ||
    tokens.some((token) => result.cursors.tokens[token.address] !== null);
  return result;
};
