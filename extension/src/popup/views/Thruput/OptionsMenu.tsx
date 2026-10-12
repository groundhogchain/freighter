import React, { useState } from "react";
import { Icon } from "@stellar/design-system";
import { useTranslation } from "react-i18next";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import browser from "webextension-polyfill";
import { toast } from "sonner";
import type { AppDispatch } from "popup/App";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "popup/basics/shadcn/Popover";
import { signOut } from "popup/ducks/accountServices";
import { openSidebar, openTab } from "popup/helpers/navigate";
import { newTabHref } from "helpers/urls";
import { ROUTES } from "popup/constants/routes";
import "./optionsMenu.scss";

export const OptionsMenu = ({
  address,
  onAccountDetails,
  onSettings,
}: {
  address: string;
  onAccountDetails: () => void;
  onSettings: () => void;
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const firefoxSidebar = (
    browser as typeof browser & {
      sidebarAction?: { open?: () => Promise<void> };
    }
  ).sidebarAction;
  const hasSidebar =
    typeof globalThis.chrome?.sidePanel?.open === "function" ||
    typeof firefoxSidebar?.open === "function";
  const run = async (action: () => void | Promise<unknown>) => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await action();
      setIsOpen(false);
    } catch {
      toast.error(t("Wallet request failed"));
    } finally {
      setIsBusy(false);
    }
  };
  const groups = [
    [
      {
        label: t("Copy address"),
        icon: <Icon.Copy01 />,
        action: async () => {
          await navigator.clipboard.writeText(address);
          toast.success(t("Copied!"));
        },
      },
      {
        label: t("Account details"),
        icon: <Icon.QrCode01 />,
        action: onAccountDetails,
      },
      { label: t("Settings"), icon: <Icon.Settings01 />, action: onSettings },
    ],
    [
      {
        label: t("Lock Freighter"),
        icon: <Icon.Lock01 />,
        action: async () => {
          await dispatch(signOut()).unwrap();
          navigate(ROUTES.unlockAccount, {
            state: { from: { pathname: ROUTES.account } },
          });
        },
      },
      ...(hasSidebar
        ? [
            {
              label: t("Sidebar mode"),
              icon: <Icon.LayoutRight />,
              action: openSidebar,
            },
          ]
        : []),
      {
        label: t("Fullscreen mode"),
        icon: <Icon.Expand05 />,
        action: () => openTab(newTabHref(ROUTES.account)),
      },
      {
        label: t("Share feedback"),
        icon: <Icon.MessageDotsCircle />,
        action: () => navigate(ROUTES.leaveFeedback),
      },
    ],
  ];
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ThruputOptions__trigger"
          aria-label={t("View options")}
        >
          <Icon.DotsHorizontal />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="ThruputOptions"
        aria-label={t("View options")}
      >
        {groups.map((group, index) => (
          <div className="ThruputOptions__group" key={index}>
            {group.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={isBusy}
                onClick={() => {
                  void run(item.action);
                }}
              >
                <span>{item.label}</span>
                {item.icon}
              </button>
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
};
