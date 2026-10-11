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
not recover the prototype's keys. Explicit prototype recovery/import must retain
its derivation version, and imported keys need their own backup. Do not advertise
prototype phrase compatibility until that path has acceptance-test evidence.

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
