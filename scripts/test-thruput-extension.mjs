import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
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
  deriveEntrypointID,
  prepareContractDeployment,
} from "@groundhogchain/client";
import {
  defineContractMethod,
  createContractCodecContext,
  ContractTypeKind,
} from "@groundhogchain/client/contract";
import { ERC20, DefaultWallet } from "@groundhogchain/client/contracts";
import { verifySignTransactionResult } from "@groundhogchain/client/provider";
import {
  AuthClaimType,
  CryptographicScheme,
  ed25519PublicKey,
  gasAmount,
} from "@groundhogchain/protocol";

// Disposable browser profile and test funds only. Never use a user's wallet.
const hosted = process.argv.includes("--devnet");
const existingLocalnet = process.argv.includes("--existing-localnet");
if (hosted && existingLocalnet)
  throw new Error("Choose devnet or existing localnet, not both");
const cli = process.env.THRUPUT_CLI;
if (!hosted && !existingLocalnet && (!cli || !cli.startsWith("/")))
  throw new Error("Set THRUPUT_CLI to the absolute path of a compatible CLI");
const extension = resolve("extension/build");
const directory = await mkdtemp(join(tmpdir(), "freighter-thruput-"));
let node;
if (!hosted && !existingLocalnet) {
  const probe = createServer();
  await new Promise((accept, reject) => {
    probe.once("error", reject);
    probe.listen(9545, "127.0.0.1", accept);
  });
  await new Promise((accept) => probe.close(accept));
  node = spawn(
    cli,
    ["--non-interactive", "--json", "node", "--ramdb-bytes", "512M"],
    {
      cwd: directory,
      env: { ...process.env, XDG_CONFIG_HOME: join(directory, "config") },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}
let nodeLog = "";
node?.stdout.on("data", (chunk) => {
  nodeLog = (nodeLog + chunk).slice(-16000);
});
node?.stderr.on("data", (chunk) => {
  nodeLog = (nodeLog + chunk).slice(-16000);
});
const client = await createGroundhogClient({
  transport: new HttpTransport(
    hosted ? "https://rpc.thruput.network" : "http://127.0.0.1:9545",
    { timeoutMs: hosted ? 15000 : 2000 },
  ),
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
    if (node && node.exitCode !== null)
      throw new Error(`Node exited: ${nodeLog}`);
    try {
      await client.getChainTip();
      break;
    } catch (error) {
      if (hosted || existingLocalnet || attempt >= 60)
        throw new Error(
          `${hosted ? "Hosted devnet is incompatible or unavailable" : "Local runtime did not become ready"}: ${error instanceof Error ? error.message : error}. ${nodeLog}`,
        );
      await delay(500);
    }
  }
  if (!hosted)
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
  await wallet.goto(`chrome-extension://${extensionId}/index.html#/`);
  await wallet.waitForURL("**/index.html#/welcome");
  // Exercise the real encrypted-vault creation handler without logging its secrets.
  const created = await wallet.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: "CREATE_ACCOUNT",
      password: "disposable-fixture-password",
      isOverwritingAccount: false,
    }),
  );
  assert.ok(created.publicKey, "account creation returned a public key");
  const confirmed = await wallet.evaluate(async () => {
    const backup = await chrome.runtime.sendMessage({
      type: "SHOW_BACKUP_PHRASE",
      activePublicKey: null,
      password: "disposable-fixture-password",
    });
    const result = await chrome.runtime.sendMessage({
      type: "CONFIRM_MNEMONIC_PHRASE",
      mnemonicPhraseToConfirm: backup.mnemonicPhrase,
    });
    return result.isCorrectPhrase;
  });
  assert.equal(
    confirmed,
    true,
    "fixture completes the normal onboarding state",
  );
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
  await callWallet("network", { network: hosted ? "devnet" : "localnet" });
  const stellarBalanceRequests = [];
  wallet.on("request", (request) => {
    if (/127\.0\.0\.1:800[01].*balances/.test(request.url()))
      stellarBalanceRequests.push(request.url());
  });
  await wallet.goto(`chrome-extension://${extensionId}/index.html#/`);
  try {
    await wallet.getByRole("heading", { name: "Assets" }).waitFor();
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
  assert.equal(
    state.networkHash,
    toHex0x((await client.getNetworkInfo()).networkHash).slice(2),
  );
  const account = state.accounts[0];
  assert.ok(account.address);
  const backup = () =>
    wallet.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({
        type: "SHOW_BACKUP_PHRASE",
        activePublicKey: null,
        password: "disposable-fixture-password",
      });
      if (response.error) throw new Error("Fixture backup failed");
      return response.mnemonicPhrase;
    });
  const originalBackup = await backup();
  assert.equal(
    await wallet
      .getByRole("button", { name: "Swap", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await wallet.getByLabel("Chain", { exact: true }).inputValue(),
    "thruput",
  );
  await wallet
    .getByRole("button", { name: "View options", exact: true })
    .click();
  await wallet.getByRole("button", { name: "Settings", exact: true }).click();
  await wallet
    .getByText("Import a Thruput prototype account", { exact: true })
    .click();
  await wallet
    .getByLabel("Prototype recovery phrase", { exact: true })
    .fill(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    );
  await wallet
    .getByLabel("Wallet password", { exact: true })
    .fill("disposable-fixture-password");
  await wallet
    .getByRole("button", { name: "Import account", exact: true })
    .click();
  await wallet
    .getByText("Account imported. Select it from the account list.", {
      exact: true,
    })
    .waitFor();
  const imported = (await callWallet("state")).accounts.find(
    (item) =>
      item.address ===
      "0x78f75ea743648e5cba16f3d49314d7b17a7e96fa80d49811218713df036c63d6",
  );
  assert.ok(imported, "prototype import recovers the original address");
  assert.equal(imported.importSource.derivationPath, "m/44'/1'/0'");
  assert.equal(
    originalBackup === (await backup()),
    true,
    "prototype import preserves the primary backup",
  );
  await wallet
    .getByText("Import a Thruput prototype account", { exact: true })
    .click();
  await wallet.getByRole("button", { name: "Back", exact: true }).click();
  const fundingButton = wallet.getByRole("button", {
    name: "Request test tokens",
    exact: true,
  });
  const addTokenButton = wallet.getByRole("button", {
    name: "Add token",
    exact: true,
  });
  await fundingButton.waitFor();
  assert.ok(
    (await fundingButton.boundingBox()).y <
      (await addTokenButton.boundingBox()).y,
  );
  await fundingButton.click();
  await wallet.getByText("Test funding confirmed.", { exact: true }).waitFor();
  assert.ok(
    (await client.getBalance(addressFromHex(account.address))).rawBalance > 0n,
  );
  await wallet.getByRole("button", { name: "Refresh", exact: true }).click();
  await wallet
    .getByTestId("account-view-total-balance")
    .filter({ hasText: /[0-9]/ })
    .waitFor();
  assert.match(
    await wallet.locator(".ThruputHome__balance > div").innerText(),
    /^\d+(?:\.\d+)?$/,
    "home balance has no token suffix",
  );
  await wallet.getByText("Thruput tokens", { exact: true }).waitFor();
  await wallet.getByRole("button", { name: "Add token", exact: true }).click();
  await wallet.getByLabel("Token contract address", { exact: true }).waitFor();
  assert.equal(await wallet.getByTestId("thruput-receive-qr").count(), 0);
  assert.equal(
    await wallet.getByText(account.address, { exact: true }).count(),
    0,
  );
  await wallet.getByRole("button", { name: "Back", exact: true }).click();
  await wallet
    .getByRole("button", { name: "View options", exact: true })
    .click();
  await wallet
    .getByRole("button", { name: "Account details", exact: true })
    .click();
  await wallet.getByTestId("thruput-receive-qr").waitFor();
  assert.equal(
    await wallet.getByLabel("Token contract address", { exact: true }).count(),
    0,
  );
  await wallet.getByRole("button", { name: "Back", exact: true }).click();
  await wallet.getByRole("button", { name: "Add", exact: true }).click();
  await wallet.getByRole("heading", { name: "Receive", exact: true }).waitFor();
  assert.equal(
    await wallet.getByText("Stellar signing key", { exact: true }).count(),
    0,
  );
  assert.equal(
    await wallet.getByText(account.stellarPublicKey, { exact: true }).count(),
    0,
  );
  assert.equal(
    await wallet
      .getByRole("button", { name: "Request test tokens", exact: true })
      .count(),
    0,
  );
  if (process.env.THRUPUT_QR_DECODER) {
    const image = join(directory, "receive-qr.png");
    await wallet.getByTestId("thruput-receive-qr").screenshot({ path: image });
    const decoded = execFileSync(
      process.env.THRUPUT_QR_DECODER,
      ["--quiet", "--raw", image],
      { encoding: "utf8" },
    ).trim();
    assert.equal(
      decoded,
      account.address,
      "rendered QR decodes to the exact Thruput address",
    );
    console.log(
      "PASS: rendered receive QR decodes to the selected account address",
    );
  }
  await wallet.getByRole("button", { name: "Back", exact: true }).click();
  await wallet.getByRole("button", { name: "Send", exact: true }).click();
  await wallet
    .getByLabel("Recipient Thruput address", { exact: true })
    .waitFor();
  await wallet.getByRole("button", { name: "Back", exact: true }).click();
  await wallet.getByRole("heading", { name: "Assets" }).waitFor();
  assert.deepEqual(
    stellarBalanceRequests,
    [],
    "Thruput home does not fetch Stellar balances",
  );
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
      await wallet
        .getByRole("button", { name: "View options", exact: true })
        .click();
      await wallet
        .getByRole("dialog", { name: "View options", exact: true })
        .waitFor();
      await wallet.screenshot({
        path: join(process.env.WALLET_SCREENSHOT_DIR, `options-${width}.png`),
        fullPage: true,
      });
      await wallet.keyboard.press("Escape");
      assert.equal(
        await wallet
          .getByRole("dialog", { name: "View options", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await wallet
          .getByRole("button", { name: "View options", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
    }
  }
  await wallet.evaluate(() => localStorage.setItem("i18nextLng", "pt"));
  await wallet.reload();
  await wallet
    .getByRole("button", { name: "Adicionar", exact: true })
    .waitFor();
  await wallet.evaluate(() => localStorage.setItem("i18nextLng", "en"));
  await wallet.reload();
  await wallet.getByRole("heading", { name: "Assets" }).waitFor();

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
  await wallet
    .getByRole("button", { name: "View options", exact: true })
    .click();
  await wallet
    .getByRole("button", { name: "Lock Freighter", exact: true })
    .click();
  await wallet.getByRole("button", { name: "Unlock", exact: true }).waitFor();
  const connectionPage = context.waitForEvent("page");
  const connecting = invoke({ method: "connect" });
  void connecting.catch(() => {});
  const connectPopup = await connectionPage;
  await connectPopup
    .locator('input[type="password"]')
    .fill("disposable-fixture-password");
  await connectPopup
    .getByRole("button", { name: "Unlock", exact: true })
    .click();
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
  const approveAndSubmit = async (transaction, expectSuccess = true) => {
    const unsigned = toHex0x(serializeTransaction(transaction));
    const opened = context.waitForEvent("page");
    const pending = invoke({
      method: "signTransaction",
      params: {
        account: account.address,
        networkHash: state.networkHash,
        transaction: unsigned,
      },
    });
    void pending.catch(() => {});
    const popup = await opened;
    await popup
      .getByRole("button", { name: "Approve signature", exact: true })
      .click();
    const signed = await pending;
    await verifySignTransactionResult(
      signed,
      unsigned,
      connected.accounts[0],
      state.networkHash,
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
      hashFromHex(result.hash),
      { timeoutMs: 30000 },
    );
    assert.equal(receipt.execResult === ExecResult.ExecResultOK, expectSuccess);
    return receipt;
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
  if (process.env.THRUPUT_COUNTER_ARTIFACT) {
    const deployment = prepareContractDeployment({
      deployer: publicAccount.address,
      contract: new Uint8Array(
        await readFile(process.env.THRUPUT_COUNTER_ARTIFACT),
      ),
    });
    const codecs = createContractCodecContext([]);
    const method = (name, args = [], result = ContractTypeKind.Void) =>
      defineContractMethod({
        interfaceName: "Counter",
        interfaceVersion: "0.1.0",
        abiName: name,
        publicName: name,
        entrypoint: deriveEntrypointID("Counter", "0.1.0", name),
        args: args.map((name) => ({
          abiName: name,
          publicName: name,
          type: { v: ContractTypeKind.U64 },
        })),
        returnType: { v: result },
        throws: [],
        codecs,
      });
    const initialize = method("initialize", ["initial_value"]);
    const increment = method("increment", ["amount"]);
    const get = method("get", [], ContractTypeKind.U64);
    const error = method("error", [], ContractTypeKind.U64);
    const readCommittedCounter = async (receipt) => {
      const deadline = Date.now() + 30000;
      // Receipt indexing may lead the independently refreshed view snapshot.
      for (;;) {
        const view = await get.view({ client, contract: deployment.address });
        if (view.height >= receipt.height) return view.value;
        assert.ok(
          Date.now() < deadline,
          "view snapshot did not reach receipt height",
        );
        await delay(100);
      }
    };
    const deployed = await approveAndSubmit(
      await prepareTransaction(client, publicAccount, {
        invocation: defaultWalletAdapter.createDeploymentInvocation(
          publicAccount.address,
          deployment,
          {
            gasLimit: gasAmount(2_000_000n),
            amount: 10_000_000n,
            initializer: initialize.invocation(
              deployment.address,
              gasAmount(500_000n),
              { initial_value: 10n },
            ),
          },
        ),
        contractsToDeploy: [deployment.contract],
      }),
    );
    assert.equal(
      toHex0x(DefaultWallet.v0_1.deploy.decodeReceipt(deployed).value),
      toHex0x(deployment.address),
    );
    assert.equal(await readCommittedCounter(deployed), 10n);
    const batch = async (calls, success) =>
      approveAndSubmit(
        await prepareTransaction(client, publicAccount, {
          invocation: defaultWalletAdapter.createBatchRootInvocation(
            publicAccount.address,
            { gasLimit: gasAmount(2_000_000n), invocations: calls },
          ),
        }),
        success,
      );
    const incremented = await batch(
      [
        increment.invocation(deployment.address, gasAmount(500_000n), {
          amount: 2n,
        }),
        increment.invocation(deployment.address, gasAmount(500_000n), {
          amount: 3n,
        }),
      ],
      true,
    );
    assert.equal(await readCommittedCounter(incremented), 15n);
    const aborted = await batch(
      [
        increment.invocation(deployment.address, gasAmount(500_000n), {
          amount: 100n,
        }),
        error.invocation(deployment.address, gasAmount(500_000n)),
      ],
      false,
    );
    assert.equal(
      await readCommittedCounter(aborted),
      15n,
      "a later abort rolls back earlier batch calls",
    );
    console.log(
      "PASS: counter deployment with initialization, atomic two-call execution, and abort rollback",
    );
  }
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
  await reopened.goto(`chrome-extension://${extensionId}/index.html#/`);
  await reopened.getByRole("button", { name: "History", exact: true }).click();
  await reopened.getByText(signed.hash, { exact: true }).waitFor();
  await invoke({ method: "disconnect" });
  assert.equal((await invoke({ method: "getSession" })).accounts.length, 0);
  console.log(
    `PASS: isolated Chrome/${hosted ? "devnet" : "localnet"} account, prototype recovery, funding, provider, signature verification, submission, receipt, single-use approval, popup recovery and disconnect${process.env.REQUIRE_THRUPUT_SIMULATION === "1" ? ", authorized simulation" : ""}`,
  );
} finally {
  await context?.close();
  await new Promise((accept) => site.close(accept));
  if (node) {
    node.kill("SIGINT");
    await Promise.race([
      new Promise((accept) => node.once("exit", accept)),
      delay(10000),
    ]);
    if (node.exitCode === null) node.kill("SIGKILL");
  }
  await rm(directory, { recursive: true, force: true });
}
