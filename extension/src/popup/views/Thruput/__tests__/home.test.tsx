import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { reducer as auth } from "popup/ducks/accountServices";
import * as ApiInternal from "@shared/api/internal";
import { APPLICATION_STATE } from "@shared/constants/applicationState";
import { HOG_TOKEN, ThruputNetwork } from "thruput/networks";
import { ThruputUiAction, type ThruputState } from "thruput/types";
import { Home } from "popup/views/Home";
import { View } from "popup/basics/layout/View";
import { ROUTES } from "popup/constants/routes";
import { thruputRequest } from "popup/helpers/thruput";
import { useThruputState } from "../useThruputState";

jest.mock("../useThruputState");
jest.mock("popup/helpers/thruput");
jest.mock("popup/views/Account", () => ({
  Account: () => <div>Stellar home</div>,
}));
jest.mock("popup/components/identicons/IdenticonImg", () => ({
  IdenticonImg: () => null,
}));

const account = {
  address: `0x${"12".repeat(32)}`,
  publicKey: `0x${"34".repeat(32)}`,
  stellarPublicKey: "GTEST",
  keyId: "test",
  name: "Account 1",
  nonce: "0",
};
const state: ThruputState = {
  accounts: [account],
  network: ThruputNetwork.LOCALNET,
  networkHash: "0".repeat(64),
  sites: [],
  outgoing: [],
  locked: false,
};
const refresh = jest.fn(async () => {});
const mockState = jest.mocked(useThruputState);
const request = jest.mocked(thruputRequest);
const mount = () =>
  render(
    <Provider store={configureStore({ reducer: { auth } })}>
      <MemoryRouter>
        <View>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path={ROUTES.welcome} element={<div>Onboarding</div>} />
            <Route
              path={ROUTES.unlockAccount}
              element={<div>Unlock wallet</div>}
            />
          </Routes>
        </View>
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockState.mockReturnValue({
    state,
    error: "",
    refresh,
    applicationState: APPLICATION_STATE.MNEMONIC_PHRASE_CONFIRMED,
  });
  request.mockImplementation(async (action) =>
    action === ThruputUiAction.PORTFOLIO
      ? [{ ...HOG_TOKEN, balance: "125000000" }]
      : null,
  );
});

describe("Thruput default home", () => {
  it("shows the native balance without a ticker and disables Swap; Send opens the Thruput flow", async () => {
    mount();
    await waitFor(() =>
      expect(
        screen.getByTestId("account-view-total-balance"),
      ).toHaveTextContent("12.5"),
    );
    expect(
      screen.getByTestId("account-view-total-balance"),
    ).not.toHaveTextContent("HOG");
    expect(screen.getByText("Thruput tokens")).toBeInTheDocument();
    expect(screen.queryByText("Stellar home")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Swap" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(
      screen.getByLabelText("Recipient Thruput address"),
    ).toBeInTheDocument();
    expect(request).not.toHaveBeenCalledWith(
      ThruputUiAction.SEND,
      expect.anything(),
    );
  });

  it("opens an address-only receive view from Add without submitting anything", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    expect(
      screen.getByRole("heading", { name: "Receive" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request test tokens" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Thruput address QR code" }),
    ).toBeInTheDocument();
    expect(screen.getByText(account.address)).toBeInTheDocument();
    expect(
      screen.queryByText(account.stellarPublicKey),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Stellar signing key")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Token contract address"),
    ).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalledWith(
      ThruputUiAction.AIRDROP,
      expect.anything(),
    );
  });

  it("keeps Add token focused on the custom-token form", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add token" }));
    expect(
      screen.queryByRole("img", { name: "Thruput address QR code" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(account.address)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Token contract address")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add token" })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(request).not.toHaveBeenCalledWith(
      ThruputUiAction.ADD_TOKEN,
      expect.anything(),
    );
  });

  it("opens account details and settings through the options dropdown", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "View options" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Account details" }),
    );
    expect(
      await screen.findByRole("img", { name: "Thruput address QR code" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "View options" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByLabelText("Network")).toBeInTheDocument();
  });

  it("copies the Thruput address and closes the dropdown", async () => {
    const writeText = jest.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "View options" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy address" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(account.address),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "View options" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("locks through the existing Freighter sign-out action", async () => {
    const signOut = jest.spyOn(ApiInternal, "signOut").mockResolvedValue({
      publicKey: "",
      applicationState: APPLICATION_STATE.MNEMONIC_PHRASE_CONFIRMED,
    });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "View options" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Lock Freighter" }),
    );
    expect(await screen.findByText("Unlock wallet")).toBeInTheDocument();
    expect(signOut).toHaveBeenCalled();
    signOut.mockRestore();
  });

  it("requests test tokens from home above Add token and confirms the result", async () => {
    mount();
    const fund = await screen.findByRole("button", {
      name: "Request test tokens",
    });
    const addToken = screen.getByRole("button", { name: "Add token" });
    expect(
      fund.compareDocumentPosition(addToken) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(fund);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(ThruputUiAction.AIRDROP, {
        account: account.address,
      }),
    );
    expect(
      await screen.findByText("Test funding confirmed."),
    ).toBeInTheDocument();
  });

  it("makes Stellar reachable through the visible chain selector", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Chain"), {
      target: { value: "stellar" },
    });
    expect(await screen.findByText("Stellar home")).toBeInTheDocument();
  });

  it("routes a fresh installation to onboarding before requesting balances", async () => {
    mockState.mockReturnValue({
      state: { ...state, accounts: [], locked: true },
      error: "",
      refresh,
      applicationState: APPLICATION_STATE.APPLICATION_STARTED,
    });
    mount();
    expect(await screen.findByText("Onboarding")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it("routes a locked wallet to unlock before requesting balances", async () => {
    mockState.mockReturnValue({
      state: { ...state, locked: true },
      error: "",
      refresh,
      applicationState: APPLICATION_STATE.MNEMONIC_PHRASE_CONFIRMED,
    });
    mount();
    expect(await screen.findByText("Unlock wallet")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it("shows an RPC failure without replacing the unknown native balance with zero", async () => {
    request.mockRejectedValue(new Error("Balances could not be loaded."));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Balances could not be loaded.",
    );
    expect(screen.getByTestId("account-view-total-balance")).toHaveTextContent(
      "—",
    );
    expect(screen.queryByText("Loading balances…")).not.toBeInTheDocument();
  });
});
