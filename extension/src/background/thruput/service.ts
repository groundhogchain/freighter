import browser from "webextension-polyfill";
import {
  addressFromHex,
  createGroundhogClient,
  deserializeSignedTransaction,
  fromHex0x,
  hashFromHex,
  HttpTransport,
  toHex0x,
} from "@groundhogchain/client";
import {
  parseProviderRequest,
  parseWalletHex32,
  parseWalletNetworkHash,
  WalletProviderError,
  type ProviderRequest,
  type WalletSession,
} from "@groundhogchain/client/provider";
import { ExecResult } from "@groundhogchain/protocol";
import { groundhog_erc20_if } from "@groundhogchain/client/contracts";
import { requestAirdrop } from "@groundhogchain/client/actions";

import {
  SERVICE_TYPES,
  EXTERNAL_SERVICE_TYPES,
} from "@shared/constants/services";
import { ROUTES } from "popup/constants/routes";
import { toProviderAccount } from "thruput/accounts";
import {
  HOG_TOKEN,
  THRUPUT_NETWORKS,
  ThruputNetwork,
  thruputScope,
} from "thruput/networks";
import { inspectThruputTransaction } from "thruput/transactions";
import {
  ThruputUiAction,
  ThruputOutcome,
  type ThruputPendingReview,
  type ThruputApproval,
  type ThruputOutgoing,
  type ThruputState,
} from "thruput/types";
import { getThruputVault, signThruputTransaction } from "./vault";
import { connectThruput, simulateThruput } from "./network";
import { THRUPUT_STORAGE_KEY, ThruputStore } from "./storage";
import {
  requestRecord,
  requestText,
  requireLiveThruputDocument,
  requireThruputOrigin,
  requireThruputUi,
  type ThruputSender,
} from "./policy";
import {
  loadThruputPortfolio,
  loadThruputToken,
  prepareThruputTransfer,
} from "./portfolio";

type SigningRequest = Extract<ProviderRequest, { method: "signTransaction" }>;
type ApprovalRequest =
  | SigningRequest
  | Extract<ProviderRequest, { method: "connect" }>;
