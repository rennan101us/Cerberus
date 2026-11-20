import fs from "node:fs";
import type {
  ChatConversationsPage,
  ChatMessageDto,
  ChatMessagesPage,
  ChatUnreadState,
  FriendsSnapshot,
  SocialGameInvite,
  SocialInvitableGame,
  SocialSendInvitePayload,
  StoreProvider,
  UserFriend,
} from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { launchGame } from "@main/helpers/launch-game";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import { LocalNotificationManager } from "@main/services/notifications/local-notifications";
import { SteamStoreService } from "@main/services/stores/steam-store-service";
import { EpicStoreService } from "@main/services/stores/epic-store-service";
import { SteamSocialService } from "./steam-social-service";
import { EpicSocialService } from "./epic-social-service";
import { SocialChatStore } from "./social-chat-store";

class SocialHubServiceImpl {
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  public hasConnectedAccount(): boolean {
    return (
      SteamStoreService.getAccount().connected ||
      EpicStoreService.getAccount().connected
    );
  }

  public initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (!this.initialized) {
        this.initialized = true;
        this.wireEvents();
      }

      const tasks: Promise<unknown>[] = [];
      if (SteamStoreService.getAccount().connected) {
        tasks.push(
          SteamSocialService.connect().catch((err) => {
            logger.warn("[SocialHub] Steam auto-connect failed", err);
          })
        );
      }
      if (EpicStoreService.getAccount().connected) {
        tasks.push(
          EpicSocialService.connect().catch((err) => {
            logger.warn("[SocialHub] Epic auto-connect failed", err);
          })
        );
      }

