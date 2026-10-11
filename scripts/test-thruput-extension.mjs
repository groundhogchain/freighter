import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import {
  createGroundhogClient,
  HttpTransport,
  prepareTransaction,
  defaultWalletAdapter,
  addressFromHex,
  fromHex0x,
  serializeTransaction,
  toHex0x,
  hashFromHex,
  ExecResult,
} from "@groundhogchain/client";
import { ERC20, DefaultWallet } from "@groundhogchain/client/contracts";
import { verifySignTransactionResult } from "@groundhogchain/client/provider";
import {
  AuthClaimType,
  CryptographicScheme,
  ed25519PublicKey,
  gasAmount,
} from "@groundhogchain/protocol";

// Disposable browser profile and local chain only. Never use a user's wallet.
const cli = process.env.THRUPUT_CLI;
if (!cli || !cli.startsWith("/"))
  throw new Error("Set THRUPUT_CLI to the absolute path of a compatible CLI");
const extension = resolve("extension/build");
const directory = await mkdtemp(join(tmpdir(), "freighter-thruput-"));
const probe = createServer();
await new Promise((accept, reject) => {
  probe.once("error", reject);
  probe.listen(9545, "127.0.0.1", accept);
});
await new Promise((accept) => probe.close(accept));
const node = spawn(
  cli,
  ["--non-interactive", "--json", "node", "--ramdb-bytes", "512M"],
  {
    cwd: directory,
    env: { ...process.env, XDG_CONFIG_HOME: join(directory, "config") },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let nodeLog = "";
node.stdout.on("data", (chunk) => {
  nodeLog = (nodeLog + chunk).slice(-16000);
});
node.stderr.on("data", (chunk) => {
  nodeLog = (nodeLog + chunk).slice(-16000);
});
const client = await createGroundhogClient({
  transport: new HttpTransport("http://127.0.0.1:9545", { timeoutMs: 2000 }),
});
let context;
const site = createServer((_, response) => {
  response.setHeader("content-type", "text/html");
  response.end(
    "<!doctype html><title>Thruput wallet acceptance</title><h1>Local wallet fixture</h1>",
  );
});
const delay = (ms) => new Promise((accept) => setTimeout(accept, ms));
try {
  for (let attempt = 0; ; attempt++) {
    if (node.exitCode !== null) throw new Error(`Node exited: ${nodeLog}`);
    try {
      await client.getChainTip();
      break;
    } catch {
      if (attempt >= 60)
        throw new Error(`Local runtime did not become ready: ${nodeLog}`);
      await delay(500);
    }
  }
  assert.equal(
    toHex0x((await client.getNetworkInfo()).networkHash),
    `0x${"0".repeat(64)}`,
  );
  await new Promise((accept) => site.listen(0, "127.0.0.1", accept));
  context = await chromium.launchPersistentContext(join(directory, "browser"), {
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: { width: 460, height: 760 },
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).hostname;
  const wallet = await context.newPage();
  wallet.on("pageerror", (error) =>
    console.error("Wallet page error:", error.message),
  );
  await wallet.goto(`chrome-extension://${extensionId}/index.html#/welcome`);
  // Exercise the real encrypted-vault creation handler without logging its secrets.
  const created = await wallet.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: "CREATE_ACCOUNT",
      password: "disposable-fixture-password",
      isOverwritingAccount: false,
    }),
  );
  assert.ok(created.publicKey, "account creation returned a public key");
  const callWallet = (action, input = {}) =>
    wallet.evaluate(
      async ({ action, input }) => {
        const response = await chrome.runtime.sendMessage({
          type: "THRUPUT_UI",
          action,
          ...input,
        });
        if (response.error) throw new Error(response.error.message);
        return response.result;
      },
      { action, input },
    );
  await callWallet("network", { network: "localnet" });
  await wallet.goto(`chrome-extension://${extensionId}/index.html#/thruput`);
  try {
    await wallet
      .getByRole("heading", { name: "Your Thruput account" })
      .waitFor();
  } catch (error) {
    console.error("Wallet route:", wallet.url());
    console.error(
      "Visible headings:",
      await wallet.locator("h1,h2,[role=alert]").allTextContents(),
    );
    console.error("Public wallet state:", await callWallet("state"));
    throw error;
  }
  const state = await callWallet("state");
  const account = state.accounts[0];
  assert.ok(account.address);
  await callWallet("airdrop", { account: account.address });
  assert.ok(
    (await client.getBalance(addressFromHex(account.address))).rawBalance > 0n,
  );
  await wallet.getByRole("button", { name: "Refresh", exact: true }).click();
  for (const width of [360, 800]) {
    await wallet.setViewportSize({ width, height: 760 });
    assert.equal(
      await wallet.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `wallet overflow at ${width}px`,
    );
    if (process.env.WALLET_SCREENSHOT_DIR) {
      await mkdir(process.env.WALLET_SCREENSHOT_DIR, { recursive: true });
      await wallet.screenshot({
        path: join(process.env.WALLET_SCREENSHOT_DIR, `wallet-${width}.png`),
        fullPage: true,
      });
    }
  }
  await wallet.evaluate(() => localStorage.setItem("i18nextLng", "pt"));
  await wallet.reload();
  await wallet.getByRole("heading", { name: "Sua conta Thruput" }).waitFor();
  await wallet.evaluate(() => localStorage.setItem("i18nextLng", "en"));
  await wallet.reload();
  await wallet.getByRole("heading", { name: "Your Thruput account" }).waitFor();

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${site.address().port}`);
  await page.evaluate(
    () =>
      new Promise((accept) => {
        window.addEventListener("groundhog:announceProvider", (event) => {
          if (event.detail.info.id !== "org.groundhogchain.freighter") return;
          window.walletProvider = event.detail;
          window.walletChanges = [];
          event.detail.on("change", (session) =>
            window.walletChanges.push(session),
          );
          accept();
        });
        window.dispatchEvent(new Event("groundhog:requestProvider"));
      }),
  );
  const invoke = (request) =>
    page.evaluate(
      async (request) => window.walletProvider.request(request),
      request,
    );
  const connectionPage = context.waitForEvent("page");
  const connecting = invoke({ method: "connect" });
  void connecting.catch(() => {});
  const connectPopup = await connectionPage;
  await connectPopup
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  const connected = await connecting;
  assert.equal(connected.accounts[0].address, account.address);
  assert.equal(
    await page.evaluate(() => window.walletChanges.length),
    1,
    "connect change is delivered before response",
  );
  const capability = await invoke({
    method: "getCapabilities",
    params: { account: account.address, networkHash: state.networkHash },
  });
  assert.equal(capability.atomicBatch.maxCalls, 16);

  const publicAccount = {
    address: addressFromHex(account.address),
    authClaim: {
      claim_type: AuthClaimType.kPubkeySignature,
      pubkey_preimage: {
        pubkey: {
          scheme: CryptographicScheme.Ed25519,
          ed25519: ed25519PublicKey(fromHex0x(account.publicKey)),
        },
        nonce: 0n,
      },
    },
  };
  const transaction = await prepareTransaction(client, publicAccount, {
    invocation: defaultWalletAdapter.createRootInvocation(
      publicAccount.address,
      {
        gasLimit: gasAmount(1_000_000n),
        invocation: ERC20.v0_1.transfer.invocation(
          addressFromHex(`0x${"0".repeat(63)}1`),
          gasAmount(500_000n),
          { receiver: publicAccount.address, amount: 1n },
        ),
      },
    ),
  });
  const unsigned = toHex0x(serializeTransaction(transaction));
  const signingPage = context.waitForEvent("page");
  const signing = invoke({
    method: "signTransaction",
    params: {
      account: account.address,
      networkHash: state.networkHash,
      transaction: unsigned,
    },
  });
  void signing.catch(() => {});
  const signPopup = await signingPage;
  if (process.env.REQUIRE_THRUPUT_SIMULATION === "1") {
    await signPopup
      .getByRole("button", { name: "Simulate invocation" })
      .click();
    try {
      await signPopup.getByText("Simulation result", { exact: true }).waitFor();
    } catch (error) {
      console.error(
        "Simulation error:",
        await signPopup.locator("[role=alert]").allTextContents(),
      );
      throw error;
    }
    const simulation = JSON.parse(await signPopup.locator("pre").innerText());
    if (simulation.output.result === "abort") {
      console.error(
        "Decoded simulation abort:",
        DefaultWallet.v0_1.execute.decodeViewOutcome({
          ...simulation,
          height: BigInt(simulation.height),
          gasUsed: BigInt(simulation.gasUsed),
          output: {
            result: "abort",
            abortData: fromHex0x(simulation.output.abortData),
          },
        }),
      );
    }
    assert.equal(
      simulation.output.result,
      "return",
      "authorized wallet-root simulation returns normally",
    );
  }
  await signPopup.getByRole("button", { name: "Approve signature" }).click();
  const signed = await signing;
  await verifySignTransactionResult(
    signed,
    unsigned,
    connected.accounts[0],
    state.networkHash,
  );
  assert.equal(
    await page.evaluate(() => window.walletChanges.length),
    1,
    "signing does not emit a spurious session change",
  );
  const result = await invoke({
    method: "submitTransaction",
    params: {
      account: account.address,
      networkHash: state.networkHash,
      signedTransaction: signed.signedTransaction,
    },
  });
  assert.equal(result.hash, signed.hash);
  const receipt = await client.waitForTransactionReceipt(
    hashFromHex(signed.hash),
    { timeoutMs: 30000 },
  );
  assert.equal(receipt.execResult, ExecResult.ExecResultOK);
  await assert.rejects(
    invoke({
      method: "submitTransaction",
      params: {
        account: account.address,
        networkHash: state.networkHash,
        signedTransaction: signed.signedTransaction,
      },
    }),
  );
  await wallet.close();
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/index.html#/thruput`);
  await reopened.getByText(signed.hash, { exact: true }).waitFor();
  await invoke({ method: "disconnect" });
  assert.equal((await invoke({ method: "getSession" })).accounts.length, 0);
  console.log(
    "PASS: isolated Chrome/localnet account, funding, provider, signature verification, submission, receipt, single-use approval, popup recovery and disconnect",
  );
} finally {
  await context?.close();
  await new Promise((accept) => site.close(accept));
  node.kill("SIGINT");
  await Promise.race([
    new Promise((accept) => node.once("exit", accept)),
    delay(10000),
  ]);
  if (node.exitCode === null) node.kill("SIGKILL");
  await rm(directory, { recursive: true, force: true });
}
