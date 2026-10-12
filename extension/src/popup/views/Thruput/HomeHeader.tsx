import React from "react";
import { Icon, NavButton } from "@stellar/design-system";
import { useTranslation } from "react-i18next";
import { View } from "popup/basics/layout/View";
import {
  AccountAction,
  AccountSummary,
} from "popup/components/account/AccountSummary";
import { ChainSelector } from "popup/components/account/ChainSelector";
import { IdenticonImg } from "popup/components/identicons/IdenticonImg";
import type { ThruputAccount } from "thruput/accounts";
import { ThruputNetwork } from "thruput/networks";
import type { ThruputState } from "thruput/types";

export enum ThruputPanel {
  TOKENS = "tokens",
  ADD = "add",
  SEND = "send",
  ACTIVITY = "activity",
  SETTINGS = "settings",
}

export const HomeHeader = ({
  state,
  account,
  balance,
  panel,
  onPanel,
  onAccount,
  busy,
}: {
  state: ThruputState;
  account: ThruputAccount;
  balance: string;
  panel: ThruputPanel;
  onPanel: (panel: ThruputPanel) => void;
  onAccount: (account: string) => void;
  busy: boolean;
}) => {
  const { t } = useTranslation();
  const titles = {
    [ThruputPanel.TOKENS]: t("Tokens"),
    [ThruputPanel.ADD]: t("Add"),
    [ThruputPanel.SEND]: t("Send"),
    [ThruputPanel.ACTIVITY]: t("Recent activity"),
    [ThruputPanel.SETTINGS]: t("Settings"),
  };
  if (panel !== ThruputPanel.TOKENS)
    return (
      <View.AppHeader
        pageTitle={titles[panel]}
        leftContent={
          <NavButton
            title={t("Back")}
            icon={<Icon.ArrowLeft />}
            onClick={() => onPanel(ThruputPanel.TOKENS)}
          />
        }
        rightContent={<ChainSelector />}
      />
    );
  return (
    <View.AppHeader
      isAccountHeader
      leftContent={
        <div className="AccountHeader__icon-btn__left">
          <NavButton
            showBorder
            title={t("Settings")}
            icon={<Icon.DotsHorizontal />}
            onClick={() => onPanel(ThruputPanel.SETTINGS)}
          />
          <NavButton
            showBorder
            title={t("Recent activity")}
            icon={<Icon.ClockRewind />}
            onClick={() => onPanel(ThruputPanel.ACTIVITY)}
          />
        </div>
      }
      rightContent={<ChainSelector />}
    >
      <View.Inset hasVerticalBorder additionalClassName="ThruputHome__inset">
        <AccountSummary
          className="ThruputHome__summary"
          accountControl={
            <div className="AccountHeader__name-key-display ThruputHome__account">
              <div className="AccountHeader__identicon">
                <IdenticonImg publicKey={account.stellarPublicKey} />
              </div>
              <select
                aria-label={t("Account")}
                name="account"
                value={account.address}
                disabled={busy}
                onChange={(event) => onAccount(event.target.value)}
              >
                {state.accounts.map((item) => (
                  <option key={item.address} value={item.address}>
                    {item.name}
                  </option>
                ))}
              </select>
              <Icon.ChevronDown aria-hidden="true" />
            </div>
          }
          balance={
            <div className="ThruputHome__balance">
              <div>
                {balance} <span>HOG</span>
              </div>
              <button
                type="button"
                className="ThruputHome__network"
                onClick={() => onPanel(ThruputPanel.SETTINGS)}
              >
                <Icon.Globe01 />{" "}
                {state.network === ThruputNetwork.LOCALNET
                  ? t("Thruput Localnet")
                  : t("Thruput Devnet")}{" "}
                <Icon.ChevronDown />
              </button>
            </div>
          }
          actions={
            <>
              <button
                type="button"
                className="ThruputHome__action"
                onClick={() => onPanel(ThruputPanel.ADD)}
              >
                <AccountAction icon={<Icon.Plus />} label={t("Add")} />
              </button>
              <button
                type="button"
                className="ThruputHome__action"
                onClick={() => onPanel(ThruputPanel.SEND)}
              >
                <AccountAction icon={<Icon.ArrowUp />} label={t("Send")} />
              </button>
              <button
                type="button"
                className="ThruputHome__action"
                disabled
              >
                <AccountAction icon={<Icon.RefreshCw02 />} label={t("Swap")} />
              </button>
            </>
          }
        />
        <nav className="ThruputHome__tabs" aria-label={t("Account sections")}>
          <button
            type="button"
            aria-current="page"
            onClick={() => onPanel(ThruputPanel.TOKENS)}
          >
            {t("Tokens")}
          </button>
          <button type="button" onClick={() => onPanel(ThruputPanel.ACTIVITY)}>
            {t("History")}
          </button>
        </nav>
      </View.Inset>
    </View.AppHeader>
  );
};
