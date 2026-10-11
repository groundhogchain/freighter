import React from "react";
import { useTranslation } from "react-i18next";
import type { ThruputTransactionReview } from "thruput/transactions";

export const TransactionReview = ({
  review,
}: {
  review: ThruputTransactionReview;
}) => {
  const { t } = useTranslation();
  return (
    <section className="Thruput__review">
      <p className="Thruput__notice">
        {t(
          "Decoded calls are not verified effects. Only approve contracts you trust.",
        )}
      </p>
      <dl>
        <dt>{t("Wallet method")}</dt>
        <dd>DefaultWallet.{review.method}</dd>
        <dt>{t("Thruput address")}</dt>
        <dd className="Thruput__address">{review.root}</dd>
        <dt>{t("Execution budget")}</dt>
        <dd>{review.gasLimit}</dd>
        <dt>{t("Expires at block")}</dt>
        <dd>{review.expiryHeight}</dd>
        <dt>{t("Transaction nonce")}</dt>
        <dd>{review.nonce}</dd>
      </dl>
      {review.deployment ? (
        <dl>
          <dt>{t("Contract hash")}</dt>
          <dd className="Thruput__address">{review.deployment.contractHash}</dd>
          <dt>{t("Deployment nonce")}</dt>
          <dd className="Thruput__address">{review.deployment.nonce}</dd>
          <dt>{t("Funding in HOG base units")}</dt>
          <dd>{review.deployment.rawFunding}</dd>
        </dl>
      ) : null}
      {review.calls.map((call, index) => (
        <section className="Thruput__call" key={index}>
          <h3>{t("Call {{number}}", { number: index + 1 })}</h3>
          <dl>
            <dt>{t("Contract")}</dt>
            <dd className="Thruput__address">{call.target}</dd>
            <dt>{t("Entrypoint")}</dt>
            <dd className="Thruput__address">{call.entrypoint}</dd>
            <dt>{t("Execution budget")}</dt>
            <dd>{call.gasLimit}</dd>
            {call.transfer ? (
              <>
                <dt>{t("Decoded transfer recipient")}</dt>
                <dd className="Thruput__address">{call.transfer.recipient}</dd>
                <dt>{t("Amount in token base units")}</dt>
                <dd>{call.transfer.rawAmount}</dd>
              </>
            ) : null}
          </dl>
          <details>
            <summary>{t("Raw call data")}</summary>
            <p className="Thruput__address">{call.calldata}</p>
          </details>
        </section>
      ))}
      {review.attachedContracts.length ? (
        <details>
          <summary>{t("Attached contract code")}</summary>
          {review.attachedContracts.map((code, index) => (
            <p className="Thruput__address" key={index}>
              {code}
            </p>
          ))}
        </details>
      ) : null}
    </section>
  );
};
