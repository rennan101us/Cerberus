import type { LibraryGame } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SidebarModal, type SidebarModalTab } from "../../../common";
import { resolvePreferredGameAssets } from "../../../../helpers";
import { useUserDetails } from "../../../../hooks/use-user-details.hook";

import "./styles.scss";
import {
  GameCustomizationSettingsTab,
  type GameCustomizationSettingsProps,
  GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID,
} from "./customization-tab";
import {
  GameLaunchSettingsTab,
  type GameLaunchSettingsProps,
  GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID,
} from "./launch-tab";
import {
  GameCloudSettingsTab,
  type GameCloudSettingsProps,
  GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID,
} from "./cloud-tab";
import {
  GameCloudV2SettingsTab,
  GAME_CLOUD_V2_SETTINGS_PRIMARY_CONTROL_ID,
} from "./cloud-v2-tab";
import {
  GameDownloadsSettingsTab,
  GAME_DOWNLOADS_SETTINGS_PRIMARY_CONTROL_ID,
} from "./downloads-tab";
import {
  GameDangerZoneSettingsTab,
  GAME_DANGER_ZONE_PRIMARY_CONTROL_ID,
} from "./danger-zone-tab";
import {
  GameCompatibilitySettingsTab,
  GAME_COMPATIBILITY_SETTINGS_PRIMARY_CONTROL_ID,
} from "./compatibility-tab";
import {
  GameSwitchSettingsTab,
  GAME_SWITCH_SETTINGS_PRIMARY_CONTROL_ID,
} from "./switch-settings-tab";
import {
  GameMacOsRedWineSettingsTab,
  GAME_MACOS_RED_WINE_PRIMARY_CONTROL_ID,
} from "./macos-red-wine-tab";
import {
  GameICloudSaveTab,
  GAME_ICLOUD_SAVE_PRIMARY_CONTROL_ID,
} from "./icloud-save-tab";
import {
  shouldShowCloudSaveV2Tab,
  shouldShowLegacyCloudSaveTab,
} from "./cloud-tab-visibility";

type GameSettingsTabId =
  | "switch_settings"
  | "launch"
  | "customization"
  | "hydra_cloud"
  | "hydra_cloud_legacy"
  | "icloud_save"
  | "compatibility"
  | "downloads"
  | "danger_zone";

const GAME_SETTINGS_TAB_FOCUS_IDS: Record<GameSettingsTabId, string> = {
  switch_settings: GAME_SWITCH_SETTINGS_PRIMARY_CONTROL_ID,
  launch: GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID,
  customization: GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID,
  hydra_cloud: GAME_CLOUD_V2_SETTINGS_PRIMARY_CONTROL_ID,
  hydra_cloud_legacy: GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID,
  icloud_save: GAME_ICLOUD_SAVE_PRIMARY_CONTROL_ID,
  downloads: GAME_DOWNLOADS_SETTINGS_PRIMARY_CONTROL_ID,
  danger_zone: GAME_DANGER_ZONE_PRIMARY_CONTROL_ID,
  compatibility: GAME_COMPATIBILITY_SETTINGS_PRIMARY_CONTROL_ID,
};

interface GameSettingsModalProps {
  visible: boolean;
  game: LibraryGame;
  removeFilesGame?: LibraryGame;
  launchSettings: GameLaunchSettingsProps;
  customizationSettings: GameCustomizationSettingsProps;
  cloudSettings: GameCloudSettingsProps;
  onClose: () => void;
}

