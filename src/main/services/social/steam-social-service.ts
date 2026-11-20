import SteamUser, {
  type IncomingSteamFriendMessage,
  type SteamIDLike,
  type SteamOwnedApp,
  type SteamPersona,
} from "steam-user";
import { randomUUID } from "node:crypto";
import type {
  ChatMessageDto,
  FriendRequest,
  SocialGameInvite,
  UserFriend,
} from "@types";
import { logger } from "@main/services/logger";
import { SteamStoreService } from "@main/services/stores/steam-store-service";
import {
  parseSteamGameInviteFromMessage,
  resolveSteamIdentifier,
} from "./steam-invite-parser";
import { buildCerberusInviteUrl } from "@shared";
import { SocialChatStore } from "./social-chat-store";

export interface SteamSocialEvents {
  onFriendsChanged: () => void;
  onPresenceUpdate: (friend: UserFriend) => void;
  onIncomingMessage: (friend: UserFriend, message: ChatMessageDto) => void;
  onTyping: (friendId: string) => void;
  onIncomingInvite: (friend: UserFriend, message: ChatMessageDto) => void;
}

const mapPersonaState = (
  stateNum: number | undefined,
  gameAppId: number | null | undefined
): UserFriend["personaState"] => {
  if (gameAppId && gameAppId > 0) return "in-game";
  switch (stateNum) {
    case SteamUser.EPersonaState.Online:
    case SteamUser.EPersonaState.LookingToPlay:
    case SteamUser.EPersonaState.LookingToTrade:
      return "online";
    case SteamUser.EPersonaState.Busy:
      return "busy";
    case SteamUser.EPersonaState.Away:
      return "away";
    case SteamUser.EPersonaState.Snooze:
      return "snooze";
    default:
      return "offline";
  }
};

const extractRichPresenceValue = (
  rp: SteamPersona["rich_presence"],
  targetKey: string
): string | undefined => {
  if (!rp) return undefined;
  if (Array.isArray(rp)) {
    return rp.find((e) => e.key?.toLowerCase() === targetKey.toLowerCase())
      ?.value;
  }
  const hit = Object.entries(rp).find(
    ([k]) => k.toLowerCase() === targetKey.toLowerCase()
  );
  return hit?.[1];
};

class SteamSocialServiceImpl {
  private client: SteamUser | null = null;
  private loggedOn = false;
  private connectingPromise: Promise<boolean> | null = null;
  private listeners: SteamSocialEvents | null = null;
  private readonly friendsMap = new Map<string, UserFriend>();
  private readonly pendingRequests: FriendRequest[] = [];
  private activeAppIds: number[] = [];

  public setEventHandlers(handlers: SteamSocialEvents) {
    this.listeners = handlers;
  }

  public isConnected(): boolean {
    return this.loggedOn && Boolean(this.client?.steamID);
  }

  public getSelfSteamId(): string | null {
    return (
      this.client?.steamID?.getSteamID64() ??
      SteamStoreService.getAccount().accountId ??
      null
    );
  }

  public getFriends(): UserFriend[] {
    return Array.from(this.friendsMap.values());
  }

  public getFriendByExternalId(steamId64: string): UserFriend | null {
    return this.friendsMap.get(`steam:${steamId64}`) ?? null;
  }

  public getFriendRequests(): FriendRequest[] {
    return [...this.pendingRequests];
  }

