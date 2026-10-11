import { randomUUID } from "node:crypto";
import { waitFor } from "@testing-library/dom";
import { Keypair } from "stellar-sdk";
import {
  createPubkeyAccount,
  createTransaction,
  defaultWalletAdapter,
  PrivateKeySigner,
  serializeSignedTransaction,
  serializeTransaction,
  signTransaction,
  hashSignedTransaction,
  toHex0x,
} from "@groundhogchain/client";
import { ERC20 } from "@groundhogchain/client/contracts";
import {
  blockHeight,
  gasAmount,
  networkHash,
  sha256Hash,
} from "@groundhogchain/protocol";
import {
  EXTERNAL_SERVICE_TYPES,
  SERVICE_TYPES,
} from "@shared/constants/services";
import { thruputAccount } from "thruput/accounts";
import { ThruputUiAction } from "thruput/types";
import {
  THRUPUT_STORAGE_KEY,
  defaultThruputStorage,
  type ThruputStorage,
} from "../storage";
import type { ThruputSender } from "../policy";

const seed = new Uint8Array(32).fill(8);
const signingAccount = createPubkeyAccount({
  signer: new PrivateKeySigner(seed),
});
const account = thruputAccount(
  Keypair.fromRawEd25519Seed(Buffer.from(seed)).publicKey(),
  "Fixture",
);
const pageSender = {
  id: "fixture",
  url: "https://app.example/",
  origin: "https://app.example",
  documentId: "document-1",
  frameId: 0,
  tab: { id: 1 },
} as ThruputSender;
const uiSender = {
  id: "fixture",
  url: "chrome-extension://fixture/index.html#/thruput",
  tab: { id: 99 },
} as ThruputSender;

let disk: ThruputStorage;
let handle: typeof import("../service").handleThruputMessage;
let browser: typeof import("webextension-polyfill");
let signer: jest.Mock;
let send: jest.Mock;
let failedWrite: (next: ThruputStorage) => boolean;

const call = (
  action: ThruputUiAction,
  fields: Record<string, unknown> = {},
  sender = uiSender,
) => handle({ type: SERVICE_TYPES.THRUPUT_UI, action, ...fields }, sender);
const request = (value: unknown, id = randomUUID()) => ({
  id,
  response: handle(
    { type: EXTERNAL_SERVICE_TYPES.THRUPUT_PROVIDER, request: value, id },
    pageSender,
  ),
});
const approvalId = async () => {
  await waitFor(() => expect(browser.windows.create).toHaveBeenCalled());
  const url = (browser.windows.create as jest.Mock).mock.calls.at(-1)[0]
    .url as string;
  return new URLSearchParams(url.split("?")[1]).get("approval")!;
};

beforeEach(() => {
  jest.resetModules();
  disk = defaultThruputStorage();
  failedWrite = () => false;
  Object.defineProperty(crypto, "randomUUID", {
    value: randomUUID,
    configurable: true,
  });
  jest.doMock("webextension-polyfill", () => ({
    runtime: {
      id: "fixture",
      getURL: (path: string) => `chrome-extension://fixture/${path}`,
    },
    storage: {
      local: {
        get: jest.fn(async () => ({
          [THRUPUT_STORAGE_KEY]: structuredClone(disk),
        })),
        set: jest.fn(async (next: Record<string, ThruputStorage>) => {
          if (failedWrite(next[THRUPUT_STORAGE_KEY]))
            throw new Error("Storage unavailable");
          disk = structuredClone(next[THRUPUT_STORAGE_KEY]);
        }),
        setAccessLevel: jest.fn(),
      },
      session: { setAccessLevel: jest.fn() },
    },
    tabs: { sendMessage: jest.fn(async () => null), query: jest.fn() },
    windows: {
      create: jest.fn(async () => ({ id: 9, tabs: [{ id: 99 }] })),
      remove: jest.fn(async () => {}),
    },
    webNavigation: {
      getFrame: jest.fn(async () => ({
        documentId: "document-1",
        url: "https://app.example/",
      })),
    },
  }));
  signer = jest.fn(async (transaction, _address, bytes) => {
    const signed = await signTransaction(
      transaction,
      signingAccount.signers,
      networkHash(sha256Hash(bytes)),
    );
    return {
      signedTransaction: toHex0x(serializeSignedTransaction(signed)),
      hash: toHex0x(hashSignedTransaction(signed)),
    };
  });
  jest.doMock("../vault", () => ({
    getThruputVault: jest.fn(async () => ({
      sessionKey: "session-1",
      accounts: [account],
      activePublicKey: account.stellarPublicKey,
    })),
    signThruputTransaction: signer,
  }));
  send = jest.fn(async (signed) => hashSignedTransaction(signed));
  jest.doMock("../network", () => ({
    connectThruput: jest.fn(async () => ({
      getChainTip: async () => ({ height: 1n }),
      sendTransaction: send,
    })),
    simulateThruput: jest.fn(),
  }));
  browser = require("webextension-polyfill");
  handle = require("../service").handleThruputMessage;
});

