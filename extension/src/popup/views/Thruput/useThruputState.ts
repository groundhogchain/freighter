import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { loadAccount } from "@shared/api/internal";
import { saveAccount } from "popup/ducks/accountServices";
import { thruputRequest } from "popup/helpers/thruput";
import { ThruputUiAction, type ThruputState } from "thruput/types";

export const useThruputState = () => {
  const [state, setState] = useState<ThruputState>();
  const [error, setError] = useState("");
  const dispatch = useDispatch();
  const mounted = useRef(false);
  const running = useRef(false);
  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const result = await thruputRequest<ThruputState>(ThruputUiAction.STATE);
      if (mounted.current) {
        setState(result);
        setError("");
      }
    } catch {
      if (mounted.current) setError("Thruput wallet data could not be loaded.");
    } finally {
      running.current = false;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    // Keep Freighter's shared activity timer and lock listener informed.
    void loadAccount()
      .then((account) => {
        if (mounted.current && account) dispatch(saveAccount(account));
      })
      .catch(() => {});
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [dispatch, refresh]);
  return { state, error, refresh };
};
