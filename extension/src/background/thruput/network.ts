import {
  createGroundhogClient,
  HttpTransport,
  toHex0x,
  type Transaction,
  type CoreGroundhogClient,
} from "@groundhogchain/client";
import {
  WalletProviderError,
  type WalletAccount,
} from "@groundhogchain/client/provider";
import type {
  Transport,
  TransportRequestOptions,
} from "@groundhogchain/client/transport";
import semver from "semver";
import {
  THRUPUT_NETWORKS,
  type ThruputNetworkSelection,
} from "thruput/networks";

export const requireThruputCompatibility = async (
  client: Pick<CoreGroundhogClient, "getVersion">,
) => {
  const version = await client.getVersion();
  if (
    !semver.valid(version.wireFormat) ||
    !semver.satisfies(version.wireFormat, ">=11.1.0 <12.0.0")
  ) {
    throw new WalletProviderError(
      4200,
      "This Thruput endpoint needs an update before it can be used with this wallet.",
    );
  }
};

/** Never learn a new signing identity implicitly from an RPC response. */
export const connectThruput = async (selection: ThruputNetworkSelection) => {
  const client = await createGroundhogClient({
    transport: new HttpTransport(THRUPUT_NETWORKS[selection.network].rpcUrl, {
      timeoutMs: 15000,
    }),
  });
  await requireThruputCompatibility(client);
  const identity = await client.getNetworkInfo();
  if (toHex0x(identity.networkHash).slice(2) !== selection.networkHash) {
    throw new WalletProviderError(4901, "Thruput network identity changed");
  }
  return client;
};

/** Published client 0.17 predates the optional view claim on RPC wire 11.2. */
export const simulateThruput = async (
  selection: ThruputNetworkSelection,
  transaction: Transaction,
  account: WalletAccount,
) => {
  const verified = await connectThruput(selection);
  const version = await verified.getVersion();
  if (
    !semver.valid(version.wireFormat) ||
    !semver.gte(version.wireFormat, "11.2.0")
  ) {
    throw new WalletProviderError(
      4200,
      "This endpoint does not support authorized invocation simulation",
    );
  }
  const http = new HttpTransport(THRUPUT_NETWORKS[selection.network].rpcUrl, {
    timeoutMs: 15000,
  });
  // Keep the SDK's response decoding and gas serialization. Add only the public,
  // pubkey-account claim this wallet supports; never supply keys or signatures.
  const transport: Transport = {
    request<T>(
      method: string,
      params?: unknown[],
      options?: TransportRequestOptions,
    ): Promise<T> {
      return http.request<T>(
        method,
        method === "groundhog_view"
          ? [
              {
                ...(params?.[0] as object),
                authClaim: {
                  kind: "pubkeySignature",
                  publicKey: account.publicKey,
                  nonce: account.nonce,
                },
              },
            ]
          : params,
        options,
      );
    },
  };
  const client = await createGroundhogClient({ transport });
  return client.view({
    contract: transaction.invocation.invoked_address,
    entrypoint: transaction.invocation.entrypoint,
    calldata: transaction.invocation.calldata,
    gasLimit: transaction.invocation.gas_limit,
  });
};
