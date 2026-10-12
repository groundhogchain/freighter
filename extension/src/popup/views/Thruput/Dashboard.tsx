import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, CopyText } from "@stellar/design-system";
import { QRCodeSVG } from "qrcode.react";
import { formatUnits } from "@groundhogchain/client";
import { useNavigate } from "react-router-dom";
import { View } from "popup/basics/layout/View";
import { ROUTES } from "popup/constants/routes";
import { IdenticonImg } from "popup/components/identicons/IdenticonImg";
import { thruputRequest } from "popup/helpers/thruput";
import type { ThruputAccount } from "thruput/accounts";
import {
  HOG_TOKEN,
  ThruputNetwork,
  THRUPUT_NETWORKS,
  type ThruputToken,
} from "thruput/networks";
import { mergeThruputHistory } from "thruput/history";
import {
  ThruputOutcome,
  ThruputUiAction,
  ThruputHistoryKind,
  type ThruputHistoryPage,
  type ThruputBalance,
  type ThruputState,
  type ThruputOutgoing,
} from "thruput/types";
import { HomeHeader, ThruputPanel } from "./HomeHeader";
import { ImportAccount } from "./ImportAccount";

const recoveryKey = (record: ThruputOutgoing) =>
  `${record.networkHash}:${record.hash}`;

