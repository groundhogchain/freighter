import React from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { APPLICATION_STATE } from "@shared/constants/applicationState";
import { View } from "popup/basics/layout/View";
import { ChainSelector } from "popup/components/account/ChainSelector";
import { ROUTES } from "popup/constants/routes";
import { navigateTo } from "popup/helpers/navigate";
import { useThruputState } from "./useThruputState";
import { Approval } from "./Approval";
import { Dashboard } from "./Dashboard";
import "./styles.scss";

export const Thruput = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { state, error, refresh, applicationState } = useThruputState();
  const approval = new URLSearchParams(location.search).get("approval");
  if (applicationState === APPLICATION_STATE.APPLICATION_STARTED) {
    return <Navigate to={ROUTES.welcome} replace />;
  }
  if (
    applicationState === APPLICATION_STATE.PASSWORD_CREATED ||
    applicationState === APPLICATION_STATE.MNEMONIC_PHRASE_FAILED
  ) {
    return (
      <Navigate
        to={`${ROUTES.accountCreator}?isRestartingOnboarding=true`}
        replace
      />
    );
  }
  if (applicationState && state?.locked) {
    return (
      <Navigate
        to={`${ROUTES.unlockAccount}${location.search}`}
        state={{ from: location }}
        replace
      />
    );
  }
  const account =
    state?.accounts.find((item) => item.address === state.selectedAccount) ||
    state?.accounts[0];
  if (applicationState && state && account && !approval) {
    return (
      <Dashboard
        key={`${state.networkHash}:${account.address}`}
        state={state}
        account={account}
        refresh={refresh}
      />
    );
  }
  return (
    <>
      <View.AppHeader
        pageTitle={t("Thruput")}
        rightContent={!approval ? <ChainSelector /> : undefined}
      />
      <View.Content>
        {error ? (
          <p role="alert">{t("Thruput wallet data could not be loaded.")}</p>
        ) : !state || !applicationState ? (
          <p role="status">{t("Loading wallet…")}</p>
        ) : approval ? (
          <Approval key={approval} id={approval} />
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
