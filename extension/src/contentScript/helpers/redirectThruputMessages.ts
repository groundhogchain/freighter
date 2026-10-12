import browser from "webextension-polyfill";
import { parseProviderRequest } from "@groundhogchain/client/provider";
import { EXTERNAL_SERVICE_TYPES } from "@shared/constants/services";
import {
  THRUPUT_REQUEST_CHANNEL,
  THRUPUT_RESPONSE_CHANNEL,
} from "thruput/types";

export const redirectThruputMessages = () => {
  if (window !== window.top || !["http:", "https:"].includes(location.protocol))
    return;
  const active = new Set<string>();
  const reply = (data: object) =>
    window.postMessage(
      { channel: THRUPUT_RESPONSE_CHANNEL, ...data },
      location.origin,
    );
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== THRUPUT_REQUEST_CHANNEL
    )
      return;
    const { id, request, cancel } = event.data;
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return;
    if (cancel === true) {
      if (active.has(id))
        void browser.runtime
          .sendMessage({ type: EXTERNAL_SERVICE_TYPES.THRUPUT_CANCEL, id })
          .catch(() => {});
      return;
    }
    if (active.has(id) || active.size >= 16) return;
    let parsed;
    try {
      parsed = parseProviderRequest(request);
    } catch {
      reply({ id, error: { code: -32602, message: "Invalid wallet request" } });
      return;
    }
    active.add(id);
    void browser.runtime
      .sendMessage({
        type: EXTERNAL_SERVICE_TYPES.THRUPUT_PROVIDER,
        id,
        request: parsed,
      })
      .then(
        (result) =>
          reply({
            id,
            ...(result && typeof result === "object"
              ? result
              : { error: { code: 4900, message: "Wallet disconnected" } }),
          }),
        () =>
          reply({ id, error: { code: 4900, message: "Wallet disconnected" } }),
      )
      .finally(() => active.delete(id));
  });
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === EXTERNAL_SERVICE_TYPES.THRUPUT_PROVIDER &&
      "change" in message
    ) {
      reply({ change: message.change });
      // Acknowledge only this message, after queueing the page-facing change.
      return Promise.resolve(null);
    }
    return undefined;
  });
};