export function GameSettingsModal({
  visible,
  game,
  removeFilesGame,
  launchSettings,
  customizationSettings,
  cloudSettings,
  onClose,
}: Readonly<GameSettingsModalProps>) {
  const { t } = useTranslation(["game_details", "header"]);
  const isSwitchGame =
    game.shop === "switch1" || game.shop === "switch2";
  const isDarwin = globalThis.window.electron.platform === "darwin";
  const isLinux = globalThis.window.electron.platform === "linux";

  const [activeTabId, setActiveTabId] = useState<GameSettingsTabId>(
    isSwitchGame ? "switch_settings" : "launch"
  );
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const preferredAssets = useMemo(
    () => resolvePreferredGameAssets(game, null),
    [game]
  );
  const isDev = import.meta.env.DEV;
  const shouldShowCompatibilityTab =
    isLinux || (isDarwin && !isSwitchGame) || isDev;
  const shouldShowICloudTab =
    isDarwin && !isSwitchGame && game.shop !== "mac_native";
  const shouldShowDownloadsTab = game.shop !== "custom";
  const settingsLabel = t("settings", { ns: "header" });

  useEffect(() => {
    if (visible) {
      setActiveTabId(isSwitchGame ? "switch_settings" : "launch");
    }
  }, [isSwitchGame, visible]);

  const switchSettingsContent = useMemo(
    () => <GameSwitchSettingsTab game={game} />,
    [game]
  );
  const icloudSaveContent = useMemo(
    () => <GameICloudSaveTab game={game} />,
    [game]
  );
  const launchContent = useMemo(
    () => <GameLaunchSettingsTab {...launchSettings} />,
    [launchSettings]
  );
  const customizationContent = useMemo(
    () => <GameCustomizationSettingsTab {...customizationSettings} />,
    [customizationSettings]
  );
  const cloudContent = useMemo(
    () => <GameCloudSettingsTab {...cloudSettings} />,
    [cloudSettings]
  );
  const handleSelectExecutableFromCloudV2 = useCallback(() => {
    setActiveTabId("launch");
  }, []);
  const cloudV2Content = useMemo(
    () => (
      <GameCloudV2SettingsTab
        onSelectExecutable={handleSelectExecutableFromCloudV2}
      />
    ),
    [handleSelectExecutableFromCloudV2]
  );
  const downloadContent = useMemo(
    () => <GameDownloadsSettingsTab game={game} />,
    [game]
  );
  const dangerContent = useMemo(
    () => (
      <GameDangerZoneSettingsTab
        game={game}
        removeFilesGame={removeFilesGame}
        onClose={onClose}
      />
    ),
    [game, removeFilesGame, onClose]
  );
  const compatibilityContent = useMemo(
    () =>
      isDarwin && !isSwitchGame ? (
        <GameMacOsRedWineSettingsTab game={game} />
      ) : (
        <GameCompatibilitySettingsTab game={game} />
      ),
    [game, isDarwin, isSwitchGame]
  );

  const isSignedIn = userDetails !== null;
  const shouldShowCloudV2Tab = shouldShowCloudSaveV2Tab(
    game.shop,
    isSignedIn,
    hasActiveSubscription,
    game.platform
  );
  const shouldShowLegacyCloudTab = shouldShowLegacyCloudSaveTab(
    game.shop,
    isSignedIn,
    hasActiveSubscription,
    game.platform
  );

  useEffect(() => {
    const isUnavailableTab =
      (activeTabId === "switch_settings" && !isSwitchGame) ||
      (activeTabId === "hydra_cloud" && !shouldShowCloudV2Tab) ||
      (activeTabId === "hydra_cloud_legacy" && !shouldShowLegacyCloudTab) ||
      (activeTabId === "icloud_save" && !shouldShowICloudTab) ||
      (activeTabId === "compatibility" && !shouldShowCompatibilityTab) ||
      (activeTabId === "downloads" && !shouldShowDownloadsTab);

    if (isUnavailableTab) {
      setActiveTabId(isSwitchGame ? "switch_settings" : "launch");
    }
  }, [
    activeTabId,
    isSwitchGame,
    shouldShowCloudV2Tab,
    shouldShowCompatibilityTab,
    shouldShowDownloadsTab,
    shouldShowICloudTab,
    shouldShowLegacyCloudTab,
  ]);

  const tabs = useMemo<SidebarModalTab<GameSettingsTabId>[]>(
    () => [
      ...(isSwitchGame
        ? [
            {
              id: "switch_settings",
              label:
                game.shop === "switch2" ? "Switch 2 / Portar" : "Switch / Portar",
              content: switchSettingsContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      {
        id: "launch",
        label: t("settings_category_launch"),
        content: launchContent,
      },
      {
        id: "customization",
        label: t("settings_category_customization"),
        content: customizationContent,
      },
      ...(shouldShowCloudV2Tab
        ? [
            {
              id: "hydra_cloud",
              label: t("settings_category_hydra_cloud"),
              content: cloudV2Content,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowLegacyCloudTab
        ? [
            {
              id: "hydra_cloud_legacy",
              label: t(
                shouldShowCloudV2Tab
                  ? "settings_category_legacy_saves"
                  : "settings_category_hydra_cloud"
              ),
              content: cloudContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowICloudTab
        ? [
            {
              id: "icloud_save",
              label: "iCloud Saves",
              content: icloudSaveContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowCompatibilityTab
        ? [
            {
              id: "compatibility",
              label:
                isDarwin && !isSwitchGame
                  ? "Red Wine (macOS)"
                  : t("settings_category_compatibility"),
              content: compatibilityContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowDownloadsTab
        ? [
            {
              id: "downloads",
              label: t("settings_category_downloads"),
              content: downloadContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      {
        id: "danger_zone",
        label: t("settings_category_danger_zone"),
        content: dangerContent,
      },
    ],
    [
      cloudContent,
      cloudV2Content,
      compatibilityContent,
      customizationContent,
      dangerContent,
      downloadContent,
      game.shop,
      icloudSaveContent,
      isDarwin,
      isSwitchGame,
      launchContent,
      shouldShowCloudV2Tab,
      shouldShowCompatibilityTab,
      shouldShowDownloadsTab,
      shouldShowICloudTab,
      shouldShowLegacyCloudTab,
      switchSettingsContent,
      t,
    ]
  );

  const entryFocusId =
    activeTabId === "compatibility" && isDarwin && !isSwitchGame
      ? GAME_MACOS_RED_WINE_PRIMARY_CONTROL_ID
      : GAME_SETTINGS_TAB_FOCUS_IDS[activeTabId];

  return (
    <SidebarModal
      visible={visible}
      onClose={onClose}
      title={settingsLabel}
      coverImage={preferredAssets.heroSrc || undefined}
      className="game-settings-modal"
      ariaLabel={settingsLabel}
      contentEntryFocusId={entryFocusId}
      tabs={tabs}
      activeTabId={activeTabId}
      onActiveTabChange={setActiveTabId}
    />
  );
}
