export type GameShop =
  | "steam"
  | "epic"
  | "gog"
  | "custom"
  | "launchbox"
  | "switch1"
  | "switch2"
  | "mac_native";

export type ShortcutLocation = "desktop" | "start_menu";

export interface UnlockedAchievement {
  name: string;
  unlockTime: number;
  hardcoreUnlockTime?: number | null;
  imageKey?: string | null;
}

export interface AchievementSet {
  id: number;
  name: string | null;
  order: number;
}

export interface SteamAchievement {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
  hidden: boolean;
  points?: number;
  globalUnlockPercentage?: number | null;
  set?: AchievementSet | null;
  externalSetId?: string;
  externalId?: string;
}

export interface UserAchievement extends SteamAchievement {
  unlocked: boolean;
  unlockTime: number | null;
  hardcoreUnlockTime?: number | null;
  source?: "steam" | "epic" | "retroachievements";
  canonicalAchievementId?: string;
  sourceObjectId?: string;
  sources?: Array<{
    shop: "steam" | "epic";
    objectId: string;
    name: string;
    unlockTime: number;
  }>;
  unlockedOn?: {
    hydra: boolean;
    retroachievements: boolean;
    steam: boolean;
    epic?: boolean;
  };
  imageUrl?: string | null;
}

export interface GameUninstallPreview {
  kind: "windows-red-wine" | "switch" | "generic";
  canUninstall: boolean;
  installPath: string | null;
  installSizeBytes: number;
  uninstallerPath: string | null;
  uninstallerSource: "directory" | "registry" | null;
  savePaths: string[];
  saveSizeBytes: number;
  stagingPaths: string[];
  stagingSizeBytes: number;
  bottleName: string | null;
}

export interface GameUninstallOptions {
  deleteSaves: boolean;
  deleteStaging?: boolean;
  removeFromLibrary?: boolean;
}

export interface GameUninstallResult {
  ok: boolean;
  uninstallerRan: boolean;
  removedPaths: string[];
  warnings: string[];
  error?: string;
}
