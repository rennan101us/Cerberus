import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "@renderer/hooks";
import type { StoreProvider } from "@types";

interface UseAddFriendOptions {
  provider: StoreProvider;
  isFriend: (userId: string) => boolean;
  onSuccess?: () => void;
}

export function useAddFriend({
  provider,
  isFriend,
  onSuccess,
}: UseAddFriendOptions) {
  const { t } = useTranslation("friends_window");
  const { t: tProfile } = useTranslation("user_profile");
  const toast = useToast();

  const showToastPreferringMainWindow = (
    type: "success" | "error",
    title: string
  ) => {
    void globalThis.window.electron
      .showToastInMainWindow({ type, title })
      .catch(() => false)
      .then((shownInMainWindow) => {
        if (shownInMainWindow) return;
        if (type === "success") toast.showSuccessToast(title);
        else toast.showErrorToast(title);
      });
  };
  const showSuccessToast = (title: string) =>
    showToastPreferringMainWindow("success", title);
  const showErrorToast = (title: string) =>
    showToastPreferringMainWindow("error", title);

  const [friendCode, setFriendCode] = useState("");
  const [isSending, setIsSending] = useState(false);

  const changeFriendCode = useCallback((value: string) => {
    setFriendCode(value);
  }, []);

  const sendRequest = async () => {
    const query = friendCode.trim();
    if (isSending) return;

    if (!query) {
      showErrorToast(
        provider === "steam"
          ? "Informe um SteamID64, Código de Amigo Steam ou link de perfil."
          : "Informe o nome de exibição da Epic Games."
      );
      return;
    }

    const prefixedId = `${provider}:${query}`;
    if (isFriend(prefixedId)) {
      showErrorToast(t("already_friends"));
      return;
    }

    setIsSending(true);
    try {
      await globalThis.window.electron.socialAddFriend(provider, query);
      setFriendCode("");
      showSuccessToast(tProfile("request_sent"));
      onSuccess?.();
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : tProfile("error_adding_friend");
      showErrorToast(message);
    } finally {
      setIsSending(false);
    }
  };

  const cancelSentRequest = (userId: string) => {
    void globalThis.window.electron
      .socialRespondFriendRequest(userId, false)
      .catch(() => {
        showErrorToast(tProfile("try_again"));
      });
  };

  return {
    friendCode,
    changeFriendCode,
    isSending,
    sendRequest,
    cancelSentRequest,
  };
}
