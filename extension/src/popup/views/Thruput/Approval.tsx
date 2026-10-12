import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@stellar/design-system";
import { thruputRequest } from "popup/helpers/thruput";
import { ThruputUiAction, type ThruputPendingReview } from "thruput/types";
import { TransactionReview } from "./TransactionReview";

export const Approval = ({ id }: { id: string }) => {
  const { t } = useTranslation();
  const [review, setReview] = useState<ThruputPendingReview>();
  const [accounts, setAccounts] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [simulation, setSimulation] = useState<string>();
  useEffect(() => {
    let live = true;
    void thruputRequest<ThruputPendingReview>(ThruputUiAction.APPROVAL, { id })
      .then((value) => {
        if (live) {
          setReview(value);
          setAccounts(value.accounts.slice(0, 1).map((a) => a.address));
        }
      })
      .catch((cause: unknown) => {
        if (live)
          setError(
            cause instanceof Error ? cause.message : "Wallet request failed",
          );
      });
    return () => {
      live = false;
    };
  }, [id]);
  const decide = async (accepted: boolean) => {
    setBusy(true);
    setError("");
    try {
      await thruputRequest(ThruputUiAction.DECIDE, { id, accepted, accounts });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Wallet request failed",
      );
    } finally {
      setBusy(false);
    }
  };
  const simulate = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await thruputRequest(ThruputUiAction.SIMULATE, {
        id,
        account: review?.account,
      });
      setSimulation(JSON.stringify(result, null, 2));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Wallet request failed",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="Thruput">
      <h1>
        {review?.transaction
          ? t("Review Thruput transaction")
          : t("Connect to Thruput")}
      </h1>
      {error ? (
        <p role="alert" className="Thruput__notice">
          {t(error)}
        </p>
      ) : null}
      {review ? (
        <>
          <p className="Thruput__address">{review.origin}</p>
          <details>
            <summary>{t("Network identity")}</summary>
            <p className="Thruput__address">{review.networkHash}</p>
          </details>
          {review.transaction ? (
            <>
              <TransactionReview review={review.transaction} />
              <Button
                type="button"
                size="md"
                variant="secondary"
                disabled={busy}
                onClick={simulate}
              >
                {t("Simulate invocation")}
              </Button>
              {simulation ? (
                <details open>
                  <summary>{t("Simulation result")}</summary>
                  <p>
                    {t(
                      "Simulation uses a snapshot. It does not guarantee submission or execution.",
                    )}
                  </p>
                  <pre>{simulation}</pre>
                </details>
              ) : null}
            </>
          ) : (
            <fieldset>
              <legend>{t("Accounts to share")}</legend>
              {review.accounts.map((account) => (
                <label
                  className="Thruput__account-choice"
                  key={account.address}
                >
                  <input
                    type="checkbox"
                    name="accounts"
                    value={account.address}
                    checked={accounts.includes(account.address)}
                    onChange={(event) =>
                      setAccounts(
                        event.target.checked
                          ? [...accounts, account.address]
                          : accounts.filter((a) => a !== account.address),
                      )
                    }
                  />
                  <span>
                    {account.name}
                    <span className="Thruput__address">{account.address}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="Thruput__actions">
            <Button
              type="button"
              size="md"
              variant="secondary"
              disabled={busy}
              onClick={() => decide(false)}
            >
              {t("Reject")}
            </Button>
            <Button
              type="button"
              size="md"
              variant="primary"
              disabled={busy || (!review.transaction && !accounts.length)}
              onClick={() => decide(true)}
            >
              {review.transaction ? t("Approve signature") : t("Connect")}
            </Button>
          </div>
        </>
      ) : (
        <p role="status">{t("Loading request…")}</p>
      )}
    </div>
  );
};
