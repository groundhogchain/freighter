import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, CopyText } from "@stellar/design-system";
import { QRCodeSVG } from "qrcode.react";
import { formatUnits } from "@groundhogchain/client";
import { thruputRequest } from "popup/helpers/thruput";
import type { ThruputAccount } from "thruput/accounts";
import { HOG_TOKEN, ThruputNetwork, type ThruputToken } from "thruput/networks";
import {
  ThruputOutcome,
  ThruputUiAction,
  type ThruputBalance,
  type ThruputState,
} from "thruput/types";

interface History {
  history: {
    refs: { txHash: string; height: string }[];
    oldestBlock: string;
    latestBlock: string;
  };
  incoming: {
    token: ThruputToken;
    unavailable?: boolean;
    events: {
      txHash: string;
      sequenceNumber: number;
      fields: { amount: string };
    }[];
  }[];
}

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
  const [balances, setBalances] = useState<ThruputBalance[]>();
  const [history, setHistory] = useState<History>();
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
      .catch(() => {
        if (live.current) setError(t("Balances could not be loaded."));
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
          cause instanceof Error ? cause.message : t("Wallet request failed"),
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
    (record) =>
      record.account === account.address &&
      record.networkHash === state.networkHash,
  );
  return (
    <main className="Thruput" aria-busy={busy}>
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
              await thruputRequest(ThruputUiAction.NETWORK, { network });
            });
          }}
        >
          <option value={ThruputNetwork.DEVNET}>{t("Thruput Devnet")}</option>
          <option value={ThruputNetwork.LOCALNET}>
            {t("Thruput Localnet")}
          </option>
        </select>
      </div>
      <p className="Thruput__muted">
        {t("Experimental network. Test tokens have no monetary value.")}
      </p>
      {error ? (
        <p className="Thruput__notice" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="Thruput__notice Thruput__address" role="status">
          {notice}
        </p>
      ) : null}
      <section>
        <h1>{t("Your Thruput account")}</h1>
        <CopyText textToCopy={account.address} doneLabel={t("Copied!")}>
          <p className="Thruput__address">{account.address}</p>
        </CopyText>
        <details>
          <summary>{t("Receive and account details")}</summary>
          <div className="Thruput__qr">
            <QRCodeSVG value={account.address} size={160} />
          </div>
          <dl>
            <dt>{t("Stellar signing key")}</dt>
            <dd className="Thruput__address">{account.stellarPublicKey}</dd>
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
      </section>
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
        {!balances ? (
          <p role="status">{t("Loading balances…")}</p>
        ) : (
          <ul role="list" className="Thruput__list">
            {balances.map((asset) => (
              <li key={asset.address}>
                <div className="Thruput__row">
                  <span>{asset.symbol}</span>
                  <span>
                    {asset.balance === undefined
                      ? t("Unavailable")
                      : formatUnits(BigInt(asset.balance), asset.decimals)}
                  </span>
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
                          await thruputRequest(ThruputUiAction.REMOVE_TOKEN, {
                            account: account.address,
                            token: asset.address,
                          });
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
          {t("Request test HOG")}
        </Button>
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
            <Button type="submit" size="sm" variant="secondary" disabled={busy}>
              {t("Add token")}
            </Button>
          </form>
        </details>
      </section>
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
                {asset.symbol}
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
              "No gas fee. Free HOG provides scheduling capacity and funds storage deposits.",
            )}
          </p>
          <Button type="submit" size="md" variant="primary" disabled={busy}>
            {busy ? t("Working…") : t("Review transfer")}
          </Button>
        </form>
      </section>
      <section>
        <h2>{t("Transaction recovery")}</h2>
        <p className="Thruput__muted">
          {t(
            "Submission is not confirmation. Check the original hash before sending a replacement.",
          )}
        </p>
        {!outgoing.length ? (
          <p>{t("No outgoing transactions on this network.")}</p>
        ) : (
          <ul role="list" className="Thruput__list">
            {outgoing.map((record) => (
              <li key={record.hash}>
                <p>{outcome[record.outcome]}</p>
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
                      name={`ack-${record.hash}`}
                      checked={acknowledged.includes(record.hash)}
                      onChange={(event) =>
                        setAcknowledged(
                          event.target.checked
                            ? [...acknowledged, record.hash]
                            : acknowledged.filter(
                                (hash) => hash !== record.hash,
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
                    disabled={busy || !acknowledged.includes(record.hash)}
                    onClick={() =>
                      run(async () => {
                        await thruputRequest(ThruputUiAction.ACKNOWLEDGE, {
                          hash: record.hash,
                          networkHash: record.networkHash,
                          confirmRisk: true,
                        });
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
              const result = await thruputRequest<History>(
                ThruputUiAction.HISTORY,
                { account: account.address },
              );
              if (live.current) setHistory(result);
            })
          }
        >
          {t("Load recent activity")}
        </Button>
        {history ? (
          <ul role="list" className="Thruput__list">
            {history.history.refs.map((record) => (
              <li key={record.txHash}>
                <p>
                  {t("Account transaction at block {{height}}", {
                    height: record.height,
                  })}
                </p>
                <p className="Thruput__address">{record.txHash}</p>
              </li>
            ))}
            {history.incoming.flatMap((entry) =>
              entry.unavailable
                ? [
                    <li key={entry.token.address}>
                      {t("{{symbol}} transfer history unavailable", {
                        symbol: entry.token.symbol,
                      })}
                    </li>,
                  ]
                : entry.events.map((event) => (
                    <li key={`${event.txHash}:${event.sequenceNumber}`}>
                      <p>
                        {t("Received {{amount}} {{symbol}}", {
                          amount: formatUnits(
                            BigInt(event.fields.amount),
                            entry.token.decimals,
                          ),
                          symbol: entry.token.symbol,
                        })}
                      </p>
                      <p className="Thruput__address">{event.txHash}</p>
                    </li>
                  )),
            )}
          </ul>
        ) : null}
      </section>
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
                      await thruputRequest(ThruputUiAction.REVOKE, { origin });
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
    </main>
  );
};
