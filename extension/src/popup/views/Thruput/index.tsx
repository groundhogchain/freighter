import React, { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { View } from "popup/basics/layout/View";
import { ROUTES } from "popup/constants/routes";
import { navigateTo } from "popup/helpers/navigate";
import { useThruputState } from "./useThruputState";
import { Approval } from "./Approval";
import { Dashboard } from "./Dashboard";
import { ImportAccount } from "./ImportAccount";
import "./styles.scss";

export const Thruput = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { state, error, refresh } = useThruputState();
  const [selected, setSelected] = useState("");
  const approval = new URLSearchParams(location.search).get("approval");
  if (state?.locked)
    return (
      <Navigate
        to={`${ROUTES.unlockAccount}${location.search}`}
        state={{ from: location }}
        replace
      />
    );
  const account =
    state?.accounts.find((item) => item.address === selected) ||
    state?.accounts[0];
  return (
    <>
      <View.AppHeader
        pageTitle={t("Thruput")}
        hasBackButton
        customBackAction={() => navigateTo(ROUTES.account, navigate)}
      />
      <View.Content>
        {error ? (
          <p role="alert">{t("Thruput wallet data could not be loaded.")}</p>
        ) : null}
        {!state ? (
          <p role="status">{t("Loading wallet…")}</p>
        ) : approval ? (
          <Approval key={approval} id={approval} />
        ) : account ? (
          <>
            <div className="Thruput__selector">
              <label htmlFor="thruput-account">{t("Account")}</label>
              <select
                id="thruput-account"
                name="account"
                value={account.address}
                onChange={(event) => setSelected(event.target.value)}
              >
                {state.accounts.map((item) => (
                  <option key={item.address} value={item.address}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <Dashboard
              key={`${state.networkHash}:${account.address}`}
              state={state}
              account={account}
              refresh={refresh}
            />
            <ImportAccount refresh={refresh} />
          </>
        ) : (
          <div className="Thruput">
            <h1>{t("Add a software account")}</h1>
            <p>
              {t(
                "Thruput uses your software account keys. Hardware signing is not supported yet.",
              )}
            </p>
            <button
              type="button"
              onClick={() => navigateTo(ROUTES.wallets, navigate)}
            >
              {t("Manage accounts")}
            </button>
          </div>
        )}
      </View.Content>
    </>
  );
};
