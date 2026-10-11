import { sendMessageToBackground } from "@shared/api/helpers/extensionMessaging";
import { SERVICE_TYPES } from "@shared/constants/services";
import { ThruputUiAction } from "thruput/types";

export const thruputRequest = async <T>(
  action: ThruputUiAction,
  input: Record<string, unknown> = {},
): Promise<T> => {
  const response = await sendMessageToBackground<{
    result?: T;
    error?: { code: number; message: string };
  }>({
    ...input,
    type: SERVICE_TYPES.THRUPUT_UI,
    activePublicKey: null,
    action,
  });
  if (!response) throw new Error("Wallet disconnected");
  if (response.error) throw new Error(response.error.message);
  return response.result as T;
};