const connect = async () => {
  const pending = request({ method: "connect" });
  const id = await approvalId();
  expect(
    await call(ThruputUiAction.DECIDE, {
      id,
      accepted: true,
      accounts: [account.address],
    }),
  ).toEqual({ result: null });
  expect(await pending.response).toMatchObject({
    result: { accounts: [{ address: account.address }] },
  });
  (browser.windows.create as jest.Mock).mockClear();
};

const unsignedTransaction = () =>
  toHex0x(
    serializeTransaction(
      createTransaction({
        invocation: defaultWalletAdapter.createRootInvocation(
          signingAccount.address,
          {
            gasLimit: gasAmount(1000000n),
            invocation: ERC20.v0_1.transfer.invocation(
              signingAccount.address,
              gasAmount(500000n),
              { receiver: signingAccount.address, amount: 1n },
            ),
          },
        ),
        uniquifier: { nonce: 1n, block_expiry_height: blockHeight(100n) },
        auth_claim: signingAccount.authClaim,
        contracts_to_deploy: [],
      }),
    ),
  );

const sign = async () => {
  const pending = request({
    method: "signTransaction",
    params: {
      account: account.address,
      networkHash: disk.networkHash,
      transaction: unsignedTransaction(),
    },
  });
  const id = await approvalId();
  const decision = await call(ThruputUiAction.DECIDE, {
    id,
    accepted: true,
    accounts: [],
  });
  expect(decision).toEqual({ result: null });
  return (
    (await pending.response) as {
      result: { signedTransaction: string; hash: string };
    }
  ).result;
};