export const Dashboard = ({
  state,
  account,
  refresh,
}: {
  state: ThruputState;
  account: ThruputAccount;
  refresh: () => Promise<void>;
}) => {
  const { t } = useTranslation();
  const tokenLabel = (asset: ThruputToken) =>
    asset.address === HOG_TOKEN.address ? t("Thruput tokens") : asset.symbol;
  const navigate = useNavigate();
  const [panel, setPanel] = useState(ThruputPanel.TOKENS);
  const [balances, setBalances] = useState<ThruputBalance[]>();
  const [history, setHistory] = useState<ThruputHistoryPage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [token, setToken] = useState(HOG_TOKEN.address);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void thruputRequest<ThruputBalance[]>(ThruputUiAction.PORTFOLIO, {
      account: account.address,
    })
      .then((result) => {
        if (live.current) setBalances(result);
      })
      .catch((cause: unknown) => {
        if (live.current)
          setError(
            cause instanceof Error
              ? t(cause.message)
              : t("Balances could not be loaded."),
          );
      });
    return () => {
      live.current = false;
    };
  }, [account.address, t]);

  const updateBalances = async () => {
    const result = await thruputRequest<ThruputBalance[]>(
      ThruputUiAction.PORTFOLIO,
      { account: account.address },
    );
    if (live.current) setBalances(result);
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      if (live.current)
        setError(
          cause instanceof Error
            ? t(cause.message)
            : t("Wallet request failed"),
        );
    } finally {
      if (live.current) {
        setBusy(false);
        void refresh();
      }
    }
  };
  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const prepared = await thruputRequest<{
        transaction: string;
        networkHash: string;
      }>(ThruputUiAction.PREPARE_TRANSFER, {
        account: account.address,
        token,
        recipient: form.get("recipient"),
        amount: form.get("amount"),
      });
      if (!live.current) return;
      const result = await thruputRequest<{ hash: string }>(
        ThruputUiAction.SEND,
        { account: account.address, ...prepared },
      );
      if (live.current)
        setNotice(
          t("Submitted {{hash}}. Check its status below.", {
            hash: result.hash,
          }),
        );
    });
  };
  const addToken = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      await thruputRequest(ThruputUiAction.ADD_TOKEN, {
        account: account.address,
        token: form.get("token"),
      });
      await updateBalances();
    });
  };
  const outcome = {
    [ThruputOutcome.UNKNOWN]: t("Outcome unknown"),
    [ThruputOutcome.SUBMITTED]: t("Awaiting confirmation"),
    [ThruputOutcome.CONFIRMED]: t("Confirmed"),
    [ThruputOutcome.FAILED]: t("Execution failed"),
  };
  const outgoing = state.outgoing.filter(
    (record) => record.account === account.address,
  );
  const hog = balances?.find((asset) => asset.address === HOG_TOKEN.address);
  const hogBalance =
    hog?.balance === undefined
      ? "—"
      : formatUnits(BigInt(hog.balance), HOG_TOKEN.decimals);
  return (
    <>
      <HomeHeader
        state={state}
        account={account}
        balance={hogBalance}
        panel={panel}
        onPanel={setPanel}
        busy={busy}
        onAccount={(address) => {
          void run(async () => {
            await thruputRequest(ThruputUiAction.SELECT_ACCOUNT, {
              account: address,
            });
            await refresh();
          });
        }}
      />
      <View.Content hasNoTopPadding>
        <main className="Thruput ThruputHome" aria-busy={busy}>
          {panel === ThruputPanel.SETTINGS ? (
            <>
              <div className="Thruput__selector">
                <label htmlFor="thruput-network">{t("Network")}</label>
                <select
                  id="thruput-network"
                  name="network"
                  value={state.network}
                  disabled={busy}
                  onChange={(event) => {
                    const network = event.target.value;
                    void run(async () => {
                      await thruputRequest(ThruputUiAction.NETWORK, {
                        network,
                      });
                    });
                  }}
                >
                  <option value={ThruputNetwork.DEVNET}>
                    {t("Thruput Devnet")}
                  </option>
                  <option value={ThruputNetwork.LOCALNET}>
                    {t("Thruput Localnet")}
                  </option>
                </select>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => navigate(ROUTES.wallets)}
              >
                {t("Manage accounts")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => navigate(ROUTES.settings)}
              >
                {t("Wallet settings")}
              </Button>
              <details>
                <summary>{t("Technical account details")}</summary>
                <dl>
                  <dt>{t("Network identity")}</dt>
                  <dd className="Thruput__address">{state.networkHash}</dd>
                  {account.importSource ? (
                    <>
                      <dt>{t("Imported account")}</dt>
                      <dd>
                        {account.importSource.derivationPath ||
                          t("Raw private-key seed")}
                      </dd>
                    </>
                  ) : null}
                </dl>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await thruputRequest(ThruputUiAction.NETWORK, {
                        network: state.network,
                      });
                      if (live.current)
                        setNotice(
                          t("Network identity refreshed. Reconnect your apps."),
                        );
                    })
                  }
                >
                  {t("Refresh network identity after a reset")}
                </Button>
              </details>
            </>
          ) : null}
          {panel === ThruputPanel.ADD ? (
            <p className="Thruput__muted">
              {t("Experimental network. Test tokens have no monetary value.")}
            </p>
          ) : null}
          {error ? (
            <p className="Thruput__notice" role="alert">
              {t(error)}
            </p>
          ) : null}
          {notice ? (
            <p className="Thruput__notice Thruput__address" role="status">
              {notice}
            </p>
          ) : null}
          {panel === ThruputPanel.ADD ? (
            <section>
              <h1>{t("Receive")}</h1>
              <CopyText textToCopy={account.address} doneLabel={t("Copied!")}>
                <p className="Thruput__address">{account.address}</p>
              </CopyText>
              <div className="Thruput__qr" data-testid="thruput-receive-qr">
                <QRCodeSVG
                  value={account.address}
                  size={160}
                  marginSize={4}
                  role="img"
                  aria-label={t("Thruput address QR code")}
                />
              </div>
              <p>
                {state.network === ThruputNetwork.LOCALNET
                  ? t("Thruput Localnet")
                  : t("Thruput Devnet")}
              </p>
              <p className="Thruput__muted">
                {t(
                  "This QR code contains only your Thruput address. Select the same network in the sending wallet.",
                )}
              </p>
            </section>
          ) : null}
          {panel === ThruputPanel.TOKENS ? (
            <section>
              <div className="Thruput__row">
                <h2>{t("Assets")}</h2>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => run(updateBalances)}
                >
                  {t("Refresh")}
                </Button>
              </div>
              {!balances && !error ? (
                <p role="status">{t("Loading balances…")}</p>
              ) : (
                <ul role="list" className="Thruput__list">
                  {balances?.map((asset) => (
                    <li key={asset.address}>
                      <div className="Thruput__row">
                        <div className="ThruputHome__asset">
                          <div className="ThruputHome__asset-icon">
                            {asset.address === HOG_TOKEN.address ? (
                              <span aria-hidden="true">T</span>
                            ) : (
                              <IdenticonImg publicKey={asset.address} />
                            )}
                          </div>
                          <div>
                            <div>{tokenLabel(asset)}</div>
                            {asset.address !== HOG_TOKEN.address ? (
                              <div className="Thruput__muted">
                                {`${asset.address.slice(0, 6)}…${asset.address.slice(-4)}`}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="ThruputHome__asset-balance">
                          {asset.balance === undefined
                            ? t("Unavailable")
                            : formatUnits(
                                BigInt(asset.balance),
                                asset.decimals,
                              )}
                        </div>
                      </div>
                      <details>
                        <summary>{t("Token details")}</summary>
                        <p className="Thruput__address">{asset.address}</p>
                        {asset.address !== HOG_TOKEN.address ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await thruputRequest(
                                  ThruputUiAction.REMOVE_TOKEN,
                                  {
                                    account: account.address,
                                    token: asset.address,
                                  },
                                );
                                setToken(HOG_TOKEN.address);
                                await updateBalances();
                              })
                            }
                          >
                            {t("Stop tracking token")}
                          </Button>
                        ) : null}
                      </details>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await thruputRequest(ThruputUiAction.AIRDROP, {
                      account: account.address,
                    });
                    await updateBalances();
                    if (live.current) setNotice(t("Test funding confirmed."));
                  })
                }
              >
                {t("Request test tokens")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setPanel(ThruputPanel.ADD)}
              >
                {t("Add token")}
              </Button>
            </section>
          ) : null}
          {panel === ThruputPanel.ADD ? (
            <section>
              <details>
                <summary>{t("Track a token")}</summary>
                <form onSubmit={addToken}>
                  <label htmlFor="thruput-token-address">
                    {t("Token contract address")}
                  </label>
                  <input
                    id="thruput-token-address"
                    name="token"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="0x…"
                  />
                  <p className="Thruput__muted">
                    {t(
                      "Token names and symbols are supplied by the contract and are not verified.",
                    )}
                  </p>
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                  >
                    {t("Add token")}
                  </Button>
                </form>
              </details>
            </section>
          ) : null}
          {panel === ThruputPanel.SEND ? (
            <section>
              <h2>{t("Send")}</h2>
              <form onSubmit={send}>
                <label htmlFor="thruput-send-token">{t("Asset")}</label>
                <select
                  id="thruput-send-token"
                  name="asset"
                  value={token}
                  disabled={busy}
                  onChange={(event) => setToken(event.target.value)}
                >
                  {(balances || [HOG_TOKEN]).map((asset) => (
                    <option key={asset.address} value={asset.address}>
                      {tokenLabel(asset)}
                    </option>
                  ))}
                </select>
                <label htmlFor="thruput-recipient">
                  {t("Recipient Thruput address")}
                </label>
                <input
                  id="thruput-recipient"
                  name="recipient"
                  required
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="0x…"
                />
                <label htmlFor="thruput-amount">{t("Amount")}</label>
                <input
                  id="thruput-amount"
                  name="amount"
                  required
                  disabled={busy}
                  inputMode="decimal"
                  autoComplete="off"
                />
                <p className="Thruput__muted">
                  {t(
                    "No gas fee. Available Thruput tokens provide scheduling capacity and fund storage deposits.",
                  )}
                </p>
                <Button
                  type="submit"
                  size="md"
                  variant="primary"
                  disabled={busy}
                >
                  {busy ? t("Working…") : t("Review transfer")}
                </Button>
              </form>
            </section>
          ) : null}
          {panel === ThruputPanel.ACTIVITY ? (
            <>
              <section>
                <h2>{t("Transaction recovery")}</h2>
                <p className="Thruput__muted">
                  {t(
                    "Submission is not confirmation. Check the original hash before sending a replacement.",
                  )}
                </p>
                {!outgoing.length ? (
                  <p>{t("No outgoing transactions for this account.")}</p>
                ) : (
                  <ul role="list" className="Thruput__list">
                    {outgoing.map((record) => (
                      <li key={recoveryKey(record)}>
                        <p>{outcome[record.outcome]}</p>
                        <p>{THRUPUT_NETWORKS[record.network].name}</p>
                        <details>
                          <summary>{t("Original network identity")}</summary>
                          <p className="Thruput__address">
                            {record.networkHash}
                          </p>
                        </details>
                        <p className="Thruput__address">{record.hash}</p>
                        {record.diagnostic ? <p>{record.diagnostic}</p> : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await thruputRequest(ThruputUiAction.OBSERVE, {
                                hash: record.hash,
                                networkHash: record.networkHash,
                              });
                              await updateBalances();
                            })
                          }
                        >
                          {t("Check status")}
                        </Button>
                        <details>
                          <summary>{t("Remove recovery record")}</summary>
                          <label className="Thruput__account-choice">
                            <input
                              type="checkbox"
                              name={`ack-${recoveryKey(record)}`}
                              checked={acknowledged.includes(
                                recoveryKey(record),
                              )}
                              onChange={(event) =>
                                setAcknowledged(
                                  event.target.checked
                                    ? [...acknowledged, recoveryKey(record)]
                                    : acknowledged.filter(
                                        (hash) => hash !== recoveryKey(record),
                                      ),
                                )
                              }
                            />
                            <span>
                              {t(
                                "I have checked this transaction and understand that an unresolved transfer may still execute.",
                              )}
                            </span>
                          </label>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={
                              busy ||
                              !acknowledged.includes(recoveryKey(record))
                            }
                            onClick={() =>
                              run(async () => {
                                await thruputRequest(
                                  ThruputUiAction.ACKNOWLEDGE,
                                  {
                                    hash: record.hash,
                                    networkHash: record.networkHash,
                                    confirmRisk: true,
                                  },
                                );
                              })
                            }
                          >
                            {t("Remove record")}
                          </Button>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h2>{t("Recent activity")}</h2>
                <p className="Thruput__muted">
                  {t(
                    "Shows recent account transactions and incoming transfers for tracked tokens. This is not a complete portfolio history.",
                  )}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await thruputRequest<ThruputHistoryPage>(
                        ThruputUiAction.HISTORY,
                        {
                          account: account.address,
                          networkHash: state.networkHash,
                        },
                      );
                      if (live.current)
                        setHistory({
                          ...result,
                          rows: mergeThruputHistory([], result.rows),
                        });
                    })
                  }
                >
                  {t("Load recent activity")}
                </Button>
                {history ? (
                  <ul role="list" className="Thruput__list">
                    {history.rows.map((record) => (
                      <li key={record.id}>
                        <p>
                          {record.kind === ThruputHistoryKind.RECEIVED &&
                          record.token &&
                          record.rawAmount !== undefined
                            ? t("Received {{amount}} {{symbol}}", {
                                amount: formatUnits(
                                  BigInt(record.rawAmount),
                                  record.token.decimals,
                                ),
                                symbol: tokenLabel(record.token),
                              })
                            : t("Account transaction at block {{height}}", {
                                height: record.height,
                              })}
                        </p>
                        <p className="Thruput__address">{record.hash}</p>
                      </li>
                    ))}
                    {history.unavailable.map((source) => (
                      <li key={source}>
                        {t("{{symbol}} transfer history unavailable", {
                          symbol: source,
                        })}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {history?.hasMore ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await thruputRequest<ThruputHistoryPage>(
                          ThruputUiAction.HISTORY,
                          {
                            account: account.address,
                            networkHash: state.networkHash,
                            cursors: history.cursors,
                          },
                        );
                        if (live.current)
                          setHistory((previous) => ({
                            ...result,
                            rows: mergeThruputHistory(
                              previous?.rows || [],
                              result.rows,
                            ),
                          }));
                      })
                    }
                  >
                    {t("Load more activity or retry unavailable sources")}
                  </Button>
                ) : null}
                {history?.coverage.length ? (
                  <details>
                    <summary>{t("History coverage")}</summary>
                    <ul role="list" className="Thruput__list">
                      {history.coverage.map((coverage) => (
                        <li key={coverage.source}>
                          <p className="Thruput__address">{coverage.source}</p>
                          <p>
                            {t(
                              "Indexer retains blocks {{oldest}} to {{latest}}.",
                              {
                                oldest: coverage.oldestBlock,
                                latest: coverage.latestBlock,
                              },
                            )}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
            </>
          ) : null}
          {panel === ThruputPanel.SETTINGS ? (
            <>
              <section>
                <h2>{t("Connected apps")}</h2>
                {!state.sites.length ? (
                  <p>{t("No connected Thruput apps.")}</p>
                ) : (
                  <ul role="list" className="Thruput__list">
                    {state.sites.map((origin) => (
                      <li key={origin}>
                        <p className="Thruput__address">{origin}</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await thruputRequest(ThruputUiAction.REVOKE, {
                                origin,
                              });
                            })
                          }
                        >
                          {t("Disconnect")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <ImportAccount refresh={refresh} />
            </>
          ) : null}
        </main>
      </View.Content>
    </>
  );
};
