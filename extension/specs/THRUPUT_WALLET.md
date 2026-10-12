# Stellar + Thruput wallet

Tracking: GH-484. Initial target: Chrome, localnet and hosted devnet.

## Integration decisions

The first integration exposes Thruput pubkey accounts controlled by the existing
Freighter software keys. It does not replace the vault, change Stellar
derivation, or reinterpret existing Stellar addresses. Each key has a Stellar
public address and a separately derived Thruput address with account nonce zero.
Hardware accounts remain Stellar-only until their signing protocol is qualified.

The existing account-creation, backup, restore, and import flows continue to own
key material. The Thruput service uses a background-only SDK signer. Neither the
popup nor the page receives private keys. Stellar transaction parsers must never
receive Thruput XDR, even though both protocols use XDR and Ed25519.

Thruput has separate network configuration, permissions, transaction approvals,
assets, and recovery records. Network identity is the protocol network hash,
not a URL or display name. Stellar settings and service calls remain separate.

The provider has its own discovery identity and obeys provider contract 1.0.0.
Signing does not broadcast. Submission consumes the exact approved bytes once,
including ambiguous failures. Losing permission never deletes recovery history.
Transaction outcomes remain associated with their original network and account.

## Recovery compatibility

The prototype uses `m/44'/1'/index'`; Freighter uses Stellar derivation. Restoring
a prototype phrase through the ordinary Stellar recovery flow therefore does
not recover the prototype's keys. Use **Import a Thruput prototype account** on
the Thruput screen after creating or unlocking the main wallet. It supports the
prototype phrase plus an explicit zero-based index, or an imported 32-byte seed.
The import records its source/path in encrypted key metadata, reauthenticates
with the wallet password, and preserves the main wallet's recovery phrase.

Keep the prototype's original phrase or imported-key backup: the main wallet's
phrase does not recover these imported accounts. A golden vector from the
prototype and the real-browser import/backup-preservation check cover this path.

A new fork installation cannot read official Freighter's browser storage. A
release must explain its supported restore/import path. Never copy or mutate
another extension's vault.

## Baseline and verification

Upstream baseline: `a701189d930bee1c75ba2c50059e158197ae17c3` (`master`). Local
`main` starts at that revision; implementation branch is
`feature/gh-484-thruput-wallet`. The Stellar remote is fetch-only.

Initial dependency qualification uses client 0.17.0 and protocol 0.13.0. The
GitHub Packages scope requires a read-packages token supplied through
`GROUNDHOG_NPM_TOKEN`; credentials must not enter tracked files.

Build the public Stellar SDK before the full Jest suite, as the Node compatibility
test imports its compiled package. Use Corepack when the local Yarn shim is not
configured:

```sh
corepack yarn install --immutable
corepack yarn build:freighter-api
corepack yarn test:ci --runInBand
corepack yarn build:extension
```

Provide the ordinary Freighter backend environment variables for builds and
Stellar testing. Synthetic localhost endpoints are sufficient for a compile
check, but are not evidence that Stellar network flows work.

## Manual testing

Load `extension/build` with **Load unpacked** at `chrome://extensions`, with
Developer mode enabled. After each build, reload the extension and reopen its
popup.

Thruput is the default home screen. The visible chain selector opens the Stellar
home when needed. The two homes share the account summary and action-tile
components. On Thruput, the main balance is a native-token quantity without a
ticker suffix, not a fiat total. The asset is labeled **Thruput tokens**.
Swap is disabled. **Request test tokens** is on the home screen above **Add token**.
It uses `requestAirdrop` on both devnet and localnet. **Add** opens Receive;
**Add token** opens only the custom-token form.
**Send** opens the Thruput transfer form; **History** opens activity and recovery.
The options dropdown provides **Copy address**, **Account details** (Receive),
**Settings**, locking, supported sidebar mode, fullscreen mode, and feedback.
The network label opens settings, including network selection and prototype
import. The Stellar home still requires working Freighter backend URLs.

