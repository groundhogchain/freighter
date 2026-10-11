import browser from "webextension-polyfill";
import { WalletProviderError } from "@groundhogchain/client/provider";

export type ThruputSender = browser.Runtime.MessageSender & {
  documentId?: string;
  origin?: string;
};

export const requireThruputOrigin = (sender: ThruputSender): string => {
  if (
    sender.id !== browser.runtime.id ||
    sender.frameId !== 0 ||
    !sender.tab?.id ||
    !sender.documentId ||
    !sender.url ||
    !sender.origin ||
    sender.origin === "null"
  )
    throw new WalletProviderError(4100, "A top-level web page is required");
  const url = new URL(sender.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== sender.origin
  ) {
    throw new WalletProviderError(4100, "Untrusted document origin");
  }
  return url.origin;
};

export const requireThruputUi = (sender: ThruputSender) => {
  if (
    sender.id !== browser.runtime.id ||
    !sender.url ||
    !sender.url.startsWith(browser.runtime.getURL("index.html")) ||
    new URL(sender.url).pathname !== "/index.html"
  )
    throw new WalletProviderError(4100, "Trusted wallet UI required");
};

export const requireLiveThruputDocument = async (sender: ThruputSender) => {
  const frame = await browser.webNavigation.getFrame({
    tabId: sender.tab!.id!,
    frameId: 0,
  });
  if (
    !frame ||
    (frame as { documentId?: string }).documentId !== sender.documentId ||
    new URL(frame.url).origin !== sender.origin
  )
    throw new WalletProviderError(4100, "The requesting document changed");
};

export const requestRecord = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new WalletProviderError(-32602, "Invalid wallet request");
  }
  return input as Record<string, unknown>;
};

export const requestText = (input: unknown, maximum = 1024): string => {
  if (typeof input !== "string" || input.length > maximum) {
    throw new WalletProviderError(-32602, "Invalid wallet request field");
  }
  return input;
};
