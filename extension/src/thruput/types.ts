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
