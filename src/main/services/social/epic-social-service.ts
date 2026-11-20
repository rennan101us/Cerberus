import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type {
  ChatMessageDto,
  FriendRequest,
  SocialGameInvite,
  UserFriend,
} from "@types";
import { logger } from "@main/services/logger";
import { EpicStoreService } from "@main/services/stores/epic-store-service";
import {
  escapeXml,
  parseEpicMessageStanza,
  parseEpicPresenceStanza,
} from "./epic-xmpp-parser";
import { SocialChatStore } from "./social-chat-store";

const EPIC_FRIENDS_BASE =
  "https://friends-public-service-prod.ol.epicgames.com/friends/api/v1";
const EPIC_ACCOUNT_BASE =
  "https://account-public-service-prod.ol.epicgames.com/account/api/public/account";
const EPIC_PARTY_BASE =
  "https://party-service-prod.ol.epicgames.com/party/api/v1";
const EPIC_XMPP_WS_URL = "wss://xmpp-service-prod.ol.epicgames.com";
const EPIC_XMPP_DOMAIN = "prod.ol.epicgames.com";

export interface EpicSocialEvents {
  onFriendsChanged: () => void;
  onPresenceUpdate: (friend: UserFriend) => void;
  onIncomingMessage: (friend: UserFriend, message: ChatMessageDto) => void;
  onIncomingInvite: (friend: UserFriend, message: ChatMessageDto) => void;
}

interface EpicFriendSummaryItem {
  accountId: string;
}

interface EpicFriendsSummaryResponse {
  friends?: EpicFriendSummaryItem[];
  incoming?: EpicFriendSummaryItem[];
  outgoing?: EpicFriendSummaryItem[];
}

interface EpicAccountPublic {
  id: string;
  displayName?: string;
}

class EpicSocialServiceImpl {
  private ws: WebSocket | null = null;
  private xmppReady = false;
  private xmppConnecting = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private disposed = false;
  private streamBuffer = "";
  private xmppStep: "init" | "sasl" | "bind" | "session" | "ready" = "init";
  private listeners: EpicSocialEvents | null = null;

  private readonly friendsMap = new Map<string, UserFriend>();
  private readonly pendingRequests: FriendRequest[] = [];
  private accountId: string | null = null;

  public setEventHandlers(handlers: EpicSocialEvents) {
    this.listeners = handlers;
  }

  public isConnected(): boolean {
    return EpicStoreService.getAccount().connected;
  }

  public isXmppConnected(): boolean {
    return this.xmppReady && this.ws?.readyState === WebSocket.OPEN;
  }

  public getFriends(): UserFriend[] {
    return Array.from(this.friendsMap.values());
  }

  public getFriendRequests(): FriendRequest[] {
    return [...this.pendingRequests];
  }

