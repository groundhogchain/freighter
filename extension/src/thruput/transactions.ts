import { toHex0x, formatUnits, type Transaction } from "@groundhogchain/client";
import { DefaultWallet, ERC20 } from "@groundhogchain/client/contracts";
import { deriveContractAddress } from "@groundhogchain/client/contract";
import {
  assertWalletTransaction,
  parseTransactionHex,
  WalletProviderError,
  type WalletAccount,
} from "@groundhogchain/client/provider";
import { codec, serialize, sha256Hash } from "@groundhogchain/protocol";
import { toProviderAccount } from "./accounts";
import type { ThruputToken } from "./networks";

export interface ThruputCallReview {
  target: string;
  entrypoint: string;
  gasLimit: string;
  calldata: string;
  transfer?: {
    recipient: string;
    rawAmount: string;
    symbol?: string;
    displayAmount?: string;
  };
}

export interface ThruputTransactionReview {
  root: string;
  method: "execute" | "deploy";
  gasLimit: string;
  expiryHeight: string;
  nonce: string;
  calls: ThruputCallReview[];
  deployment?: {
    contractHash: string;
    nonce: string;
    rawFunding: string;
  };
  attachedContracts: string[];
}

export const describeThruputAmounts = (
  review: ThruputTransactionReview,
  tokens: ThruputToken[],
): ThruputTransactionReview => ({
  ...review,
  calls: review.calls.map((call) => {
    const token = tokens.find((item) => item.address === call.target);
    return call.transfer && token
      ? {
          ...call,
          transfer: {
            ...call.transfer,
            symbol: token.symbol,
            displayAmount: formatUnits(
              BigInt(call.transfer.rawAmount),
              token.decimals,
            ),
          },
        }
      : call;
  }),
});

const sameBytes = (a: Uint8Array, b: Uint8Array) => toHex0x(a) === toHex0x(b);

const callReview = (call: {
  target: Uint8Array;
  entrypoint: Uint8Array;
  gas_limit: bigint;
  calldata: Uint8Array;
}): ThruputCallReview => {
  const transfer = sameBytes(call.entrypoint, ERC20.v0_1.transfer.entrypoint)
    ? ERC20.v0_1.transfer.decodeArgs(call.calldata)
    : undefined;
  return {
    target: toHex0x(call.target),
    entrypoint: toHex0x(call.entrypoint),
    gasLimit: call.gas_limit.toString(),
    calldata: toHex0x(call.calldata),
    ...(transfer
      ? {
          transfer: {
            recipient: toHex0x(transfer.receiver),
            rawAmount: transfer.amount.toString(),
          },
        }
      : {}),
  };
};

/** Decoding describes an ABI interpretation, never the target's legitimacy. */
export const inspectThruputTransaction = (
  bytes: string,
  account: WalletAccount,
): { transaction: Transaction; review: ThruputTransactionReview } => {
  const transaction = parseTransactionHex(bytes);
  assertWalletTransaction(transaction, toProviderAccount(account));
  const root = transaction.invocation;
  const common = {
    root: toHex0x(root.invoked_address),
    gasLimit: root.gas_limit.toString(),
    expiryHeight: transaction.uniquifier.block_expiry_height.toString(),
    nonce: transaction.uniquifier.nonce.toString(),
    attachedContracts: transaction.contracts_to_deploy.map((contract) =>
      toHex0x(serialize(contract, codec.Contract)),
    ),
  };
  if (sameBytes(root.entrypoint, DefaultWallet.v0_1.execute.entrypoint)) {
    const { calls } = DefaultWallet.v0_1.execute.decodeArgs(root.calldata);
    if (!calls.length || calls.length > 16) {
      throw new WalletProviderError(-32602, "Expected 1 to 16 wallet calls");
    }
    return {
      transaction,
      review: { ...common, method: "execute", calls: calls.map(callReview) },
    };
  }
  if (sameBytes(root.entrypoint, DefaultWallet.v0_1.deploy.entrypoint)) {
    const deployment = DefaultWallet.v0_1.deploy.decodeArgs(root.calldata);
    return {
      transaction,
      review: {
        ...common,
        method: "deploy",
        deployment: {
          contractHash: toHex0x(deployment.contractHash),
          nonce: toHex0x(deployment.nonce),
          rawFunding: deployment.amount.toString(),
        },
        calls: deployment.initializer
          ? [
              callReview({
                ...deployment.initializer,
                target: deriveContractAddress(
                  root.invoked_address,
                  sha256Hash(deployment.nonce),
                  sha256Hash(deployment.contractHash),
                ),
              }),
            ]
          : [],
      },
    };
  }
  throw new WalletProviderError(4200, "Unsupported Thruput wallet entrypoint");
};