  private personaToFriend(
    steamId64: string,
    persona?: SteamPersona
  ): UserFriend {
    const id = `steam:${steamId64}`;
    const prev = this.friendsMap.get(id);
    const stateNum = persona?.persona_state ?? (prev?.isOnline ? 1 : 0);
    const gameAppId = persona?.game_played_app_id ?? 0;
    const isOnline = stateNum !== SteamUser.EPersonaState.Offline;
    const lobbyIdRaw =
      persona?.game_lobby_id !== null && persona?.game_lobby_id !== undefined
        ? String(persona.game_lobby_id)
        : undefined;
    const lobbyId = lobbyIdRaw && lobbyIdRaw !== "0" ? lobbyIdRaw : undefined;
    const connectString =
      extractRichPresenceValue(persona?.rich_presence, "connect") ??
      extractRichPresenceValue(persona?.rich_presence, "steam_player_group");

    const currentGame =
      gameAppId && gameAppId > 0
        ? {
            shop: "steam" as const,
            objectId: String(gameAppId),
            title: persona?.game_name || `Steam App ${gameAppId}`,
            iconUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${gameAppId}/capsule_sm_120.jpg`,
            libraryHeroImageUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${gameAppId}/library_hero.jpg`,
            libraryImageUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${gameAppId}/library_600x900_2x.jpg`,
            logoImageUrl: "",
            logoPosition: null,
            coverImageUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${gameAppId}/library_600x900_2x.jpg`,
            downloadSources: [],
            sessionDurationInSeconds: 0,
          }
        : null;

    const friend: UserFriend = {
      id,
      provider: "steam",
      externalId: steamId64,
      displayName: persona?.player_name || prev?.displayName || steamId64,
      profileImageUrl:
        persona?.avatar_url_medium ||
        persona?.avatar_url_icon ||
        prev?.profileImageUrl ||
        null,
      isOnline,
      personaState: mapPersonaState(stateNum, gameAppId),
      currentGame,
      richPresence: persona?.rich_presence_string ?? null,
      gameLobby:
        lobbyId || connectString
          ? {
              appId: gameAppId ? String(gameAppId) : undefined,
              lobbyId,
              connectString,
              joinable: Boolean(lobbyId || connectString),
            }
          : null,
    };

    this.friendsMap.set(id, friend);
    return friend;
  }

  private rebuildFriendLists() {
    if (!this.client?.myFriends) return;

    const friendIds: string[] = [];
    const reqIds: string[] = [];
    const nextRequests: FriendRequest[] = [];
    const keptIds = new Set<string>();

    for (const [sid, rel] of Object.entries(this.client.myFriends)) {
      if (rel === SteamUser.EFriendRelationship.Friend) {
        keptIds.add(`steam:${sid}`);
        friendIds.push(sid);
        const persona = this.client.users?.[sid];
        this.personaToFriend(sid, persona);
      } else if (
        rel === SteamUser.EFriendRelationship.RequestRecipient ||
        rel === SteamUser.EFriendRelationship.RequestInitiator
      ) {
        reqIds.push(sid);
        const persona = this.client.users?.[sid];
        nextRequests.push({
          id: `steam:${sid}`,
          provider: "steam",
          externalId: sid,
          displayName: persona?.player_name || sid,
          profileImageUrl: persona?.avatar_url_medium ?? null,
          type:
            rel === SteamUser.EFriendRelationship.RequestRecipient
              ? "RECEIVED"
              : "SENT",
        });
      }
    }

    for (const existingId of this.friendsMap.keys()) {
      if (!keptIds.has(existingId)) {
        this.friendsMap.delete(existingId);
      }
    }

    this.pendingRequests.splice(
      0,
      this.pendingRequests.length,
      ...nextRequests
    );
    this.listeners?.onFriendsChanged();

    const toFetch = [...friendIds, ...reqIds].slice(0, 250);
    if (toFetch.length > 0 && this.loggedOn) {
      this.client
        .getPersonas(toFetch)
        .then(({ personas }) => {
          for (const [sid, p] of Object.entries(personas)) {
            if (keptIds.has(`steam:${sid}`)) {
              this.personaToFriend(sid, p);
            } else {
              const req = this.pendingRequests.find(
                (r) => r.externalId === sid
              );
              if (req) {
                req.displayName = p.player_name || sid;
                req.profileImageUrl = p.avatar_url_medium ?? null;
              }
            }
          }
          this.listeners?.onFriendsChanged();
        })
        .catch(() => {});
    }
  }

  public async connect(forceReconnect = false): Promise<boolean> {
    if (this.loggedOn && !forceReconnect) return true;
    if (this.connectingPromise && !forceReconnect) {
      return this.connectingPromise;
    }

    const refreshToken = SteamStoreService.getRefreshToken();
    if (!refreshToken) return false;

    if (forceReconnect) {
      await this.disconnect();
    }

    this.connectingPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        this.connectingPromise = null;
        resolve(ok);
      };

      const client = new SteamUser({
        autoRelogin: true,
        enablePicsCache: false,
      });
      this.client = client;

