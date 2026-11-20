import { useCallback, useContext } from "react";
import { ReactReduxContext } from "react-redux";
import { showToast } from "@renderer/features";

export function useToast() {
  const reduxContext = useContext(ReactReduxContext);
  const store = reduxContext?.store ?? null;

  const dispatchOrEmit = useCallback(
    (
      title: string,
      message: string | undefined,
      type: "success" | "error" | "warning",
      duration?: number
    ) => {
      if (store) {
        store.dispatch(
          showToast({
            title,
            message,
            type,
            duration,
          })
        );
      } else {
        globalThis.window.dispatchEvent(
          new CustomEvent("cerberus:toast", {
            detail: { title, message, type, duration },
          })
        );
      }
    },
    [store]
  );

  const showSuccessToast = useCallback(
    (title: string, message?: string, duration?: number) => {
      dispatchOrEmit(title, message, "success", duration);
    },
    [dispatchOrEmit]
  );

  const showErrorToast = useCallback(
    (title: string, message?: string, duration?: number) => {
      dispatchOrEmit(title, message, "error", duration);
    },
    [dispatchOrEmit]
  );

  const showWarningToast = useCallback(
    (title: string, message?: string, duration?: number) => {
      dispatchOrEmit(title, message, "warning", duration);
    },
    [dispatchOrEmit]
  );

  return { showSuccessToast, showErrorToast, showWarningToast };
}