      await Promise.allSettled(tasks);
      this.broadcastUnread().catch(() => {});
    })();

    return this.initPromise;
  }

  private wireEvents() {
    SteamSocialService.setEventHandlers({
      onFriendsChanged: () => this.broadcastFriends(),
      onPresenceUpdate: (friend) => this.broadcastPresence(friend),
      onIncomingMessage: (friend, msg) => this.handleIncoming(friend, msg),
      onTyping: (friendId) => {
        WindowManager.sendToAppWindows("on-chat-typing", { friendId });
      },
      onIncomingInvite: (friend, msg) => this.handleIncomingInvite(friend, msg),
    });

    EpicSocialService.setEventHandlers({
      onFriendsChanged: () => this.broadcastFriends(),
      onPresenceUpdate: (friend) => this.broadcastPresence(friend),
      onIncomingMessage: (friend, msg) => this.handleIncoming(friend, msg),
      onIncomingInvite: (friend, msg) => this.handleIncomingInvite(friend, msg),
    });
  }

  private broadcastFriends() {
    WindowManager.sendToAppWindows("on-friends-updated");
  }

  private broadcastPresence(friend: UserFriend) {
    WindowManager.sendToAppWindows("on-friend-presence", {
      friendId: friend.id,
      isOnline: Boolean(friend.isOnline),
    });
    WindowManager.sendToAppWindows("on-friends-updated");
  }

  private async broadcastUnread(): Promise<ChatUnreadState> {
    const state = await SocialChatStore.getUnreadState();
    WindowManager.sendToAppWindows("on-chat-unread-updated", state);
    return state;
  }

  private async handleIncoming(friend: UserFriend, message: ChatMessageDto) {
    WindowManager.sendToAppWindows("on-chat-message", {
      friendId: friend.id,
      message,
    });
    WindowManager.sendToAppWindows("on-chat-message-sound");
    await this.broadcastUnread();
    WindowManager.showIncomingChatMessage(friend);
  }

  private async handleIncomingInvite(
    friend: UserFriend,
    message: ChatMessageDto
  ) {
    if (!message.invite) return;
    WindowManager.sendToAppWindows("on-social-game-invite", {
      friend,
      invite: message.invite,
      message,
    });
    await LocalNotificationManager.createNotification(
      "UPDATE_AVAILABLE",
      `Convite de ${friend.displayName}`,
      `${friend.displayName} chamou você para jogar ${message.invite.gameTitle}.`
    ).catch(() => {});
  }

  public async shutdown(): Promise<void> {
    await Promise.allSettled([
      SteamSocialService.disconnect(),
      EpicSocialService.disconnect(),
    ]);
  }

  public async getSnapshot(): Promise<FriendsSnapshot> {
    await this.initialize();
    const friends = [
      ...SteamSocialService.getFriends(),
      ...EpicSocialService.getFriends(),
    ];
    const onlineFriends = friends.filter((f) => Boolean(f.isOnline)).length;
    const friendRequests = [
      ...SteamSocialService.getFriendRequests(),
      ...EpicSocialService.getFriendRequests(),
    ];

    return {
      friends,
      onlineFriends,
      friendRequests,
    };
  }

  public async getConversations(): Promise<ChatConversationsPage> {
    await this.initialize();
    const friends = [
      ...SteamSocialService.getFriends(),
      ...EpicSocialService.getFriends(),
    ];
    const byId = new Map(friends.map((f) => [f.id, f]));
    return SocialChatStore.getConversations(byId);
  }

  public async getMessages(
    friendId: string,
    params: { before?: number; take?: number } = {}
  ): Promise<ChatMessagesPage> {
    await this.initialize();

    if (friendId.startsWith("steam:") && !params.before) {
      const steamId64 = friendId.slice("steam:".length);
      await SteamSocialService.syncFriendHistory(steamId64).catch(() => {});
    }

    const { messages, hasMore } = await SocialChatStore.getMessages(
      friendId,
      params
    );
    const convs = await SocialChatStore.getConversations();
    const unread =
      convs.conversations.find((c) => c.friendId === friendId)?.unreadCount ??
      0;

    return {
      messages,
      pendingMessages: [],
      hasMore,
      unreadCount: unread,
      lastReadSeq: messages.at(-1)?.seq ?? 0,
      canSend: true,
    };
  }

  public async sendMessage(
    friendId: string,
    body: string
  ): Promise<ChatMessageDto> {
    await this.initialize();
    if (friendId.startsWith("steam:")) {
      const msg = await SteamSocialService.sendMessage(
        friendId.slice("steam:".length),
        body
      );
      WindowManager.sendToAppWindows("on-chat-message", {
        friendId,
        message: msg,
      });
      await this.broadcastUnread();
      return msg;
    }
    if (friendId.startsWith("epic:")) {
      const msg = await EpicSocialService.sendMessage(
        friendId.slice("epic:".length),
        body
      );
      WindowManager.sendToAppWindows("on-chat-message", {
        friendId,
        message: msg,
      });
      await this.broadcastUnread();
      return msg;
    }
    throw new Error("Provedor social desconhecido para este amigo.");
  }

  public async sendTyping(friendId: string): Promise<void> {
    if (friendId.startsWith("steam:")) {
      await SteamSocialService.sendTyping(friendId.slice("steam:".length));
    }
  }

  public async markRead(friendId: string): Promise<ChatUnreadState> {
    const state = await SocialChatStore.markRead(friendId);
    WindowManager.sendToAppWindows("on-chat-unread-updated", state);
    return state;
  }

  public getUnreadState(): Promise<ChatUnreadState> {
    return SocialChatStore.getUnreadState();
  }

  public async addFriend(
    provider: StoreProvider,
    query: string
  ): Promise<void> {
    await this.initialize();
    if (provider === "steam") {
      await SteamSocialService.addFriend(query);
    } else {
      await EpicSocialService.addFriendByDisplayName(query);
    }
    this.broadcastFriends();
  }

  public async respondFriendRequest(
    friendId: string,
    accept: boolean
  ): Promise<void> {
    await this.initialize();
    if (friendId.startsWith("steam:")) {
      await SteamSocialService.respondFriendRequest(
        friendId.slice("steam:".length),
        accept
      );
    } else if (friendId.startsWith("epic:")) {
      await EpicSocialService.respondFriendRequest(
        friendId.slice("epic:".length),
        accept
      );
    }
    this.broadcastFriends();
  }

  public async removeFriend(friendId: string): Promise<void> {
    await this.initialize();
    if (friendId.startsWith("steam:")) {
      await SteamSocialService.removeFriend(friendId.slice("steam:".length));
    } else if (friendId.startsWith("epic:")) {
      await EpicSocialService.removeFriend(friendId.slice("epic:".length));
    }
    this.broadcastFriends();
  }

  public async sendGameInvite(
    payload: SocialSendInvitePayload
  ): Promise<ChatMessageDto> {
    await this.initialize();
    const { friendId, objectId, gameTitle, lobbyId, connectString } = payload;

    let resolvedTitle = gameTitle;
    if (!resolvedTitle && payload.gameShop && objectId) {
      const g = await gamesSublevel
        .get(levelKeys.game(payload.gameShop, objectId))
        .catch(() => null);
      resolvedTitle = g?.title;
    }

    if (friendId.startsWith("steam:")) {
      const msg = await SteamSocialService.sendGameInvite({
        steamId64: friendId.slice("steam:".length),
        appId: objectId,
        gameTitle:
          resolvedTitle || (objectId ? `Steam App ${objectId}` : "Jogo Steam"),
        lobbyId,
        connectString,
      });
      WindowManager.sendToAppWindows("on-chat-message", {
        friendId,
        message: msg,
      });
      return msg;
    }

    if (friendId.startsWith("epic:")) {
      const msg = await EpicSocialService.sendGameInvite({
        targetAccountId: friendId.slice("epic:".length),
        appId: objectId,
        gameTitle: resolvedTitle || objectId || "Jogo Epic",
      });
      WindowManager.sendToAppWindows("on-chat-message", {
        friendId,
        message: msg,
      });
      return msg;
    }

    throw new Error("Provedor inválido para convite.");
  }

  public async acceptGameInvite(
    invite: SocialGameInvite
  ): Promise<{ launched: boolean; navigatedTo?: string }> {
    const games = await gamesSublevel.iterator().all();

    let matched = games.find(
      ([, g]) =>
        !g.isDeleted &&
        invite.appId &&
        (g.objectId === invite.appId ||
          g.catalogueGame?.objectId === invite.appId)
    )?.[1];

    if (!matched && invite.gameTitle) {
      const target = invite.gameTitle.trim().toLowerCase();
      matched = games.find(
        ([, g]) => !g.isDeleted && g.title.trim().toLowerCase() === target
      )?.[1];
    }

    await SocialChatStore.updateInviteStatus(
      invite.inviterId,
      invite.id,
      "accepted"
    ).catch(() => {});

    if (matched?.executablePath && fs.existsSync(matched.executablePath)) {
      const extraArgs: string[] = [];
      if (invite.lobbyId) {
        extraArgs.push("+connect_lobby", invite.lobbyId);
      } else if (invite.connectString) {
        extraArgs.push("+connect", invite.connectString);
      }

      await launchGame({
        shop: matched.shop,
        objectId: matched.objectId,
        executablePath: matched.executablePath,
        launchOptions: matched.launchOptions,
        extraArgs: extraArgs.length > 0 ? extraArgs : undefined,
      });
      return { launched: true };
    }

    if (invite.appId) {
      const shop = invite.provider;
      const route = `/game/${shop}/${invite.appId}?title=${encodeURIComponent(
        invite.gameTitle
      )}`;
      WindowManager.focusMainWindowAndNavigate(route);
      return { launched: false, navigatedTo: route };
    }

    return { launched: false };
  }

  public async getInvitableGames(
    provider: StoreProvider
  ): Promise<SocialInvitableGame[]> {
    const { launchedGamePids } = await import(
      "@main/services/launched-game-pids"
    );
    const list: SocialInvitableGame[] = [];

    for await (const [key, game] of gamesSublevel.iterator()) {
      if (game.isDeleted) continue;
      if (game.shop !== provider) continue;
      const isRunning = launchedGamePids.has(key);
      const isInstalled = Boolean(
        game.executablePath && fs.existsSync(game.executablePath)
      );
      if (!isRunning && !isInstalled) continue;
      list.push({
        shop: game.shop,
        objectId: game.objectId,
        title: game.title,
        iconUrl: game.iconUrl,
        isRunning,
        isInstalled,
      });
    }

    list.sort((a, b) => {
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
    return list;
  }
}

export const SocialHubService = new SocialHubServiceImpl();