      client.on("loggedOn", () => {
        this.loggedOn = true;
        client.setPersona(SteamUser.EPersonaState.Online);

        const selfId = client.steamID?.getSteamID64();
        if (selfId) {
          void client
            .getPersonas([selfId])
            .then(({ personas }) => {
              const me = personas[selfId];
              if (me) {
                SteamStoreService.updateProfileFromPersona(
                  selfId,
                  me.player_name || selfId,
                  me.avatar_url_medium || me.avatar_url_icon || null
                );
              }
            })
            .catch(() => {});
        }
        done(true);
      });

      client.on("friendsList", () => {
        this.rebuildFriendLists();
      });

      client.on("friendRelationship", () => {
        this.rebuildFriendLists();
      });

      client.on("user", (sid: SteamIDLike, user: SteamPersona) => {
        const sid64 = sid.getSteamID64();
        const selfId = this.getSelfSteamId();
        if (sid64 === selfId) {
          SteamStoreService.updateProfileFromPersona(
            sid64,
            user.player_name || sid64,
            user.avatar_url_medium || user.avatar_url_icon || null
          );
          return;
        }
        if (
          this.client?.myFriends?.[sid64] ===
          SteamUser.EFriendRelationship.Friend
        ) {
          const updated = this.personaToFriend(sid64, user);
          this.listeners?.onPresenceUpdate(updated);
        }
      });

      client.chat.on(
        "friendMessage",
        async (msg: IncomingSteamFriendMessage) => {
          const sid64 = msg.steamid_friend.getSteamID64();
          const friend =
            this.friendsMap.get(`steam:${sid64}`) ??
            this.personaToFriend(sid64, this.client?.users?.[sid64]);
          const createdAt = (msg.server_timestamp ?? new Date()).toISOString();
          const rawText = msg.message || msg.message_no_bbcode || "";
          const dedupeKey = `steam-${sid64}-${Math.floor(
            (msg.server_timestamp?.getTime() ?? Date.now()) / 1000
          )}-${msg.ordinal}`;

          const parsed = parseSteamGameInviteFromMessage({
            rawMessage: rawText,
            senderId: friend.id,
            messageId: dedupeKey,
            createdAt,
            fallbackGameTitle: friend.currentGame?.title,
            fallbackAppId: friend.currentGame?.objectId,
          });

          const stored = await SocialChatStore.appendMessage({
            friend,
            senderId: friend.id,
            body: parsed.body,
            clientNonce: dedupeKey,
            createdAt,
            incrementUnread: true,
            invite: parsed.invite,
            dedupeKey,
          });

          this.listeners?.onIncomingMessage(friend, stored);
          if (parsed.invite) {
            this.listeners?.onIncomingInvite(friend, stored);
          }
        }
      );

      client.chat.on("friendTyping", (msg: { steamid_friend: SteamIDLike }) => {
        const sid64 = msg.steamid_friend.getSteamID64();
        this.listeners?.onTyping(`steam:${sid64}`);
      });

      client.on(
        "lobbyInvite",
        async (
          inviterID: SteamIDLike,
          lobbyID: SteamIDLike | number | string
        ) => {
          const sid64 = inviterID.getSteamID64();
          const friend =
            this.friendsMap.get(`steam:${sid64}`) ??
            this.personaToFriend(sid64, this.client?.users?.[sid64]);
          const lobbyStr = lobbyID.toString();
          const appId = friend.currentGame?.objectId;
          const title =
            friend.currentGame?.title ||
            (appId ? `Jogo Steam (${appId})` : "Jogo Steam");
          const createdAt = new Date().toISOString();
          const invId = `steam-lobby-${lobbyStr}`;

          const invite: SocialGameInvite = {
            id: invId,
            provider: "steam",
            appId,
            gameTitle: title,
            lobbyId: lobbyStr,
            inviterId: friend.id,
            createdAt,
            status: "pending",
          };

          const stored = await SocialChatStore.appendMessage({
            friend,
            senderId: friend.id,
            body: `Convite oficial para jogar ${title}`,
            clientNonce: invId,
            createdAt,
            incrementUnread: true,
            invite,
            dedupeKey: invId,
          });

          this.listeners?.onIncomingMessage(friend, stored);
          this.listeners?.onIncomingInvite(friend, stored);
        }
      );

      client.on("error", (err: Error & { eresult?: number }) => {
        logger.warn("[SteamSocial] Client error", err?.message ?? err);
        this.loggedOn = false;
        done(false);
      });

