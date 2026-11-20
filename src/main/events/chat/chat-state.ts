import { WindowManager } from "@main/services";
import { ChatOfficialMessages } from "@main/services/chat/chat-official-messages";
import { ChatUnreadStore } from "@main/services/chat/chat-unread-store";
import { SocialHubService } from "@main/services/social/social-hub-service";
import { OFFICIAL_CHAT_FRIEND_ID } from "@shared";
import type { ChatWindowState } from "@types";
import { ipcMain } from "electron";

// Accept provider-prefixed Steam/Epic IDs as well as legacy 8-char IDs.
const FRIEND_ID_PATTERN =
  /^(?:steam|epic):[A-Za-z0-9_-]{3,128}$|^[A-Za-z0-9]{8}$/;

const isFriendId = (value: unknown): value is string =>
  typeof value === "string" && FRIEND_ID_PATTERN.test(value);

ipcMain.handle("setChatWindowState", (_event, state: ChatWindowState) => {
  WindowManager.setChatWindowState({
    activeFriendId: isFriendId(state?.activeFriendId)
      ? state.activeFriendId
      : null,
    openFriendIds: Array.isArray(state?.openFriendIds)
      ? state.openFriendIds.filter(isFriendId)
      : [],
    openFriends: Array.isArray(state?.openFriends)
      ? state.openFriends.filter(
          (friend) =>
            typeof friend === "object" &&
            friend !== null &&
            isFriendId(friend.id) &&
            typeof friend.displayName === "string"
        )
      : [],
  });
});

ipcMain.handle("getChatUnreadState", () => SocialHubService.getUnreadState());

ipcMain.handle("refreshOfficialChat", () => ChatOfficialMessages.refresh());

ipcMain.handle(
  "markChatRead",
  async (_event, friendId: string, seq: number): Promise<boolean> => {
    if (!isFriendId(friendId) || !Number.isSafeInteger(seq) || seq < 0) {
      return false;
    }

    if (friendId === OFFICIAL_CHAT_FRIEND_ID) {
      return seq > 0 && ChatOfficialMessages.markRead(seq);
    }

    if (friendId.startsWith("steam:") || friendId.startsWith("epic:")) {
      await SocialHubService.markRead(friendId);
      return true;
    }

    ChatUnreadStore.setUnread(friendId, 0, seq);
    return true;
  }
);
