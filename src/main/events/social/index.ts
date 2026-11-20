import { registerEvent } from "../register-event";
import type {
  SocialGameInvite,
  SocialSendInvitePayload,
  StoreProvider,
} from "@types";
import { SocialHubService } from "@main/services/social/social-hub-service";

registerEvent("socialGetFriends", () => SocialHubService.getSnapshot());

registerEvent("socialGetConversations", () =>
  SocialHubService.getConversations()
);

registerEvent(
  "socialGetMessages",
  (_event, friendId: string, params?: { before?: number; take?: number }) =>
    SocialHubService.getMessages(friendId, params)
);

registerEvent("socialSendMessage", (_event, friendId: string, body: string) =>
  SocialHubService.sendMessage(friendId, body)
);

registerEvent("socialSendTyping", (_event, friendId: string) =>
  SocialHubService.sendTyping(friendId)
);

registerEvent("socialMarkRead", (_event, friendId: string) =>
  SocialHubService.markRead(friendId)
);

registerEvent(
  "socialAddFriend",
  (_event, provider: StoreProvider, query: string) =>
    SocialHubService.addFriend(provider, query)
);

registerEvent(
  "socialRespondFriendRequest",
  (_event, friendId: string, accept: boolean) =>
    SocialHubService.respondFriendRequest(friendId, accept)
);

registerEvent("socialRemoveFriend", (_event, friendId: string) =>
  SocialHubService.removeFriend(friendId)
);

registerEvent(
  "socialSendGameInvite",
  (_event, payload: SocialSendInvitePayload) =>
    SocialHubService.sendGameInvite(payload)
);

registerEvent("socialAcceptGameInvite", (_event, invite: SocialGameInvite) =>
  SocialHubService.acceptGameInvite(invite)
);

registerEvent("socialGetInvitableGames", (_event, provider: StoreProvider) =>
  SocialHubService.getInvitableGames(provider)
);