The receive QR encodes only the Thruput address. It does not encode a network or
amount; the sender must select the same network shown in the receive view.
Stellar addresses are not shown in the Thruput receive view or settings.

Start a compatible local RPC before selecting Localnet. On the development
machine, the tested ordinary-node command is:

```sh
~/Work/groundhog-rpc/target/release/thruput node
```

The older `target/debug/groundhog` binary reports CLI 0.22.1 and RPC wire 8.1.0.
The pinned wallet SDK requires wire `>=11.1.0 <12.0.0`; the local release binary
is CLI 0.27.0. A node can start successfully while exposing an incompatible RPC.
Use the newer binary rather than removing the wallet's compatibility check.

The ordinary managed node passes the basic wallet browser acceptance check.
Authorized simulation additionally requires the runtime fix described below.
The temporary runtime override is for simulation qualification, not a prerequisite
for ordinary balance, funding, signing, or submission tests.

## Qualification boundaries

The first end-to-end checkpoint is account selection, HOG balance, dApp connect,
review/sign, submit, and receipt recovery after closing the popup. Expand from
that checkpoint to tracked ERC20 assets, activity, and invocation simulation.

Invocation simulation does not prove admission, replay/expiry validity, attached
code availability, or eventual commitment. It must remain visibly separate from
decoding and committed receipts. Root-address history is not a complete incoming
transfer feed; tracked-token events are required for that coverage.

Production bridging, hardware signing, source-address provider accounts, prices,
and full swap/NFT parity are separate work. Publishing requires owner approval.

## Running the browser acceptance check

After building the extension, use a compatible CLI's absolute path:

```sh
THRUPUT_CLI=/absolute/path/to/thruput node scripts/test-thruput-extension.mjs
```

The harness owns an ephemeral local node, isolated CLI configuration, and fresh
Chromium profile. Port 9545 must be unused. It creates a disposable software
account, requests local test HOG, connects a page through the real provider,
approves and verifies a signature, submits, checks a committed receipt, rejects
repeat submission, and verifies recovery after reopening the wallet. It also
checks narrow/wide layout overflow and Portuguese rendering. No existing browser
profile or wallet is accessed. Set `CHROMIUM_PATH` to override `/usr/bin/chromium`.

Pass `--existing-localnet` to reuse a running compatible node on port 9545.
This mode still creates a disposable browser wallet and requests test funds,
but does not start, stop, or reset the node.

Set `THRUPUT_QR_DECODER` to an absolute `zbarimg` path to decode a screenshot of
the rendered receive QR and compare it with the selected account address.

Set `WALLET_SCREENSHOT_DIR` to capture the public account screen. The harness
does not capture seed phrases or populated password fields.

Invocation simulation qualification is a separate assertion:

```sh
REQUIRE_THRUPUT_SIMULATION=1 THRUPUT_CLI=/absolute/path/to/thruput \
  node scripts/test-thruput-extension.mjs
```

This requires an RPC and runtime that both preserve simulated authorization.
The published client 0.17.0 predates that optional request field; the wallet's
transport adapter adds the public pubkey claim while retaining SDK view decoding.
Remove that adapter when a qualified published client provides the field.
RPC wire 11.2 alone is not evidence that the underlying runtime has the matching
implementation. Managed hog-devnode 0.1.31-rc.2 rejected the valid wallet claim in
the qualification run; the basic signing/submission smoke passed independently.

Authorized simulation subsequently passed with an isolated source build of
`hogd` tag `v0.1.31-rc.2` (`fb65d5333`) plus the implementation change from merged
commit `4f503858c` (PR #4411), served by the source-built Thruput CLI 0.27.0. This
keeps protocol `hogp/be08ba7ce49ccb8` matched without overriding the handshake.
The fixture is a local qualification build, not a published runtime release.
Pass its absolute path through `THRUPUT_DEVNODE_BINARY` when repeating that test.
