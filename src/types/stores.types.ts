import type { GameShop } from "./game.types";

export type StoreProvider = "steam" | "epic" | "gog";

export type SocialFriendsFilter = "all" | "online" | "steam" | "epic";

export interface StoreAccount {
  provider: StoreProvider;
  connected: boolean;
  /** Steam: steamId64. Epic: accountId. Gog: userId. */
  accountId?: string;
  accountName?: string;
  displayName?: string;
  avatarUrl?: string | null;
  lastSyncAt?: string | null;
  syncedGamesCount?: number;
}

export interface StoreAccountsState {
  steam: StoreAccount;
  epic: StoreAccount;
  gog: StoreAccount;
}

export interface SteamLoginSessionStatus {
  sessionId: string;
  status:
    | "idle"
    | "pending"
    | "qr-ready"
    | "needs-guard"
    | "authenticated"
    | "error"
    | "expired";
  qrDataUrl?: string;
  qrChallengeUrl?: string;
  guardType?: "device-code" | "email-code" | "device-confirmation";
  guardDomain?: string;
  accountName?: string;
  steamId64?: string;
  displayName?: string;
  avatarUrl?: string | null;
  error?: string;
}

export interface StoreLibraryGame {
  provider: StoreProvider;
  /** Steam: appId. Epic: legendary app_name. */
  storeId: string;
  title: string;
  coverUrl: string | null;
  /** Local library game key when already added to the Cerberus library. */
  installed: boolean;
  playtimeMinutes?: number;
}

export type StoreDownloadStatus =
  | "preparing"
  | "downloading"
  | "needs-input"
  | "completed"
  | "error"
  | "cancelled";

export interface StoreDownloadProgress {
  provider: StoreProvider;
  storeId: string;
  title: string;
  status: StoreDownloadStatus;
  /** 0..1 */
  progress: number;
  bytesDownloaded?: number;
  fileSize?: number;
  speedBytesPerSecond?: number;
  message?: string;
  /** Present when status === "needs-input" (Steam credentials / 2FA / QR). */
  prompt?: "username" | "password" | "steam-guard" | "email-code";
  qrDataUrl?: string;
  installPath?: string;
  error?: string;
}

export interface SteamDepotLoginInput {
  username: string;
  password: string;
}

export interface SocialGameInvite {
  id: string;
  provider: StoreProvider;
  appId?: string;
  gameTitle: string;
  lobbyId?: string;
  connectString?: string;
  partyId?: string;
  inviterId: string;
  createdAt: string;
  status?: "pending" | "accepted" | "expired";
}

export interface SocialSendInvitePayload {
  friendId: string;
  gameShop?: GameShop;
  objectId?: string;
  gameTitle?: string;
  lobbyId?: string;
  connectString?: string;
}

export interface SocialInvitableGame {
  shop: GameShop;
  objectId: string;
  title: string;
  iconUrl: string | null;
  isRunning?: boolean;
  isInstalled?: boolean;
}
