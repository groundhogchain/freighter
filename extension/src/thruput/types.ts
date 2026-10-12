import type { ThruputAccount } from "./accounts";
import type { ThruputNetworkSelection, ThruputToken } from "./networks";
import type { ThruputTransactionReview } from "./transactions";

export enum ThruputOutcome {
  UNKNOWN = "unknown",
  SUBMITTED = "submitted",
  CONFIRMED = "confirmed",
  FAILED = "failed",
}

export interface ThruputOutgoing extends ThruputNetworkSelection {
  hash: string;
  account: string;
  createdAt: number;
  outcome: ThruputOutcome;
  diagnostic?: string;
}

export interface ThruputApproval {
  origin: string;
  account: string;
  networkHash: string;
  signedTransaction: string;
  hash: string;
}

export interface ThruputState extends ThruputNetworkSelection {
  accounts: ThruputAccount[];
  sites: string[];
  outgoing: ThruputOutgoing[];
  locked: boolean;
  selectedAccount?: string;
}

export enum ThruputHistoryKind {
  TRANSACTION = "transaction",
  RECEIVED = "received",
}

export interface ThruputHistoryRow {
  id: string;
  kind: ThruputHistoryKind;
  hash: string;
  height: string;
  token?: ThruputToken;
  rawAmount?: string;
}

export interface ThruputHistoryCursors {
  transactions?: string | null;
  tokens: Record<string, string | null | undefined>;
}

export interface ThruputHistoryPage {
  rows: ThruputHistoryRow[];
  cursors: ThruputHistoryCursors;
  hasMore: boolean;
  unavailable: string[];
  coverage: { source: string; oldestBlock: string; latestBlock: string }[];
}

export interface ThruputBalance extends ThruputToken {
  balance?: string;
  error?: string;
}

export interface ThruputPendingReview {
  id: string;
  origin: string;
  networkHash: string;
  accounts: ThruputAccount[];
  account?: string;
  transaction?: ThruputTransactionReview;
}

export enum ThruputUiAction {
  SELECT_ACCOUNT = "selectAccount",
  IMPORT = "import",
  STATE = "state",
  NETWORK = "network",
  PORTFOLIO = "portfolio",
  ADD_TOKEN = "addToken",
  REMOVE_TOKEN = "removeToken",
  AIRDROP = "airdrop",
  PREPARE_TRANSFER = "prepareTransfer",
  SEND = "send",
  OBSERVE = "observe",
  ACKNOWLEDGE = "acknowledge",
  REVOKE = "revoke",
  APPROVAL = "approval",
  DECIDE = "decide",
  SIMULATE = "simulate",
  HISTORY = "history",
}

export const THRUPUT_REQUEST_CHANNEL = "freighter:thruput:request";
export const THRUPUT_RESPONSE_CHANNEL = "freighter:thruput:response";
