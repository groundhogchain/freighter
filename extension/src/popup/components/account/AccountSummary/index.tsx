import React from "react";
import { Text } from "@stellar/design-system";
import "../AccountHeader/styles.scss";

export const AccountAction = ({
  icon,
  label,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  className?: string;
}) => (
  <div className={`AccountHeader__actions__column ${className}`}>
    <div className="AccountHeader__actions__btn">{icon}</div>
    <Text as="div" size="xs" weight="medium">
      {label}
    </Text>
  </div>
);

export const AccountSummary = ({
  accountControl,
  balance,
  actions,
  children,
  className = "",
}: {
  accountControl: React.ReactNode;
  balance: React.ReactNode;
  actions: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`AccountHeader__account-info ${className}`}
    data-testid="account-header"
  >
    <div className="AccountHeader__account-info__details">
      {accountControl}
      <div
        className="AccountHeader__total-usd-balance"
        data-testid="account-view-total-balance"
      >
        {balance}
      </div>
      <div className="AccountHeader__actions">{actions}</div>
      {children}
    </div>
  </div>
);
