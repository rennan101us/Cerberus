import type {
  ChatMessageDto,
  SocialGameInvite,
  StoreProvider,
  UserFriend,
} from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export interface StoredSocialConversation {
  friendId: string;
  provider: StoreProvider;
  externalId: string;
  friend: UserFriend;
  lastSeq: number;
  unreadCount: number;
  lastMessage: ChatMessageDto | null;
  updatedAt: string;
  lastInvite?: SocialGameInvite;
}

export const socialChatMessagesSublevel = db.sublevel<string, ChatMessageDto>(
  levelKeys.socialChatMessages,
  {
    valueEncoding: "json",
  }
);

export const socialConversationsSublevel = db.sublevel<
  string,
  StoredSocialConversation
>(levelKeys.socialConversations, {
  valueEncoding: "json",
});
