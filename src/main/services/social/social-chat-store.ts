import type {
  ChatConversationsPage,
  ChatMessageDto,
  ChatUnreadState,
  SocialGameInvite,
  StoreProvider,
  UserFriend,
} from "@types";
import {
  socialChatMessagesSublevel,
  socialConversationsSublevel,
  type StoredSocialConversation,
} from "@main/level";

const padSeq = (seq: number) => String(Math.max(0, seq)).padStart(12, "0");

const messageKey = (friendId: string, seq: number) =>
  `${friendId}:${padSeq(seq)}`;

export class SocialChatStore {
  public static async ensureConversation(
    friend: UserFriend
  ): Promise<StoredSocialConversation> {
    const existing = await socialConversationsSublevel
      .get(friend.id)
      .catch(() => null);
    const provider: StoreProvider =
      friend.provider ?? (friend.id.startsWith("epic:") ? "epic" : "steam");
    const externalId =
      friend.externalId ?? friend.id.replace(/^(steam|epic):/, "");

    if (existing) {
      const updated: StoredSocialConversation = {
        ...existing,
        friend: { ...existing.friend, ...friend },
      };
      await socialConversationsSublevel.put(friend.id, updated);
      return updated;
    }

    const created: StoredSocialConversation = {
      friendId: friend.id,
      provider,
      externalId,
      friend,
      lastSeq: 0,
      unreadCount: 0,
      lastMessage: null,
      updatedAt: new Date().toISOString(),
    };
    await socialConversationsSublevel.put(friend.id, created);
    return created;
  }

  public static async appendMessage(params: {
    friend: UserFriend;
    senderId: string;
    body: string;
    clientNonce: string;
    createdAt?: string;
    incrementUnread?: boolean;
    invite?: SocialGameInvite;
    dedupeKey?: string;
  }): Promise<ChatMessageDto> {
    const conv = await this.ensureConversation(params.friend);

    if (params.dedupeKey) {
      // Check recent tail for duplicate Steam history entries
      for await (const [, existingMsg] of socialChatMessagesSublevel.iterator({
        gte: messageKey(params.friend.id, Math.max(1, conv.lastSeq - 30)),
        lte: messageKey(params.friend.id, conv.lastSeq),
      })) {
        if (existingMsg.clientNonce === params.dedupeKey) {
          return existingMsg;
        }
      }
    }

    const seq = conv.lastSeq + 1;
    const createdAt = params.createdAt ?? new Date().toISOString();
    const dto: ChatMessageDto = {
      seq,
      senderId: params.senderId,
      body: params.body,
      clientNonce: params.dedupeKey ?? params.clientNonce,
      createdAt,
      ...(params.invite ? { invite: params.invite } : {}),
    };

    await socialChatMessagesSublevel.put(
      messageKey(params.friend.id, seq),
      dto
    );

    const updatedConv: StoredSocialConversation = {
      ...conv,
      friend: { ...conv.friend, ...params.friend },
      lastSeq: seq,
      unreadCount: params.incrementUnread
        ? conv.unreadCount + 1
        : conv.unreadCount,
      lastMessage: dto,
      updatedAt: createdAt,
      ...(params.invite ? { lastInvite: params.invite } : {}),
    };
    await socialConversationsSublevel.put(params.friend.id, updatedConv);

    return dto;
  }

  public static async getMessages(
    friendId: string,
    options: { before?: number; take?: number } = {}
  ): Promise<{ messages: ChatMessageDto[]; hasMore: boolean }> {
    const take = Math.min(100, Math.max(1, options.take ?? 50));
    const upper =
      options.before !== undefined
        ? Math.max(0, options.before - 1)
        : 999999999999;

    const collected: ChatMessageDto[] = [];
    for await (const [, msg] of socialChatMessagesSublevel.iterator({
      gte: messageKey(friendId, 0),
      lte: messageKey(friendId, upper),
      reverse: true,
      limit: take + 1,
    })) {
      collected.push(msg);
    }

    const hasMore = collected.length > take;
    const sliced = collected.slice(0, take).reverse();
    return { messages: sliced, hasMore };
  }

  public static async getConversations(
    friendLookup?: Map<string, UserFriend>
  ): Promise<ChatConversationsPage> {
    const items: StoredSocialConversation[] = [];
    for await (const [, conv] of socialConversationsSublevel.iterator()) {
      items.push(conv);
    }

    items.sort(
      (a, b) => Date.parse(b.updatedAt || "0") - Date.parse(a.updatedAt || "0")
    );

    return {
      conversations: items
        .filter((conv) => conv.lastMessage !== null)
        .map((conv) => {
          const freshFriend = friendLookup?.get(conv.friendId);
          const f = freshFriend ?? conv.friend;
          const msg = conv.lastMessage!;
          return {
            friendId: conv.friendId,
            friend: {
              id: f.id,
              displayName: f.displayName,
              profileImageUrl: f.profileImageUrl,
              isOfficial: f.isOfficial,
              provider: f.provider ?? conv.provider,
              externalId: f.externalId ?? conv.externalId,
            },
            lastMessage: {
              senderId: msg.senderId,
              body: msg.body,
              hidden: msg.hidden,
              seq: msg.seq,
              createdAt: msg.createdAt,
            },
            lastMessageAt: msg.createdAt || conv.updatedAt,
            lastReadSeq:
              conv.unreadCount === 0
                ? conv.lastSeq
                : Math.max(0, conv.lastSeq - conv.unreadCount),
            unreadCount: conv.unreadCount,
            canSend: true,
          };
        }),
      nextCursor: null,
    };
  }

  public static async markRead(friendId: string): Promise<ChatUnreadState> {
    const conv = await socialConversationsSublevel
      .get(friendId)
      .catch(() => null);
    if (conv && conv.unreadCount > 0) {
      await socialConversationsSublevel.put(friendId, {
        ...conv,
        unreadCount: 0,
      });
    }
    return this.getUnreadState();
  }

  public static async getUnreadState(): Promise<ChatUnreadState> {
    const byFriend: Record<string, number> = {};
    const lastMessageAtByFriend: Record<string, string> = {};
    let totalUnread = 0;

    for await (const [, conv] of socialConversationsSublevel.iterator()) {
      if (conv.unreadCount > 0) {
        byFriend[conv.friendId] = conv.unreadCount;
        totalUnread += conv.unreadCount;
      }
      if (conv.lastMessage?.createdAt) {
        lastMessageAtByFriend[conv.friendId] = conv.lastMessage.createdAt;
      }
    }

    return {
      totalUnread,
      byFriend,
      lastMessageAtByFriend,
    };
  }

  public static async updateInviteStatus(
    friendId: string,
    inviteId: string,
    status: "pending" | "accepted" | "expired"
  ): Promise<void> {
    for await (const [key, msg] of socialChatMessagesSublevel.iterator({
      gte: messageKey(friendId, 0),
      lte: messageKey(friendId, 999999999999),
      reverse: true,
      limit: 40,
    })) {
      if (msg.invite?.id === inviteId) {
        await socialChatMessagesSublevel.put(key, {
          ...msg,
          invite: { ...msg.invite, status },
        });
        break;
      }
    }
  }
}
