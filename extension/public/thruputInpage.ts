import type {
  WalletProvider,
  WalletSession,
  ProviderRequest,
} from "@groundhogchain/client/provider";
import {
  THRUPUT_REQUEST_CHANNEL,
  THRUPUT_RESPONSE_CHANNEL,
} from "thruput/types";

if (window === window.top && ["http:", "https:"].includes(location.protocol)) {
  const listeners = new Set<(session: WalletSession) => void>();
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== THRUPUT_RESPONSE_CHANNEL
    )
      return;
    const data = event.data;
    if (data.change) {
      for (const listener of listeners) {
        try {
          listener(data.change);
        } catch {
          /* Isolate application callbacks. */
        }
      }
      return;
    }
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.error)
      request.reject(
        Object.assign(new Error(data.error.message), { code: data.error.code }),
      );
    else request.resolve(data.result);
  });
  const provider: WalletProvider = Object.freeze({
    info: Object.freeze({
      id: "org.groundhogchain.freighter",
      name: "Freighter Thruput",
      version: "1.0.0" as const,
    }),
    supportedMethods: Object.freeze(["getCapabilities"]),
    request(request: ProviderRequest): Promise<unknown> {
      if (pending.size >= 16)
        return Promise.reject(
          Object.assign(new Error("Too many wallet requests"), {
            code: -32002,
          }),
        );
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          window.postMessage(
            { channel: THRUPUT_REQUEST_CHANNEL, id, cancel: true },
            location.origin,
          );
          reject(
            Object.assign(new Error("Wallet request timed out"), {
              code: 4001,
            }),
          );
        }, 120000);
        pending.set(id, { resolve, reject, timer });
        window.postMessage(
          { channel: THRUPUT_REQUEST_CHANNEL, id, request },
          location.origin,
        );
      });
    },
    on(_event: "change", listener: (session: WalletSession) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("groundhog:announceProvider", { detail: provider }),
    );
  window.addEventListener("groundhog:requestProvider", announce);
  announce();
}
