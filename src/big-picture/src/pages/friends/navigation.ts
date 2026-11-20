import type { SocialFriendsFilter } from "@types";

export const FRIENDS_PAGE_REGION_ID = "friends-page";
export const FRIENDS_FILTERS_REGION_ID = "friends-filters";
export const FRIENDS_LIST_REGION_ID = "friends-list";
export const FRIENDS_CHAT_REGION_ID = "friends-chat";

export const FRIENDS_JOIN_BUTTON_ID = "friends-join-button";
export const FRIENDS_INVITE_BUTTON_ID = "friends-invite-button";
export const FRIENDS_CHAT_INPUT_ID = "friends-chat-input";
export const FRIENDS_CHAT_SEND_ID = "friends-chat-send";
export const FRIENDS_EMPTY_SETTINGS_BUTTON_ID = "friends-empty-settings-btn";

export function getFriendsFilterFocusId(filter: SocialFriendsFilter) {
  return `friends-filter:${filter}`;
}

export function getFriendsRowFocusId(friendId: string) {
  return `friends-row:${friendId}`;
}
