import { loadThruputHistory, parseHistoryCursors } from "../history";
import { HOG_TOKEN } from "thruput/networks";
import { mergeThruputHistory } from "thruput/history";
import { ThruputHistoryKind } from "thruput/types";
import { sha256Hash, blockHeight } from "@groundhogchain/protocol";

const owner = `0x${"11".repeat(32)}`;
const hash = sha256Hash(new Uint8Array(32).fill(1));
const fixture = () => ({
  getTransactionsByAddress: jest.fn(async () => ({
    refs: [],
    cursor: new Uint8Array([1]),
    oldestBlock: blockHeight(1n),
    latestBlock: blockHeight(20n),
  })),
  getContractEvents: jest.fn(async () => ({
    events: [
      {
        txHash: hash,
        blockHeight: blockHeight(5n),
        sequenceNumber: 1,
        fields: { amount: 10n },
      },
    ],
    cursor: new Uint8Array(),
    oldestBlock: blockHeight(1n),
    latestBlock: blockHeight(20n),
  })),
});
type Client = Parameters<typeof loadThruputHistory>[0];

describe("Thruput history pagination", () => {
  it("keeps empty pages with a continuation cursor and includes incoming events", async () => {
    const client = fixture();
    const page = await loadThruputHistory(
      client as unknown as Client,
      owner,
      [HOG_TOKEN],
      { tokens: {} },
    );
    expect(page.hasMore).toBe(true);
    expect(page.cursors.transactions).toBe("0x01");
    expect(page.cursors.tokens[HOG_TOKEN.address]).toBeNull();
    expect(page.rows[0]).toMatchObject({
      kind: ThruputHistoryKind.RECEIVED,
      rawAmount: "10",
      height: "5",
    });
  });

  it("does not restart exhausted walks and retains failed sources' cursors", async () => {
    const client = fixture();
    client.getContractEvents.mockRejectedValueOnce(
      new Error("Indexer unavailable"),
    );
    const page = await loadThruputHistory(
      client as unknown as Client,
      owner,
      [HOG_TOKEN],
      { transactions: null, tokens: { [HOG_TOKEN.address]: "0xaa" } },
    );
    expect(client.getTransactionsByAddress).not.toHaveBeenCalled();
    expect(page.cursors.tokens[HOG_TOKEN.address]).toBe("0xaa");
    expect(page.unavailable).toEqual([HOG_TOKEN.address]);
    expect(page.hasMore).toBe(true);
  });

  it("deduplicates page boundaries and orders heights without floating-point conversion", () => {
    const row = {
      id: "event:a",
      kind: ThruputHistoryKind.RECEIVED,
      hash: owner,
      height: "9007199254740992",
    };
    const newer = { ...row, id: "event:b", height: "9007199254740993" };
    expect(
      mergeThruputHistory([row], [row, newer]).map((item) => item.id),
    ).toEqual(["event:b", "event:a"]);
  });

  it("rejects malformed cursor state before RPC", () => {
    expect(() =>
      parseHistoryCursors({ transactions: "cursor", tokens: {} }),
    ).toThrow();
    expect(() =>
      parseHistoryCursors({ tokens: { "invalid-address": null } }),
    ).toThrow();
  });
});