describe("Thruput provider boundaries", () => {
  it("keeps a connection request through unlock without granting access early", async () => {
    const vault = jest.requireMock<typeof import("../vault")>("../vault");
    (vault.getThruputVault as jest.Mock).mockResolvedValue({
      sessionKey: "",
      accounts: [],
      activePublicKey: account.stellarPublicKey,
    });
    const pending = request({ method: "connect" });
    const id = await approvalId();
    expect(await request({ method: "getSession" }).response).toMatchObject({
      result: { accounts: [] },
    });
    (vault.getThruputVault as jest.Mock).mockResolvedValue({
      sessionKey: "new-session",
      accounts: [account],
      activePublicKey: account.stellarPublicKey,
    });
    await call(ThruputUiAction.STATE);
    expect(
      await call(ThruputUiAction.DECIDE, {
        id,
        accepted: true,
        accounts: [account.address],
      }),
    ).toEqual({ result: null });
    expect(await pending.response).toMatchObject({
      result: { accounts: [{ address: account.address }] },
    });
  });

  it("loses grants and retired signatures across a worker restart but retains outgoing evidence", async () => {
    await connect();
    const signed = await sign();
    const submit = {
      method: "submitTransaction",
      params: {
        account: account.address,
        networkHash: disk.networkHash,
        signedTransaction: signed.signedTransaction,
      },
    };
    await request(submit).response;
    jest.resetModules();
    handle = require("../service").handleThruputMessage;
    expect(await request({ method: "getSession" }).response).toMatchObject({
      result: { accounts: [] },
    });
    expect(disk.outgoing[0].hash).toBe(signed.hash);
    expect(await request(submit).response).toMatchObject({
      error: { code: 4100 },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects page access to trusted UI and rejects subframes", async () => {
    expect(await call(ThruputUiAction.STATE, {}, pageSender)).toMatchObject({
      error: { code: 4100 },
    });
    expect(
      await handle(
        {
          type: EXTERNAL_SERVICE_TYPES.THRUPUT_PROVIDER,
          id: randomUUID(),
          request: { method: "getSession" },
        },
        { ...pageSender, frameId: 1 },
      ),
    ).toMatchObject({ error: { code: 4100 } });
    expect(send).not.toHaveBeenCalled();
  });

  it("requires the exact approval window and cancels only the requesting document", async () => {
    const pending = request({ method: "connect" });
    const id = await approvalId();
    expect(
      await call(
        ThruputUiAction.DECIDE,
        { id, accepted: true, accounts: [account.address] },
        { ...uiSender, tab: { id: 100 } } as ThruputSender,
      ),
    ).toMatchObject({ error: { code: 4100 } });
    await handle(
      { type: EXTERNAL_SERVICE_TYPES.THRUPUT_CANCEL, id: pending.id },
      pageSender,
    );
    expect(await pending.response).toMatchObject({ error: { code: 4001 } });
    expect(await request({ method: "getSession" }).response).toMatchObject({
      result: { accounts: [] },
    });
  });

  it("consumes an approval once under concurrent submissions and persists recovery first", async () => {
    await connect();
    const signed = await sign();
    send.mockImplementation(async (tx) => {
      expect(disk.approvals).toHaveLength(0);
      expect(disk.outgoing).toHaveLength(1);
      expect(disk.outgoing[0].hash).toBe(signed.hash);
      return hashSignedTransaction(tx);
    });
    const submit = {
      method: "submitTransaction",
      params: {
        account: account.address,
        networkHash: disk.networkHash,
        signedTransaction: signed.signedTransaction,
      },
    };
    const responses = await Promise.all([
      request(submit).response,
      request(submit).response,
    ]);
    expect(responses.filter((response) => "result" in response)).toHaveLength(
      1,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(disk.outgoing[0].outcome).toBe("submitted");
  });

  it("does not broadcast when approval consumption cannot be saved", async () => {
    await connect();
    const signed = await sign();
    failedWrite = (next) => next.outgoing.length > 0;
    const response = await request({
      method: "submitTransaction",
      params: {
        account: account.address,
        networkHash: disk.networkHash,
        signedTransaction: signed.signedTransaction,
      },
    }).response;
    expect(response).toMatchObject({ error: { code: -32603 } });
    expect(send).not.toHaveBeenCalled();
    expect(disk.approvals).toHaveLength(1);
    expect(disk.outgoing).toHaveLength(0);
  });

  it("retains uncertainty after a lost submit response and never broadcasts twice", async () => {
    await connect();
    const signed = await sign();
    send.mockRejectedValueOnce(new Error("Connection lost"));
    const submit = {
      method: "submitTransaction",
      params: {
        account: account.address,
        networkHash: disk.networkHash,
        signedTransaction: signed.signedTransaction,
      },
    };
    expect(await request(submit).response).toMatchObject({
      error: { code: 4900 },
    });
    expect(disk.outgoing[0].outcome).toBe("unknown");
    expect(await request(submit).response).toMatchObject({
      error: { code: 4100 },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("disconnect retires signatures but preserves transaction recovery", async () => {
    await connect();
    const signed = await sign();
    await request({ method: "disconnect" }).response;
    expect(
      await request({
        method: "submitTransaction",
        params: {
          account: account.address,
          networkHash: disk.networkHash,
          signedTransaction: signed.signedTransaction,
        },
      }).response,
    ).toMatchObject({ error: { code: 4100 } });
    expect(disk.approvals).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
});
