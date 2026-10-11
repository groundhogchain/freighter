import {
  addressFromHex,
  defaultWalletAdapter,
  prepareTransaction,
  parseUnits,
  serializeTransaction,
  toHex0x,
  fromHex0x,
} from "@groundhogchain/client";
import { ERC20, ERC20Metadata } from "@groundhogchain/client/contracts";
import {
  AuthClaimType,
  CryptographicScheme,
  ed25519PublicKey,
  gasAmount,
} from "@groundhogchain/protocol";
import type { WalletAccount } from "@groundhogchain/client/provider";
import { HOG_ADDRESS, type ThruputToken } from "thruput/networks";
import type { ThruputBalance } from "thruput/types";
import type { connectThruput } from "./network";

type Client = Awaited<ReturnType<typeof connectThruput>>;

export const publicThruputAccount = (account: WalletAccount) => ({
  address: addressFromHex(account.address),
  authClaim: {
    claim_type: AuthClaimType.kPubkeySignature,
    pubkey_preimage: {
      pubkey: {
        scheme: CryptographicScheme.Ed25519,
        ed25519: ed25519PublicKey(fromHex0x(account.publicKey)),
      },
      nonce: BigInt(account.nonce),
    },
  } as const,
});

export const loadThruputPortfolio = async (
  client: Client,
  owner: string,
  tokens: ThruputToken[],
): Promise<ThruputBalance[]> =>
  Promise.all(
    tokens.map(async (token) => {
      try {
        const balance =
          token.address === HOG_ADDRESS
            ? (await client.getBalance(addressFromHex(owner))).rawBalance
            : (
                await ERC20.v0_1.getBalanceOf.view({
                  client,
                  contract: addressFromHex(token.address),
                  args: { addr: addressFromHex(owner) },
                })
              ).value;
        return { ...token, balance: balance.toString() };
      } catch {
        return { ...token, error: "Balance unavailable" };
      }
    }),
  );

export const loadThruputToken = async (
  client: Client,
  address: string,
): Promise<ThruputToken> => {
  const contract = addressFromHex(address);
  const [symbol, decimals] = await Promise.all([
    ERC20Metadata.v0_1.symbol.view({ client, contract }),
    ERC20Metadata.v0_1.decimals.view({ client, contract }),
  ]);
  if (decimals.value === null || decimals.value < 0n || decimals.value > 38n) {
    throw new Error("Unsupported token precision");
  }
  return {
    address,
    symbol: (symbol.value || "TOKEN").slice(0, 32),
    decimals: Number(decimals.value),
  };
};

export const prepareThruputTransfer = async (
  client: Client,
  account: WalletAccount,
  token: ThruputToken,
  recipient: string,
  inputAmount: string,
) => {
  const amount = parseUnits(inputAmount, token.decimals);
  if (amount <= 0n || amount >= 2n ** 128n)
    throw new Error("Amount is out of range");
  const publicAccount = publicThruputAccount(account);
  const invocation = defaultWalletAdapter.createRootInvocation(
    publicAccount.address,
    {
      gasLimit: gasAmount(1_000_000n),
      invocation: ERC20.v0_1.transfer.invocation(
        addressFromHex(token.address),
        gasAmount(500_000n),
        {
          receiver: addressFromHex(recipient),
          amount,
        },
      ),
    },
  );
  const transaction = await prepareTransaction(client, publicAccount, {
    invocation,
  });
  return toHex0x(serializeTransaction(transaction));
};