interface Pending {
  id: string;
  requestId: string;
  origin: string;
  sender: ThruputSender;
  request: ApprovalRequest;
  epoch: number;
  tab?: number;
  window?: number;
  processing?: boolean;
  granting?: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const store = new ThruputStore({
  read: async () =>
    (await browser.storage.local.get(THRUPUT_STORAGE_KEY))[THRUPUT_STORAGE_KEY],
  write: async (value) =>
    browser.storage.local.set({ [THRUPUT_STORAGE_KEY]: value }),
});
const ownOrigin = () => browser.runtime.getURL("");
const approvalScope = (
  a: Pick<ThruputApproval, "origin" | "account" | "networkHash">,
) => JSON.stringify([a.origin, a.account, a.networkHash]);
const unresolved = (record: ThruputOutgoing) =>
  record.outcome === ThruputOutcome.UNKNOWN ||
  record.outcome === ThruputOutcome.SUBMITTED;

// Permissions intentionally start empty after a worker restart. Recovery does not.
const grants = new Map<string, string[]>();
const eligible = new Map<string, string>();
const pending = new Map<string, Pending>();
const documents = new Map<string, ThruputSender>();
const publishedSessions = new Map<string, string>();
let epoch = 0;
let sessionMarker = "";
let previousSessionKey = "";
let previousNetwork = "";
let ready: Promise<void> | undefined;
let publication = Promise.resolve();

const initialize = () => {
  if (!ready)
    ready = (async () => {
      for (const area of [browser.storage.local, browser.storage.session]) {
        const trusted = area as typeof area & {
          setAccessLevel?: (options: { accessLevel: string }) => Promise<void>;
        };
        await trusted?.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
      }
      await store.update((next) => {
        next.approvals = [];
      });
    })();
  return ready;
};

const cancel = (item: Pending, message = "Wallet request canceled") => {
  if (!pending.delete(item.id)) return;
  if (item.granting) {
    grants.delete(item.origin);
    void publish().catch(() => {});
  }
  clearTimeout(item.timer);
  item.reject(new WalletProviderError(4001, message));
  if (item.window !== undefined)
    void browser.windows.remove(item.window).catch(() => {});
};

const invalidate = (preserveConnect = false) => {
  epoch++;
  grants.clear();
  eligible.clear();
  for (const item of pending.values()) {
    if (preserveConnect && item.request.method === "connect")
      item.epoch = epoch;
    else cancel(item);
  }
};

const snapshot = async () => {
  await initialize();
  const [vault, data] = await Promise.all([getThruputVault(), store.read()]);
  const marker = JSON.stringify([
    vault.sessionKey,
    vault.activePublicKey,
    vault.accounts,
    data.network,
    data.networkHash,
  ]);
  if (marker !== sessionMarker) {
    const network = JSON.stringify([data.network, data.networkHash]);
    const unlocking =
      !previousSessionKey && !!vault.sessionKey && network === previousNetwork;
    sessionMarker = marker;
    previousSessionKey = vault.sessionKey;
    previousNetwork = network;
    invalidate(unlocking);
  }
  return { vault, data, epoch };
};

const session = (
  origin: string,
  value: Awaited<ReturnType<typeof snapshot>>,
): WalletSession => ({
  networkHash: value.data.networkHash,
  accounts: value.vault.accounts
    .filter((a) => grants.get(origin)?.includes(a.address))
    .map(toProviderAccount),
});

const publish = async () => {
  const value = await snapshot();
  const updates = [...documents.values()].flatMap((sender) => {
    const current = session(sender.origin!, value);
    const serialized = JSON.stringify(current);
    if (publishedSessions.get(sender.documentId!) === serialized) return [];
    publishedSessions.set(sender.documentId!, serialized);
    return [{ sender, session: current }];
  });
  publication = publication.then(async () => {
    await Promise.all(
      updates.map(({ sender, session: current }) =>
        browser.tabs
          .sendMessage(
            sender.tab!.id!,
            {
              type: EXTERNAL_SERVICE_TYPES.THRUPUT_PROVIDER,
              change: current,
            },
            {
              documentId: sender.documentId,
            } as browser.Tabs.SendMessageOptionsType,
          )
          .catch(() => {}),
      ),
    );
  });
  await publication;
};

const accountFor = (
  value: Awaited<ReturnType<typeof snapshot>>,
  address: string,
) => {
  const account = value.vault.accounts.find((a) => a.address === address);
  if (!value.vault.sessionKey || !account)
    throw new WalletProviderError(4100, "Unlock a software account first");
  return account;
};

const assertCurrent = async (expected: number) => {
  const value = await snapshot();
  if (value.epoch !== expected)
    throw new WalletProviderError(4100, "Wallet session changed");
  return value;
};

const assertGrant = (
  origin: string,
  account: string,
  value: Awaited<ReturnType<typeof snapshot>>,
) => {
  accountFor(value, account);
  if (origin !== ownOrigin() && !grants.get(origin)?.includes(account)) {
    throw new WalletProviderError(
      4100,
      "Account is not connected to this site",
    );
  }
};

const queueApproval = async (
  request: ApprovalRequest,
  requestId: string,
  origin: string,
  sender: ThruputSender,
) => {
  const value = await snapshot();
  if (!value.vault.accounts.length && request.method !== "connect")
    throw new WalletProviderError(4100, "Unlock a software account first");
  if (
    pending.size >= 8 ||
    [...pending.values()].some((p) => p.origin === origin)
  ) {
    throw new WalletProviderError(
      -32002,
      "A wallet approval is already pending",
    );
  }
  if (request.method === "signTransaction") {
    assertGrant(origin, request.params.account, value);
    if (request.params.networkHash !== value.data.networkHash)
      throw new WalletProviderError(4901, "Wrong Thruput network");
    inspectThruputTransaction(
      request.params.transaction,
      accountFor(value, request.params.account),
    );
    eligible.delete(approvalScope({ origin, ...request.params }));
  }
  return new Promise<unknown>((resolve, reject) => {
    const id = crypto.randomUUID();
    const item: Pending = {
      id,
      requestId,
      origin,
      sender,
      request,
      epoch: value.epoch,
      resolve,
      reject,
      timer: setTimeout(
        () => cancel(item, "Wallet approval timed out"),
        115000,
      ),
    };
    pending.set(id, item);
    void (async () => {
      await connectThruput(value.data);
      await assertCurrent(item.epoch);
      if (origin !== ownOrigin()) await requireLiveThruputDocument(sender);
      if (!pending.has(id)) return;
      const popup = await browser.windows.create({
        url: browser.runtime.getURL(
          `index.html#${ROUTES.thruput}?approval=${id}`,
        ),
        type: "popup",
        width: 460,
        height: 720,
      });
      if (!popup?.id) throw new Error("Could not open wallet approval");
      if (!pending.has(id)) {
        await browser.windows.remove(popup.id);
        return;
      }
      item.window = popup.id;
      item.tab = popup.tabs?.[0]?.id;
      if (item.tab === undefined)
        item.tab = (await browser.tabs.query({ windowId: popup.id }))[0]?.id;
      if (item.tab === undefined)
        throw new Error("Could not identify wallet approval");
    })().catch(() => cancel(item, "Could not prepare wallet approval"));
  });
};

const approvalFor = (id: string, sender: ThruputSender) => {
  const item = pending.get(id);
  if (!item || item.tab === undefined || item.tab !== sender.tab?.id) {
    throw new WalletProviderError(4100, "Approval is unavailable");
  }
  return item;
};

const reviewApproval = async (
  id: string,
  sender: ThruputSender,
): Promise<ThruputPendingReview> => {
  const item = approvalFor(id, sender);
  const value = await assertCurrent(item.epoch);
  if (item.origin !== ownOrigin())
    await requireLiveThruputDocument(item.sender);
  return {
    id,
    origin: item.origin,
    networkHash: value.data.networkHash,
    accounts: value.vault.accounts,
    ...(item.request.method === "signTransaction"
      ? {
          account: item.request.params.account,
          transaction: inspectThruputTransaction(
            item.request.params.transaction,
            accountFor(value, item.request.params.account),
          ).review,
        }
      : {}),
  };
};

const decide = async (
  id: string,
  accepted: boolean,
  selected: string[],
  sender: ThruputSender,
) => {
  const item = approvalFor(id, sender);
  if (!accepted) {
    cancel(item, "The user rejected this request");
    return null;
  }
  if (item.processing)
    throw new WalletProviderError(-32002, "Approval is already processing");
  item.processing = true;
  try {
    const value = await assertCurrent(item.epoch);
    if (item.origin !== ownOrigin())
      await requireLiveThruputDocument(item.sender);
    const client = await connectThruput(value.data);
    await assertCurrent(item.epoch);
    if (!pending.has(id))
      throw new WalletProviderError(4001, "Approval expired");
    if (item.request.method === "connect") {
      if (!selected.length || selected.length > 32)
        throw new WalletProviderError(-32602, "Select an account");
      selected.forEach((address) => accountFor(value, address));
      item.granting = true;
      grants.set(item.origin, [...new Set(selected)]);
      await publish();
      if (!pending.has(id) || epoch !== item.epoch) {
        grants.delete(item.origin);
        await publish();
        throw new WalletProviderError(4001, "Connection canceled");
      }
      item.resolve(session(item.origin, value));
    } else {
      const { params } = item.request;
      assertGrant(item.origin, params.account, value);
      const { transaction } = inspectThruputTransaction(
        params.transaction,
        accountFor(value, params.account),
      );
      if (
        transaction.uniquifier.block_expiry_height <=
        (await client.getChainTip()).height
      ) {
        throw new WalletProviderError(-32602, "Transaction has expired");
      }
      const signed = await signThruputTransaction(
        transaction,
        params.account,
        fromHex0x(`0x${value.data.networkHash}`),
        value.vault.sessionKey,
      );
      await assertCurrent(item.epoch);
      if (!pending.has(id))
        throw new WalletProviderError(4001, "Approval expired");
      const approval: ThruputApproval = {
        origin: item.origin,
        account: params.account,
        networkHash: params.networkHash,
        ...signed,
      };
      await store.update((next) => {
        if (!pending.has(id) || epoch !== item.epoch)
          throw new WalletProviderError(4001, "Approval expired");
        next.approvals = next.approvals.filter(
          (a) => approvalScope(a) !== approvalScope(approval),
        );
        next.approvals.push(approval);
        if (
          next.approvals.length > 16 ||
          new TextEncoder().encode(JSON.stringify(next.approvals)).length >
            6 * 1024 * 1024
        ) {
          throw new WalletProviderError(
            -32002,
            "Wallet approval capacity reached",
          );
        }
      });
      await assertCurrent(item.epoch);
      if (item.origin !== ownOrigin())
        await requireLiveThruputDocument(item.sender);
      if (!pending.has(id))
        throw new WalletProviderError(4001, "Approval expired");
      assertGrant(item.origin, params.account, await snapshot());
      eligible.set(approvalScope(approval), signed.hash);
      item.resolve(signed);
    }
    pending.delete(id);
    clearTimeout(item.timer);
    if (item.window !== undefined)
      void browser.windows.remove(item.window).catch(() => {});
    return null;
  } finally {
    item.processing = false;
  }
};

const submit = async (
  params: Extract<ProviderRequest, { method: "submitTransaction" }>["params"],
  origin: string,
  sender: ThruputSender,
) => {
  const value = await snapshot();
  assertGrant(origin, params.account, value);
  if (params.networkHash !== value.data.networkHash)
    throw new WalletProviderError(4901, "Wrong Thruput network");
  const scope = approvalScope({ origin, ...params });
  const approved = value.data.approvals.find(
    (a) =>
      approvalScope(a) === scope &&
      a.hash === eligible.get(scope) &&
      a.signedTransaction === params.signedTransaction,
  );
  if (!approved)
    throw new WalletProviderError(4100, "These signed bytes are not approved");
  const client = await connectThruput(value.data);
  await assertCurrent(value.epoch);
  if (origin !== ownOrigin()) await requireLiveThruputDocument(sender);
  await store.update((next) => {
    if (epoch !== value.epoch || eligible.get(scope) !== approved.hash)
      throw new WalletProviderError(4100, "Approval expired");
    assertGrant(origin, params.account, value);
    const index = next.approvals.findIndex(
      (a) =>
        approvalScope(a) === scope &&
        a.signedTransaction === params.signedTransaction,
    );
    if (index === -1)
      throw new WalletProviderError(4100, "Approval already consumed");
    next.approvals.splice(index, 1);
    if (next.outgoing.length >= 128)
      throw new WalletProviderError(
        -32002,
        "Review old transaction records before sending",
      );
    if (
      !next.outgoing.some(
        (r) => r.hash === approved.hash && r.networkHash === params.networkHash,
      )
    ) {
      next.outgoing.push({
        network: value.data.network,
        networkHash: params.networkHash,
        account: params.account,
        hash: approved.hash,
        createdAt: Date.now(),
        outcome: ThruputOutcome.UNKNOWN,
      });
    }
  });
  eligible.delete(scope);
  await assertCurrent(value.epoch);
  assertGrant(origin, params.account, await snapshot());
  if (origin !== ownOrigin()) await requireLiveThruputDocument(sender);
  if (epoch !== value.epoch)
    throw new WalletProviderError(4100, "Wallet session changed");
  assertGrant(origin, params.account, value);
  try {
    const hash = await client.sendTransaction(
      deserializeSignedTransaction(fromHex0x(params.signedTransaction)),
    );
    if (toHex0x(hash) !== approved.hash)
      throw new Error("Transaction hash mismatch");
    await store.update((next) => {
      const record = next.outgoing.find(
        (r) => r.hash === approved.hash && r.networkHash === params.networkHash,
      );
      if (record) record.outcome = ThruputOutcome.SUBMITTED;
    });
    return { hash: approved.hash };
  } catch {
    throw new WalletProviderError(
      4900,
      `Submission outcome unknown. Check transaction ${approved.hash} on its original network.`,
    );
  }
};

const provider = async (
  raw: unknown,
  requestId: string,
  sender: ThruputSender,
) => {
  const origin = requireThruputOrigin(sender);
  const request = parseProviderRequest(raw);
  const value = await snapshot();
  if (documents.size >= 256 && !documents.has(sender.documentId!)) {
    throw new WalletProviderError(-32002, "Too many connected documents");
  }
  documents.set(sender.documentId!, sender);
  if (!publishedSessions.has(sender.documentId!))
    publishedSessions.set(
      sender.documentId!,
      JSON.stringify(session(origin, value)),
    );
  switch (request.method) {
    case "getSession":
      return session(origin, value);
    case "disconnect":
      await revoke(origin);
      return null;
    case "getCapabilities":
      assertGrant(origin, request.params.account, value);
      if (request.params.networkHash !== value.data.networkHash)
        throw new WalletProviderError(4901, "Wrong Thruput network");
      return { ...request.params, atomicBatch: { maxCalls: 16 } };
    case "connect":
    case "signTransaction":
      return queueApproval(request, requestId, origin, sender);
    case "submitTransaction":
      return submit(request.params, origin, sender);
    default:
      throw new WalletProviderError(4200, "Unsupported wallet method");
  }
};

const revoke = async (origin: string) => {
  grants.delete(origin);
  for (const item of pending.values()) if (item.origin === origin) cancel(item);
  for (const scope of eligible.keys())
    if (JSON.parse(scope)[0] === origin) eligible.delete(scope);
  const delivered = publish();
  await store.update((next) => {
    next.approvals = next.approvals.filter((a) => a.origin !== origin);
  });
  await delivered;
};

const ui = async (
  message: Record<string, unknown>,
  sender: ThruputSender,
): Promise<unknown> => {
  requireThruputUi(sender);
  const value = await snapshot();
  const data = value.data;
  switch (message.action) {
    case ThruputUiAction.STATE:
      return {
        network: data.network,
        networkHash: data.networkHash,
        accounts: value.vault.accounts,
        sites: [...grants.keys()],
        outgoing: value.vault.sessionKey ? data.outgoing : [],
        locked: !value.vault.sessionKey,
      } satisfies ThruputState;
    case ThruputUiAction.APPROVAL:
      return reviewApproval(requestText(message.id), sender);
    case ThruputUiAction.DECIDE:
      if (
        typeof message.accepted !== "boolean" ||
        !Array.isArray(message.accounts)
      )
        throw new WalletProviderError(-32602, "Invalid approval decision");
      return decide(
        requestText(message.id),
        message.accepted,
        message.accounts.map(parseWalletHex32),
        sender,
      );
    default:
      break;
  }
  if (!value.vault.sessionKey)
    throw new WalletProviderError(4100, "Unlock the wallet first");
  if (message.action === ThruputUiAction.REVOKE) {
    await revoke(requestText(message.origin));
    return null;
  }
  if (message.action === ThruputUiAction.NETWORK) {
    const network = requestText(message.network) as ThruputNetwork;
    if (!Object.values(ThruputNetwork).includes(network))
      throw new WalletProviderError(-32602, "Unsupported network");
    const client = await createGroundhogClient({
      transport: new HttpTransport(THRUPUT_NETWORKS[network].rpcUrl, {
        timeoutMs: 15000,
      }),
    });
    const identity = await client.getNetworkInfo();
    await assertCurrent(value.epoch);
    const networkHash = toHex0x(identity.networkHash).slice(2);
    if (
      network === ThruputNetwork.LOCALNET &&
      networkHash !== THRUPUT_NETWORKS.localnet.networkHash
    )
      throw new WalletProviderError(4901, "Unexpected localnet identity");
    invalidate();
    await store.update((next) => {
      next.network = network;
      next.networkHash = networkHash;
      next.approvals = [];
    });
    await publish();
    return null;
  }
  if (message.action === ThruputUiAction.OBSERVE) {
    const hash = parseWalletHex32(message.hash),
      networkHash = parseWalletNetworkHash(message.networkHash);
    const record = data.outgoing.find(
      (r) => r.hash === hash && r.networkHash === networkHash,
    );
    if (!record) throw new WalletProviderError(-32602, "Unknown transaction");
    const client = await connectThruput(record);
    const receipt = await client.getTransactionReceipt(hashFromHex(hash));
    await store.update((next) => {
      const existing = next.outgoing.find(
        (r) => r.hash === hash && r.networkHash === networkHash,
      );
      if (existing && receipt)
        existing.outcome =
          receipt.execResult === ExecResult.ExecResultOK
            ? ThruputOutcome.CONFIRMED
            : ThruputOutcome.FAILED;
    });
    return receipt
      ? {
          committed: true,
          success: receipt.execResult === ExecResult.ExecResultOK,
        }
      : { committed: false };
  }
  if (message.action === ThruputUiAction.ACKNOWLEDGE) {
    if (message.confirmRisk !== true)
      throw new WalletProviderError(
        -32602,
        "Explicit acknowledgement required",
      );
    const hash = parseWalletHex32(message.hash),
      networkHash = parseWalletNetworkHash(message.networkHash);
    await store.update((next) => {
      next.outgoing = next.outgoing.filter(
        (r) => r.hash !== hash || r.networkHash !== networkHash,
      );
    });
    return null;
  }
  const account = accountFor(value, parseWalletHex32(message.account));
  const client = await connectThruput(data);
  await assertCurrent(value.epoch);
  const tokens = [
    HOG_TOKEN,
    ...(data.tokens[data.networkHash] || []).filter(
      (t) => t.address !== HOG_TOKEN.address,
    ),
  ];
  switch (message.action) {
    case ThruputUiAction.PORTFOLIO:
      return loadThruputPortfolio(client, account.address, tokens);
    case ThruputUiAction.ADD_TOKEN: {
      const token = await loadThruputToken(
        client,
        parseWalletHex32(message.token),
      );
      await assertCurrent(value.epoch);
      await store.update((next) => {
        if (epoch !== value.epoch)
          throw new WalletProviderError(4100, "Wallet session changed");
        const list = next.tokens[data.networkHash] || [];
        if (list.length >= 64)
          throw new WalletProviderError(-32602, "Token limit reached");
        next.tokens[data.networkHash] = [
          ...list.filter((t) => t.address !== token.address),
          token,
        ];
      });
      return token;
    }
    case ThruputUiAction.REMOVE_TOKEN: {
      const token = parseWalletHex32(message.token);
      await store.update((next) => {
        next.tokens[data.networkHash] = (
          next.tokens[data.networkHash] || []
        ).filter((t) => t.address !== token);
      });
      return null;
    }
    case ThruputUiAction.AIRDROP: {
      const scope = thruputScope(data.networkHash, account.address);
      const saved = await store.update((next) => {
        next.airdrops[scope] ||= toHex0x(
          crypto.getRandomValues(new Uint8Array(16)),
        ).slice(2);
      });
      const result = await requestAirdrop(
        new HttpTransport(THRUPUT_NETWORKS[data.network].rpcUrl, {
          timeoutMs: 15000,
        }),
        {
          recipient: addressFromHex(account.address),
          clientNonce: fromHex0x(`0x${saved.airdrops[scope]}`),
        },
      );
      await store.update((next) => {
        delete next.airdrops[scope];
      });
      if (result.status.result !== "ok")
        throw new Error("Funding committed but execution failed");
      return { hash: toHex0x(result.txHash) };
    }
    case ThruputUiAction.PREPARE_TRANSFER: {
      if (
        data.outgoing.some(
          (r) =>
            r.account === account.address &&
            r.networkHash === data.networkHash &&
            unresolved(r),
        )
      )
        throw new WalletProviderError(
          -32002,
          "Observe the unresolved transfer before sending again",
        );
      const token = tokens.find(
        (t) => t.address === parseWalletHex32(message.token),
      );
      if (!token) throw new WalletProviderError(-32602, "Add the token first");
      const transaction = await prepareThruputTransfer(
        client,
        account,
        token,
        parseWalletHex32(message.recipient),
        requestText(message.amount, 100),
      );
      await assertCurrent(value.epoch);
      return {
        transaction,
        networkHash: data.networkHash,
        review: inspectThruputTransaction(transaction, account).review,
      };
    }
    case ThruputUiAction.SEND: {
      const request = parseProviderRequest({
        method: "signTransaction",
        params: {
          account: account.address,
          networkHash: message.networkHash,
          transaction: message.transaction,
        },
      }) as SigningRequest;
      const signed = (await queueApproval(
        request,
        crypto.randomUUID(),
        ownOrigin(),
        sender,
      )) as { signedTransaction: string; hash: string };
      return submit(
        {
          account: account.address,
          networkHash: request.params.networkHash,
          signedTransaction: signed.signedTransaction,
        },
        ownOrigin(),
        sender,
      );
    }
    case ThruputUiAction.SIMULATE: {
      const item = approvalFor(requestText(message.id), sender);
      if (item.request.method !== "signTransaction")
        throw new WalletProviderError(-32602, "No transaction to simulate");
      const { transaction } = inspectThruputTransaction(
        item.request.params.transaction,
        account,
      );
      if (transaction.contracts_to_deploy.length)
        throw new WalletProviderError(
          4200,
          "Attached contract code is not supported by invocation simulation",
        );
      const result = await simulateThruput(data, transaction, account);
      await assertCurrent(item.epoch);
      return JSON.parse(
        JSON.stringify(result, (_, entry: unknown) =>
          typeof entry === "bigint"
            ? entry.toString()
            : entry instanceof Uint8Array
              ? toHex0x(entry)
              : entry,
        ),
      );
    }
    case ThruputUiAction.HISTORY: {
      const history = await client.getTransactionsByAddress({
        address: addressFromHex(account.address),
        anchor: "end",
        order: "descending",
        limit: 20,
      });
      const event = groundhog_erc20_if.v0_1.events.TransferEvent;
      const incoming = await Promise.all(
        tokens.map(async (token) => {
          try {
            const page = await client.getContractEvents({
              event,
              contractAddresses: [addressFromHex(token.address)],
              topics: { to: addressFromHex(account.address) },
              anchor: "end",
              order: "descending",
              limit: 20,
            });
            return { token, events: page.events };
          } catch {
            return { token, events: [], unavailable: true };
          }
        }),
      );
      return JSON.parse(
        JSON.stringify({ history, incoming }, (_, entry: unknown) =>
          typeof entry === "bigint"
            ? entry.toString()
            : entry instanceof Uint8Array
              ? toHex0x(entry)
              : entry,
        ),
      );
    }
    default:
      throw new WalletProviderError(4200, "Unsupported wallet action");
  }
};

export const handleThruputMessage = async (
  input: unknown,
  sender: ThruputSender,
) => {
  try {
    const message = requestRecord(input);
    if (message.type === SERVICE_TYPES.THRUPUT_UI)
      return { result: await ui(message, sender) };
    const origin = requireThruputOrigin(sender);
    const id = requestText(message.id, 36);
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new WalletProviderError(-32602, "Invalid request ID");
    if (message.type === EXTERNAL_SERVICE_TYPES.THRUPUT_CANCEL) {
      for (const item of pending.values())
        if (
          item.origin === origin &&
          item.requestId === id &&
          item.sender.documentId === sender.documentId
        )
          cancel(item);
      return { result: null };
    }
    return { result: await provider(message.request, id, sender) };
  } catch (error) {
    return {
      error: {
        code: error instanceof WalletProviderError ? error.code : -32603,
        message:
          error instanceof Error
            ? error.message.slice(0, 1024)
            : "Wallet request failed",
      },
    };
  }
};

export const initThruputLifecycle = () => {
  browser.windows.onRemoved.addListener((id) => {
    for (const item of pending.values()) if (item.window === id) cancel(item);
  });
  browser.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    for (const [id, sender] of documents)
      if (sender.tab?.id === details.tabId) {
        documents.delete(id);
        publishedSessions.delete(id);
      }
    for (const item of pending.values())
      if (item.sender.tab?.id === details.tabId) cancel(item);
  });
  browser.tabs.onRemoved.addListener((id) => {
    for (const [document, sender] of documents)
      if (sender.tab?.id === id) {
        documents.delete(document);
        publishedSessions.delete(document);
      }
    for (const item of pending.values())
      if (item.sender.tab?.id === id) cancel(item);
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (
      area === "session" ||
      (area === "local" && ("temporaryStore" in changes || "keyId" in changes))
    ) {
      void publish().catch(() => {
        invalidate();
      });
    }
  });
};
