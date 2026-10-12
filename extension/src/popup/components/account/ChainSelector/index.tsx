import React from "react";
import { Icon } from "@stellar/design-system";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "popup/constants/routes";
import "./styles.scss";

export const ChainSelector = ({ className = "" }: { className?: string }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isStellar =
    new URLSearchParams(location.search).get("chain") === "stellar";
  return (
    <div className={`ChainSelector ${className}`}>
      <select
        aria-label={t("Chain")}
        name="chain"
        value={isStellar ? "stellar" : "thruput"}
        onChange={(event) =>
          navigate(`${ROUTES.account}?chain=${event.target.value}`)
        }
      >
        <option value="thruput">{t("Thruput")}</option>
        <option value="stellar">{t("Stellar")}</option>
      </select>
      <Icon.ChevronDown aria-hidden="true" />
    </div>
  );
};
