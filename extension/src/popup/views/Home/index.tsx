import React from "react";
import { useLocation } from "react-router-dom";
import { Account } from "popup/views/Account";
import { ActiveTabProvider } from "popup/views/Account/contexts/activeTabContext";
import { Thruput } from "popup/views/Thruput";

export const Home = () => {
  const { search } = useLocation();
  return new URLSearchParams(search).get("chain") === "stellar" ? (
    <ActiveTabProvider>
      <Account />
    </ActiveTabProvider>
  ) : (
    <Thruput />
  );
};
