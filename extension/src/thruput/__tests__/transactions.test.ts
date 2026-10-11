import { Keypair } from "stellar-sdk";
import {
  createPubkeyAccount,
  createTransaction,
  defaultWalletAdapter,
  PrivateKeySigner,
  serializeTransaction,
  toHex0x,
} from "@groundhogchain/client";
import { DefaultWallet, ERC20 } from "@groundhogchain/client/contracts";
import {
  blockHeight,
  contractAddress,
  gasAmount,
} from "@groundhogchain/protocol";
import { thruputAccount } from "../accounts";
import { inspectThruputTransaction } from "../transactions";

const seed = new Uint8Array(32).fill(7);
const account = createPubkeyAccount({ signer: new PrivateKeySigner(seed) });
const wireAccount = thruputAccount(
  Keypair.fromRawEd25519Seed(Buffer.from(seed)).publicKey(),
  "Account 1",
);
const recipient = contractAddress(new Uint8Array(32).fill(9));
const build = (
  invocation = defaultWalletAdapter.createRootInvocation(account.address, {
    gasLimit: gasAmount(1_000_000n),
    invocation: ERC20.v0_1.transfer.invocation(recipient, gasAmount(500_000n), {
      receiver: recipient,
      amount: 1n,
    }),
  }),
) =>
  createTransaction({
    invocation,
    uniquifier: { nonce: 1n, block_expiry_height: blockHeight(100n) },
    contracts_to_deploy: [],
    auth_claim: account.authClaim,
  });

describe("Thruput transaction review", () => {
  it("decodes a wallet transfer without confusing its root and target", () => {
    const bytes = toHex0x(serializeTransaction(build()));
    const { review, transaction } = inspectThruputTransaction(
      bytes,
      wireAccount,
    );
    expect(toHex0x(serializeTransaction(transaction))).toBe(bytes);
    expect(review.root).toBe(wireAccount.address);
    expect(review.calls[0]).toMatchObject({
      target: toHex0x(recipient),
      transfer: { recipient: toHex0x(recipient), rawAmount: "1" },
    });
  });

  it("rejects trailing bytes and a substituted root account", () => {
    const transaction = build();
    expect(() =>
      inspectThruputTransaction(
        `${toHex0x(serializeTransaction(transaction))}00`,
        wireAccount,
      ),
    ).toThrow();
    transaction.invocation.invoked_address = recipient;
    expect(() =>
      inspectThruputTransaction(
        toHex0x(serializeTransaction(transaction)),
        wireAccount,
      ),
    ).toThrow();
  });

  it("rejects empty batches", () => {
    const transaction = build(
      DefaultWallet.v0_1.execute.invocation(
        account.address,
        gasAmount(1_000_000n),
        { calls: [] },
      ),
    );
    expect(() =>
      inspectThruputTransaction(
        toHex0x(serializeTransaction(transaction)),
        wireAccount,
      ),
    ).toThrow("Expected 1 to 16 wallet calls");
  });
});
