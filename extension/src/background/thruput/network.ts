import {
  createGroundhogClient,
  HttpTransport,
  toHex0x,
} from "@groundhogchain/client";
import { WalletProviderError } from "@groundhogchain/client/provider";
import {
  THRUPUT_NETWORKS,
  type ThruputNetworkSelection,
} from "thruput/networks";

/** Never learn a new signing identity implicitly from an RPC response. */
export const connectThruput = async (selection: ThruputNetworkSelection) => {
  const client = await createGroundhogClient({
    transport: new HttpTransport(THRUPUT_NETWORKS[selection.network].rpcUrl, {
      timeoutMs: 15000,
    }),
  });
  const identity = await client.getNetworkInfo();
  if (toHex0x(identity.networkHash).slice(2) !== selection.networkHash) {
    throw new WalletProviderError(4901, "Thruput network identity changed");
  }
  return client;
};
