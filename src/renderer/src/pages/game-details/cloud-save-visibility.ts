import type { GameShop } from "@types";

export type CloudSaveUiMode = "legacy" | "v2";
export type LegacyCloudSavePurpose = "active" | "archive";

export interface CloudSaveSettingsVisibility {
  showV2: boolean;
  showLegacy: boolean;
  legacyPurpose: LegacyCloudSavePurpose;
}

export interface CloudSaveVisibility {
  hero: CloudSaveUiMode | null;
  settings: CloudSaveSettingsVisibility;
}

export const isLegacyCloudSaveSettingsAvailable = (
  settings: CloudSaveSettingsVisibility,
  hasActiveSubscription: boolean,
  artifactCount: number
): boolean =>
  settings.showLegacy &&
  (settings.legacyPurpose === "active" ||
    (hasActiveSubscription && artifactCount > 0));

export const getCloudSaveVisibility = (
  shop: GameShop,
  _platform?: string | null
): CloudSaveVisibility => {
  // Windows games use native iCloud Drive saves; Hydra Cloud is disabled across Cerberus.
  void shop;
  return {
    hero: null,
    settings: {
      showV2: false,
      showLegacy: false,
      legacyPurpose: "archive",
    },
  };
};