  private async fetchDisplayNames(
    ids: string[],
    accessToken: string
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const unique = Array.from(new Set(ids)).filter(Boolean);
    for (let i = 0; i < unique.length; i += 50) {
      const chunk = unique.slice(i, i + 50);
      const url = new URL(EPIC_ACCOUNT_BASE);
      for (const id of chunk) {
        url.searchParams.append("accountId", id);
      }
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => null);
      if (!res?.ok) continue;
      const items = (await res.json()) as EpicAccountPublic[];
      for (const acc of items) {
        if (acc?.id) {
          result.set(acc.id, acc.displayName || acc.id);
        }
      }
    }
    return result;
  }

  public async refreshFriends(): Promise<UserFriend[]> {
    const token = await EpicStoreService.getValidAccessToken();
    if (!token) {
      this.friendsMap.clear();
      this.pendingRequests.splice(0, this.pendingRequests.length);
      return [];
    }
    this.accountId = token.accountId;

    const summaryRes = await fetch(
      `${EPIC_FRIENDS_BASE}/${token.accountId}/summary`,
      {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      }
    );
    if (!summaryRes.ok) {
      throw new Error(`Epic friends summary HTTP ${summaryRes.status}`);
    }

    const summary = (await summaryRes.json()) as EpicFriendsSummaryResponse;
    const friendIds = (summary.friends ?? []).map((f) => f.accountId);
    const incomingIds = (summary.incoming ?? []).map((f) => f.accountId);
    const outgoingIds = (summary.outgoing ?? []).map((f) => f.accountId);

    const names = await this.fetchDisplayNames(
      [...friendIds, ...incomingIds, ...outgoingIds],
      token.accessToken
    );

    const kept = new Set<string>();
    for (const accId of friendIds) {
      const id = `epic:${accId}`;
      kept.add(id);
      const prev = this.friendsMap.get(id);
      this.friendsMap.set(id, {
        ...(prev ?? {}),
        id,
        provider: "epic",
        externalId: accId,
        displayName: names.get(accId) || prev?.displayName || accId,
        profileImageUrl: prev?.profileImageUrl ?? null,
        currentGame: prev?.currentGame ?? null,
        isOnline: prev?.isOnline ?? false,
        personaState: prev?.personaState ?? "offline",
      });
    }

    for (const key of this.friendsMap.keys()) {
      if (!kept.has(key)) this.friendsMap.delete(key);
    }

    const nextRequests: FriendRequest[] = [
      ...incomingIds.map((accId) => ({
        id: `epic:${accId}`,
        provider: "epic" as const,
        externalId: accId,
        displayName: names.get(accId) || accId,
        profileImageUrl: null,
        type: "RECEIVED" as const,
      })),
      ...outgoingIds.map((accId) => ({
        id: `epic:${accId}`,
        provider: "epic" as const,
        externalId: accId,
        displayName: names.get(accId) || accId,
        profileImageUrl: null,
        type: "SENT" as const,
      })),
    ];

    this.pendingRequests.splice(
      0,
      this.pendingRequests.length,
      ...nextRequests
    );
    this.listeners?.onFriendsChanged();
    return this.getFriends();
  }

  public async connect(): Promise<boolean> {
    this.disposed = false;
    const token = await EpicStoreService.getValidAccessToken();
    if (!token) return false;
    this.accountId = token.accountId;

    await this.refreshFriends().catch((err) => {
      logger.warn("[EpicSocial] Failed initial friends refresh", err);
    });

    this.connectXmpp(token.accountId, token.accessToken);
    return true;
  }

  private connectXmpp(accountId: string, accessToken: string) {
    if (this.disposed || this.xmppConnecting) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.xmppConnecting = true;
    this.xmppReady = false;
    this.xmppStep = "init";
    this.streamBuffer = "";

    const ws = new WebSocket(EPIC_XMPP_WS_URL, "xmpp");
    this.ws = ws;

    ws.on("open", () => {
      this.xmppConnecting = false;
      this.reconnectAttempts = 0;
      ws.send(
        `<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="${EPIC_XMPP_DOMAIN}" version="1.0"/>`
      );
    });

    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      void this.handleXmppChunk(text, accountId, accessToken);
    });

    ws.on("close", () => {
      this.xmppConnecting = false;
      this.xmppReady = false;
      this.stopKeepAlive();
      if (!this.disposed && EpicStoreService.getAccount().connected) {
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      this.xmppConnecting = false;
      logger.warn("[EpicSocial] XMPP WebSocket warning", err.message);
    });
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.disposed) return;
    const delay = Math.min(
      60_000,
      2_000 * 2 ** Math.min(this.reconnectAttempts, 5)
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      const token = await EpicStoreService.getValidAccessToken().catch(
        () => null
      );
      if (token) {
        this.connectXmpp(token.accountId, token.accessToken);
      }
    }, delay);
  }

  private async handleXmppChunk(
    chunk: string,
    accountId: string,
    accessToken: string
  ) {
    this.streamBuffer += chunk;
    const buf = this.streamBuffer;

    if (this.xmppStep === "init" && buf.includes("<stream:features")) {
      this.streamBuffer = "";
      this.xmppStep = "sasl";
      const sasl = Buffer.from(
        `\0${accountId}\0${accessToken}`,
        "utf8"
      ).toString("base64");
      this.ws?.send(
        `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${sasl}</auth>`
      );
      return;
    }

    if (this.xmppStep === "sasl" && buf.includes("<success")) {
      this.streamBuffer = "";
      this.xmppStep = "bind";
      this.ws?.send(
        `<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="${EPIC_XMPP_DOMAIN}" version="1.0"/>`
      );
      return;
    }

    if (this.xmppStep === "bind" && buf.includes("<stream:features")) {
      this.streamBuffer = "";
      this.xmppStep = "session";
      const resource = `V2:Launcher:WIN::${randomUUID()}`;
      this.ws?.send(
        `<iq type="set" id="_bind_auth_2" xmlns="jabber:client"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>${resource}</resource></bind></iq>`
      );
      return;
    }

    if (
      this.xmppStep === "session" &&
      buf.includes('id="_bind_auth_2"') &&
      buf.includes('type="result"')
    ) {
      this.streamBuffer = "";
      this.ws?.send(
        `<iq type="set" id="_session_auth_2" xmlns="jabber:client"><session xmlns="urn:ietf:params:xml:ns:xmpp-session"/></iq>`
      );
      return;
    }

    if (
      this.xmppStep === "session" &&
      buf.includes('id="_session_auth_2"') &&
      buf.includes('type="result"')
    ) {
      this.streamBuffer = "";
      this.xmppStep = "ready";
      this.xmppReady = true;
      this.ws?.send("<presence/>");
      this.stopKeepAlive();
      this.keepAliveTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(" ");
        }
      }, 45_000);
      this.listeners?.onFriendsChanged();
      return;
    }

    if (this.xmppStep !== "ready") return;

    // Extract complete <presence ...>...</presence>, <presence .../>, <message ...>...</message> stanzas
    const stanzaRe = /<(presence|message)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/gi;
    let lastEnd = 0;
    let match: RegExpExecArray | null;
    while ((match = stanzaRe.exec(this.streamBuffer)) !== null) {
      lastEnd = stanzaRe.lastIndex;
      const stanza = match[0];
      if (match[1].toLowerCase() === "presence") {
        this.handlePresenceStanza(stanza);
      } else {
        await this.handleMessageStanza(stanza);
      }
    }
    if (lastEnd > 0) {
      this.streamBuffer = this.streamBuffer.slice(lastEnd);
    } else if (this.streamBuffer.length > 256_000) {
      this.streamBuffer = "";
    }
  }

  private handlePresenceStanza(stanza: string) {
    const presence = parseEpicPresenceStanza(stanza);
    if (!presence || presence.accountId === this.accountId) return;

    const id = `epic:${presence.accountId}`;
    const prev = this.friendsMap.get(id);
    if (!prev) return;

    const updated: UserFriend = {
      ...prev,
      isOnline: presence.isOnline,
      personaState: !presence.isOnline
        ? "offline"
        : presence.gameTitle
          ? "in-game"
          : "online",
      richPresence: presence.statusText,
      currentGame: presence.gameTitle
        ? {
            shop: "epic",
            objectId: presence.appId || presence.gameTitle,
            title: presence.gameTitle,
            iconUrl: null,
            libraryHeroImageUrl: "",
            libraryImageUrl: "",
            logoImageUrl: "",
            logoPosition: null,
            coverImageUrl: "",
            downloadSources: [],
            sessionDurationInSeconds: 0,
          }
        : null,
      gameLobby: presence.joinable
        ? {
            appId: presence.appId ?? undefined,
            partyId: presence.partyId ?? undefined,
            joinable: true,
          }
        : null,
    };

    this.friendsMap.set(id, updated);
    this.listeners?.onPresenceUpdate(updated);
  }

  private async handleMessageStanza(stanza: string) {
    const parsed = parseEpicMessageStanza(stanza);
    if (!parsed || parsed.kind === "unknown") return;

    const id = `epic:${parsed.fromAccountId}`;
    const friend: UserFriend = this.friendsMap.get(id) ?? {
      id,
      provider: "epic",
      externalId: parsed.fromAccountId,
      displayName: parsed.fromAccountId,
      profileImageUrl: null,
      currentGame: null,
      isOnline: true,
      personaState: "online",
    };

    const stored = await SocialChatStore.appendMessage({
      friend,
      senderId: friend.id,
      body: parsed.body,
      clientNonce: parsed.invite?.id ?? `epic-${randomUUID()}`,
      createdAt: parsed.invite?.createdAt ?? new Date().toISOString(),
      incrementUnread: true,
      invite: parsed.invite,
    });

    this.listeners?.onIncomingMessage(friend, stored);
    if (parsed.invite) {
      this.listeners?.onIncomingInvite(friend, stored);
    }
  }

  public async disconnect(): Promise<void> {
    this.disposed = true;
    this.xmppReady = false;
    this.xmppConnecting = false;
    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.friendsMap.clear();
    this.pendingRequests.splice(0, this.pendingRequests.length);
  }

  public async sendMessage(
    targetAccountId: string,
    body: string
  ): Promise<ChatMessageDto> {
    if (!this.isXmppConnected() || !this.ws) {
      throw new Error(
        "Conexão XMPP da Epic ainda não está pronta. Aguarde alguns segundos ou reconecte sua conta Epic."
      );
    }

    const toJid = `${targetAccountId}@${EPIC_XMPP_DOMAIN}`;
    this.ws.send(
      `<message to="${escapeXml(toJid)}" type="chat" id="${randomUUID()}"><body>${escapeXml(body)}</body></message>`
    );

    const id = `epic:${targetAccountId}`;
    const friend: UserFriend = this.friendsMap.get(id) ?? {
      id,
      provider: "epic",
      externalId: targetAccountId,
      displayName: targetAccountId,
      profileImageUrl: null,
      currentGame: null,
    };

    return SocialChatStore.appendMessage({
      friend,
      senderId: `epic:${this.accountId ?? "self"}`,
      body,
      clientNonce: `epic-self-${randomUUID()}`,
      incrementUnread: false,
    });
  }

  public async sendGameInvite(params: {
    targetAccountId: string;
    appId?: string;
    gameTitle: string;
  }): Promise<ChatMessageDto> {
    const token = await EpicStoreService.getValidAccessToken();
    if (!token) {
      throw new Error("Conta Epic Games não conectada.");
    }

    const { targetAccountId, appId, gameTitle } = params;

    // Best-effort Epic Party ping (supported when target game uses Epic Party service)
    await fetch(
      `${EPIC_PARTY_BASE}/Fortnite/user/${token.accountId}/pings/${targetAccountId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meta: {
            "urn:epic:invite:platformdata_s": "",
          },
        }),
      }
    ).catch(() => null);

    if (this.isXmppConnected() && this.ws) {
      const toJid = `${targetAccountId}@${EPIC_XMPP_DOMAIN}`;
      const wireText = `[Convite Epic: ${gameTitle}]${appId ? ` (App: ${appId})` : ""}`;
      this.ws.send(
        `<message to="${escapeXml(toJid)}" type="chat" id="${randomUUID()}"><body>${escapeXml(wireText)}</body></message>`
      );
    }

    const id = `epic:${targetAccountId}`;
    const friend: UserFriend = this.friendsMap.get(id) ?? {
      id,
      provider: "epic",
      externalId: targetAccountId,
      displayName: targetAccountId,
      profileImageUrl: null,
      currentGame: null,
    };

    const inviteId = `epic-out-inv-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const invite: SocialGameInvite = {
      id: inviteId,
      provider: "epic",
      appId,
      gameTitle,
      inviterId: `epic:${token.accountId}`,
      createdAt,
      status: "pending",
    };

    return SocialChatStore.appendMessage({
      friend,
      senderId: `epic:${token.accountId}`,
      body: `Convite enviado para jogar ${gameTitle}`,
      clientNonce: inviteId,
      createdAt,
      incrementUnread: false,
      invite,
    });
  }

  public async addFriendByDisplayName(displayName: string): Promise<void> {
    const token = await EpicStoreService.getValidAccessToken();
    if (!token) throw new Error("Conta Epic Games não conectada.");

    const lookupRes = await fetch(
      `${EPIC_ACCOUNT_BASE}/displayName/${encodeURIComponent(displayName.trim())}`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } }
    );
    if (!lookupRes.ok) {
      throw new Error("Usuário Epic não encontrado com esse nome de exibição.");
    }
    const target = (await lookupRes.json()) as EpicAccountPublic;
    if (!target?.id) throw new Error("Conta Epic inválida.");

    const addRes = await fetch(
      `${EPIC_FRIENDS_BASE}/${token.accountId}/friends/${target.id}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token.accessToken}` },
      }
    );
    if (!addRes.ok) {
      throw new Error(`Não foi possível enviar pedido (${addRes.status}).`);
    }

    await this.refreshFriends();
  }

  public async respondFriendRequest(
    targetAccountId: string,
    accept: boolean
  ): Promise<void> {
    const token = await EpicStoreService.getValidAccessToken();
    if (!token) throw new Error("Conta Epic Games não conectada.");

    await fetch(
      `${EPIC_FRIENDS_BASE}/${token.accountId}/friends/${targetAccountId}`,
      {
        method: accept ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${token.accessToken}` },
      }
    );
    await this.refreshFriends();
  }

  public async removeFriend(targetAccountId: string): Promise<void> {
    return this.respondFriendRequest(targetAccountId, false);
  }
}

export const EpicSocialService = new EpicSocialServiceImpl();
