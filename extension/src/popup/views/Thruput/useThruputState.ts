import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { loadAccount, loadSettings } from "@shared/api/internal";
import { APPLICATION_STATE } from "@shared/constants/applicationState";
import { saveAccount, saveApplicationState } from "popup/ducks/accountServices";
import { saveSettingsAction } from "popup/ducks/settings";
import { thruputRequest } from "popup/helpers/thruput";
import { ThruputUiAction, type ThruputState } from "thruput/types";

export const useThruputState = () => {
  const [state, setState] = useState<ThruputState>();
  const [error, setError] = useState("");
  const [applicationState, setApplicationState] = useState<APPLICATION_STATE>();
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
    void Promise.all([loadAccount(), loadSettings()])
      .then(([account, settings]) => {
        if (mounted.current && account) {
          dispatch(saveAccount(account));
          dispatch(saveSettingsAction(settings));
          const application =
            account.applicationState || APPLICATION_STATE.APPLICATION_STARTED;
          dispatch(saveApplicationState(application));
          setApplicationState(application);
        }
      })
      .catch(() => {
        if (mounted.current)
          setError("Thruput wallet data could not be loaded.");
      });
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [dispatch, refresh]);
  return { state, error, refresh, applicationState };
};
