import React, { useState, type FormEvent } from "react";
import { Button } from "@stellar/design-system";
import { useTranslation } from "react-i18next";
import { thruputRequest } from "popup/helpers/thruput";
import { ThruputUiAction } from "thruput/types";

export const ImportAccount = ({
  refresh,
}: {
  refresh: () => Promise<void>;
}) => {
  const { t } = useTranslation();
  const [kind, setKind] = useState("thruput-prototype-v1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    event.currentTarget.reset();
    setBusy(true);
    setError("");
    setComplete(false);
    try {
      await thruputRequest(ThruputUiAction.IMPORT, {
        kind,
        password: form.get("password"),
        ...(kind === "thruput-prototype-v1"
          ? { mnemonic: form.get("material"), index: Number(form.get("index")) }
          : { seed: form.get("material") }),
      });
      await refresh();
      setComplete(true);
    } catch {
      setError(
        t(
          "Import failed. Check the recovery material, account index, and wallet password.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="Thruput">
      <summary>{t("Import a Thruput prototype account")}</summary>
      <p>
        {t(
          "Keep the original prototype backup. Imported accounts are not recovered by this wallet's main recovery phrase.",
        )}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {complete ? (
        <p role="status">
          {t("Account imported. Select it from the account list.")}
        </p>
      ) : null}
      <form onSubmit={submit}>
        <label htmlFor="thruput-import-format">{t("Recovery format")}</label>
        <select
          id="thruput-import-format"
          name="format"
          value={kind}
          disabled={busy}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="thruput-prototype-v1">
            {t("Prototype recovery phrase")}
          </option>
          <option value="thruput-seed-v1">{t("Raw private-key seed")}</option>
        </select>
        <label htmlFor="thruput-import-material">
          {kind === "thruput-prototype-v1"
            ? t("Prototype recovery phrase")
            : t("Raw private-key seed")}
        </label>
        <input
          id="thruput-import-material"
          name="material"
          type="password"
          required
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
        {kind === "thruput-prototype-v1" ? (
          <>
            <label htmlFor="thruput-import-index">
              {t("Prototype account index (starts at zero)")}
            </label>
            <input
              id="thruput-import-index"
              name="index"
              type="number"
              required
              min={0}
              max={2147483647}
              defaultValue={0}
              disabled={busy}
            />
          </>
        ) : null}
        <label htmlFor="thruput-import-password">{t("Wallet password")}</label>
        <input
          id="thruput-import-password"
          name="password"
          type="password"
          required
          disabled={busy}
          autoComplete="current-password"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={busy}>
          {t("Import account")}
        </Button>
      </form>
    </details>
  );
};