      client.on("disconnected", () => {
        this.loggedOn = false;
      });

      client.logOn({
        refreshToken,
        machineName: "Cerberus Launcher",
        logonID: Math.floor(Math.random() * 1_000_000) + 1000,
      });

      setTimeout(() => done(this.loggedOn), 15_000);
    });

    return this.connectingPromise;
  }

  public async disconnect(): Promise<void> {
    this.loggedOn = false;
    this.connectingPromise = null;
    if (this.client) {
      try {
        this.client.logOff();
        this.client.removeAllListeners();
      } catch {
        // ignore
      }
      this.client = null;
    }
    this.friendsMap.clear();
    this.pendingRequests.splice(0, this.pendingRequests.length);
  }

  public setPlayingApp(appId: number | null): void {
    if (!this.isConnected() || !this.client) return;
    if (appId && appId > 0) {
      if (!this.activeAppIds.includes(appId)) {
        this.activeAppIds = [...this.activeAppIds, appId];
      }
    } else {
      this.activeAppIds = [];
    }
    try {
      this.client.gamesPlayed(this.activeAppIds, false);
    } catch {
      // non-fatal
    }
  }

  public async getOwnedApps(): Promise<SteamOwnedApp[]> {
    const ok = await this.connect();
    if (!ok || !this.client?.steamID) {
      throw new Error("Não foi possível conectar à rede Steam.");
    }
    const res = await this.client.getUserOwnedApps(this.client.steamID, {
      includeAppInfo: true,
      includePlayedFreeGames: true,
      includeFreeSub: true,
      skipUnvettedApps: false,
    });
    return res.apps ?? [];
  }

  public async sendMessage(
    steamId64: string,
    text: string
  ): Promise<ChatMessageDto> {
    if (!(await this.connect()) || !this.client) {
      throw new Error("Steam não conectada.");
    }

    const res = await this.client.chat.sendFriendMessage(steamId64, text);
    const friend =
      this.friendsMap.get(`steam:${steamId64}`) ??
      this.personaToFriend(steamId64);
    const selfId = this.getSelfSteamId() ?? "self";
    const createdAt = (res.server_timestamp ?? new Date()).toISOString();
    const dedupeKey = `steam-self-${steamId64}-${Math.floor(
      (res.server_timestamp?.getTime() ?? Date.now()) / 1000
    )}-${res.ordinal}`;

    return SocialChatStore.appendMessage({
      friend,
      senderId: `steam:${selfId}`,
      body: res.modified_message || text,
      clientNonce: dedupeKey,
      createdAt,
      incrementUnread: false,
      dedupeKey,
    });
  }

  public async sendTyping(steamId64: string): Promise<void> {
    if (!this.isConnected() || !this.client) return;
    await this.client.chat.sendFriendTyping(steamId64).catch(() => {});
  }

  public async syncFriendHistory(steamId64: string): Promise<void> {
    if (!(await this.connect()) || !this.client) return;
    const friend =
      this.friendsMap.get(`steam:${steamId64}`) ??
      this.personaToFriend(steamId64);
    const selfId = this.getSelfSteamId() ?? "";
    const hist = await this.client.chat
      .getFriendMessageHistory(steamId64, { maxCount: 40 })
      .catch(() => null);
    if (!hist?.messages?.length) return;

    const ordered = [...hist.messages].reverse();
    for (const m of ordered) {
      const sender64 = m.sender.getSteamID64();
      const createdAt = (m.server_timestamp ?? new Date()).toISOString();
      const dedupeKey = `steam-${sender64 === selfId ? "self-" + steamId64 : steamId64}-${Math.floor(
        (m.server_timestamp?.getTime() ?? Date.now()) / 1000
      )}-${m.ordinal}`;

      const parsed = parseSteamGameInviteFromMessage({
        rawMessage: m.message,
        senderId: `steam:${sender64}`,
        messageId: dedupeKey,
        createdAt,
        fallbackGameTitle: friend.currentGame?.title,
        fallbackAppId: friend.currentGame?.objectId,
      });

      await SocialChatStore.appendMessage({
        friend,
        senderId: `steam:${sender64}`,
        body: parsed.body,
        clientNonce: dedupeKey,
        createdAt,
        incrementUnread: false,
        invite: parsed.invite,
        dedupeKey,
      });
    }
  }

  public async sendGameInvite(params: {
    steamId64: string;
    appId?: string;
    gameTitle: string;
    lobbyId?: string;
    connectString?: string;
  }): Promise<ChatMessageDto> {
    if (!(await this.connect()) || !this.client) {
      throw new Error("Steam não conectada.");
    }

    const { steamId64, appId, gameTitle, lobbyId, connectString } = params;
    const friend =
      this.friendsMap.get(`steam:${steamId64}`) ??
      this.personaToFriend(steamId64);
    const selfId = this.getSelfSteamId() ?? "self";
    const userPersona = this.client.users?.[selfId] as
      | (SteamPersona & { game_lobby_id?: string | bigint })
      | undefined;
    const detectedLobbyId =
      lobbyId ||
      (userPersona?.game_lobby_id
        ? String(userPersona.game_lobby_id)
        : undefined);

    const cerbLink = buildCerberusInviteUrl({
      shop: "steam",
      objectId: appId || "steam-app",
      title: gameTitle,
      lobbyId: detectedLobbyId,
      connectString,
    });

    let sentViaUnified = false;
    if (appId && detectedLobbyId && this.client._sendUnified) {
      sentViaUnified = await new Promise<boolean>((resolve) => {
        try {
          this.client!._sendUnified!(
            "FriendMessages.SendMessage#1",
            {
              steamid: steamId64,
              chat_entry_type: 1,
              message: `[lobbyinvite appid=${appId} lobbyid=${detectedLobbyId}][/lobbyinvite]`,
              contains_bbcode: true,
            },
            () => resolve(true)
          );
          setTimeout(() => resolve(true), 2000);
        } catch {
          resolve(false);
        }
      });
    }

    if (!sentViaUnified) {
      let wireText = `[Convite de jogo: ${gameTitle}]`;
      if (appId && detectedLobbyId) {
        wireText = `steam://joinlobby/${appId}/${detectedLobbyId}/${selfId}`;
      } else if (appId) {
        wireText = `[Convite de jogo: ${gameTitle}] steam://run/${appId} ${cerbLink}`;
      } else {
        wireText = `[Convite de jogo: ${gameTitle}] ${cerbLink}`;
      }
      await this.client.chat
        .sendFriendMessage(steamId64, wireText, {
          containsBbCode: true,
        })
        .catch(async () => {
          // Fallback without BBCode if rejected
          await this.client?.chat.sendFriendMessage(steamId64, wireText);
        });
    }

    const inviteId = `steam-out-inv-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const invite: SocialGameInvite = {
      id: inviteId,
      provider: "steam",
      appId,
      gameTitle,
      lobbyId,
      connectString,
      inviterId: `steam:${selfId}`,
      createdAt,
      status: "pending",
    };

    return SocialChatStore.appendMessage({
      friend,
      senderId: `steam:${selfId}`,
      body: `Convite enviado para jogar ${gameTitle}`,
      clientNonce: inviteId,
      createdAt,
      incrementUnread: false,
      invite,
    });
  }

  public async addFriend(query: string): Promise<void> {
    if (!(await this.connect()) || !this.client) {
      throw new Error("Steam não conectada.");
    }
    const steamId64 = resolveSteamIdentifier(query);
    if (!steamId64) {
      throw new Error(
        "Informe um SteamID64 válido (17 dígitos), Código de Amigo Steam ou URL do perfil."
      );
    }
    await this.client.addFriend(steamId64);
    this.rebuildFriendLists();
  }

  public async respondFriendRequest(
    steamId64: string,
    accept: boolean
  ): Promise<void> {
    if (!(await this.connect()) || !this.client) {
      throw new Error("Steam não conectada.");
    }
    if (accept) {
      await this.client.addFriend(steamId64);
    } else {
      this.client.removeFriend(steamId64);
    }
    this.rebuildFriendLists();
  }

  public async removeFriend(steamId64: string): Promise<void> {
    if (!(await this.connect()) || !this.client) return;
    this.client.removeFriend(steamId64);
    this.friendsMap.delete(`steam:${steamId64}`);
    this.rebuildFriendLists();
  }
}

export const SteamSocialService = new SteamSocialServiceImpl();
