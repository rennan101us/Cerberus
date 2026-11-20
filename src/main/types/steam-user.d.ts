declare module "steam-user" {
  import type { EventEmitter } from "node:events";

  export interface SteamIDLike {
    getSteamID64(): string;
    toString(): string;
    accountid: number;
  }

  export interface SteamPersona {
    persona_state?: number;
    game_played_app_id?: number | null;
    player_name?: string;
    avatar_url_icon?: string;
    avatar_url_medium?: string;
    avatar_url_full?: string;
    game_name?: string | null;
    game_lobby_id?: number | string | null;
    rich_presence?: Array<{ key?: string; value?: string }> | Record<string, string>;
    rich_presence_string?: string;
  }

  export interface SteamOwnedApp {
    appid: number;
    name?: string;
    playtime_forever?: number;
    img_icon_url?: string;
    img_logo_url?: string;
  }

  export interface IncomingSteamFriendMessage {
    steamid_friend: SteamIDLike;
    message: string;
    message_no_bbcode: string;
    server_timestamp: Date;
    ordinal: number;
    local_echo?: boolean;
  }

  export interface SteamChatClient extends EventEmitter {
    sendFriendMessage(
      steamId: SteamIDLike | string,
      message: string,
      options?: { chatEntryType?: number; containsBbCode?: boolean }
    ): Promise<{
      modified_message: string;
      server_timestamp: Date;
      ordinal: number;
    }>;
    sendFriendTyping(steamId: SteamIDLike | string): Promise<unknown>;
    getActiveFriendMessageSessions(options?: {
      conversationsSince?: Date | number;
    }): Promise<{
      sessions: Array<{
        steamid_friend: SteamIDLike;
        time_last_message: Date | null;
        time_last_view: Date | null;
        unread_message_count: number;
      }>;
    }>;
    getFriendMessageHistory(
      friendSteamId: SteamIDLike | string,
      options?: { maxCount?: number; wantBbcode?: boolean; lastTime?: Date | number }
    ): Promise<{
      messages: Array<{
        sender: SteamIDLike;
        server_timestamp: Date;
        ordinal: number;
        message: string;
        unread?: boolean;
      }>;
      more_available: boolean;
    }>;
  }

  export default class SteamUser extends EventEmitter {
    static EFriendRelationship: {
      None: number;
      Blocked: number;
      RequestRecipient: number;
      Friend: number;
      RequestInitiator: number;
      Ignored: number;
      IgnoredFriend: number;
      SuggestedFriend: number;
    };
    static EPersonaState: {
      Offline: number;
      Online: number;
      Busy: number;
      Away: number;
      Snooze: number;
      LookingToTrade: number;
      LookingToPlay: number;
    };

    steamID: SteamIDLike | null;
    chat: SteamChatClient;
    users: Record<string, SteamPersona>;
    myFriends: Record<string, number> | null;
    accountInfo: { name?: string; country?: string } | null;

    constructor(options?: Record<string, unknown>);
    logOn(details?: Record<string, unknown> | true): void;
    logOff(): void;
    setPersona(state: number, name?: string): void;
    gamesPlayed(apps: Array<number | string> | number | string, force?: boolean): void;
    getPersonas(
      steamids: Array<SteamIDLike | string>
    ): Promise<{ personas: Record<string, SteamPersona> }>;
    addFriend(
      steamID: SteamIDLike | string
    ): Promise<{ personaName?: string }>;
    removeFriend(steamID: SteamIDLike | string): void;
    getUserOwnedApps(
      steamID: SteamIDLike | string,
      options?: {
        includeAppInfo?: boolean;
        includePlayedFreeGames?: boolean;
        includeFreeSub?: boolean;
        skipUnvettedApps?: boolean;
      }
    ): Promise<{ app_count: number; apps: SteamOwnedApp[] }>;
    _sendUnified?: (
      method: string,
      payload: Record<string, unknown>,
      cb?: (body: unknown, hdr: { proto?: unknown }) => void
    ) => void;
  }
}
