import "./content.scss";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox, VerticalFocusGroup } from "../../components";
import { ConfirmationModal } from "../../components/modals";
import { useUserDetails, useUserPreferences } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  CONTENT_ITEM_FOCUS_IDS,
  CONTENT_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";
import { isAchievementSouvenirsEnabled } from "@shared";
import type { UserPreferences } from "@types";

interface SettingsSectionProps {
  className?: string;
}

interface ContentForm {
  autoplayGameTrailers: boolean;
  disableNsfwAlert: boolean;
  showHiddenAchievementsDescription: boolean;
  enableSteamAchievements: boolean;
  enableAchievementSouvenirs: boolean;
  autoplayAnimatedArtwork: boolean;
  persistFiltersAndSorting: boolean;
}

interface ContentItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: ContentForm = {
  autoplayGameTrailers: true,
  disableNsfwAlert: false,
  showHiddenAchievementsDescription: false,
  enableSteamAchievements: false,
  enableAchievementSouvenirs: isAchievementSouvenirsEnabled(
    undefined,
    globalThis.window.electron.platform
  ),
  autoplayAnimatedArtwork: false,
  persistFiltersAndSorting: false,
};

const buildForm = (preferences: UserPreferences | null): ContentForm =>
  preferences
    ? {
        autoplayGameTrailers: preferences.autoplayGameTrailers ?? true,
        disableNsfwAlert: preferences.disableNsfwAlert ?? false,
        showHiddenAchievementsDescription:
          preferences.showHiddenAchievementsDescription ?? false,
        enableSteamAchievements: preferences.enableSteamAchievements ?? false,
        enableAchievementSouvenirs: isAchievementSouvenirsEnabled(
          preferences.enableAchievementSouvenirs,
          globalThis.window.electron.platform
        ),
        autoplayAnimatedArtwork: preferences.autoplayAnimatedArtwork ?? false,
        persistFiltersAndSorting: preferences.persistFiltersAndSorting ?? false,
      }
    : DEFAULT_FORM;

export function ContentSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const { t } = useTranslation("settings");
  const userPreferences = useUserPreferences();
  const { hasActiveSubscription } = useUserDetails();
  const [form, setForm] = useState<ContentForm>(() =>
    buildForm(userPreferences)
  );
  const [showWaylandSouvenirsWarning, setShowWaylandSouvenirsWarning] =
    useState(false);

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const updateUserPreferences = useCallback(
    async (values: Partial<ContentForm>) => {
      setForm((currentForm) => ({ ...currentForm, ...values }));

      await globalThis.window.electron.updateUserPreferences(values);
    },
    []
  );

  const handleAchievementSouvenirsChange = useCallback(
    (checked: boolean) => {
      if (checked && globalThis.window.electron.isWayland) {
        setShowWaylandSouvenirsWarning(true);
        return;
      }

      void updateUserPreferences({ enableAchievementSouvenirs: checked });
    },
    [updateUserPreferences]
  );

  const handleWaylandSouvenirsConfirm = useCallback(() => {
    setShowWaylandSouvenirsWarning(false);
    return updateUserPreferences({ enableAchievementSouvenirs: true });
  }, [updateUserPreferences]);

  const supportsSouvenirs = hasActiveSubscription;

  const items = useMemo<ContentItem[]>(() => {
    return [
      {
        id: "autoplay-game-trailers",
        focusId: CONTENT_ITEM_FOCUS_IDS.autoplayGameTrailers,
        label: t("autoplay_trailers_on_game_page"),
        checked: form.autoplayGameTrailers,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ autoplayGameTrailers: checked }),
      },
      {
        id: "disable-nsfw-alert",
        focusId: CONTENT_ITEM_FOCUS_IDS.disableNsfwAlert,
        label: t("disable_nsfw_alert"),
        checked: form.disableNsfwAlert,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ disableNsfwAlert: checked }),
      },
      {
        id: "show-hidden-achievements-description",
        focusId: CONTENT_ITEM_FOCUS_IDS.showHiddenAchievementsDescription,
        label: t("show_hidden_achievement_description"),
        checked: form.showHiddenAchievementsDescription,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            showHiddenAchievementsDescription: checked,
          }),
      },
      {
        id: "persist-filters-and-sorting",
        focusId: CONTENT_ITEM_FOCUS_IDS.persistFiltersAndSorting,
        label: t("persist_filters_and_sorting"),
        checked: form.persistFiltersAndSorting,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ persistFiltersAndSorting: checked }),
      },
      {
        id: "enable-steam-achievements",
        focusId: CONTENT_ITEM_FOCUS_IDS.enableSteamAchievements,
        label: t("enable_steam_achievements"),
        checked: form.enableSteamAchievements,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ enableSteamAchievements: checked }),
      },
      ...(supportsSouvenirs
        ? [
            {
              id: "enable-achievement-souvenirs",
              focusId: CONTENT_ITEM_FOCUS_IDS.enableAchievementSouvenirs,
              label: t("enable_achievement_souvenirs"),
              checked: form.enableAchievementSouvenirs,
              onChange: handleAchievementSouvenirsChange,
            },
          ]
        : []),
    ];
  }, [
    form,
    handleAchievementSouvenirsChange,
    supportsSouvenirs,
    t,
    updateUserPreferences,
  ]);

  const trailingItems = useMemo<ContentItem[]>(
    () => [
      {
        id: "autoplay-animated-artwork",
        focusId: CONTENT_ITEM_FOCUS_IDS.autoplayAnimatedArtwork,
        label: t("autoplay_animated_artwork"),
        checked: form.autoplayAnimatedArtwork,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ autoplayAnimatedArtwork: checked }),
      },
    ],
    [form.autoplayAnimatedArtwork, t, updateUserPreferences]
  );

  const navigationFocusIds = useMemo(
    () => [
      ...items.map((item) => item.focusId),
      ...trailingItems.map((item) => item.focusId),
    ],
    [items, trailingItems]
  );

  const navigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      navigationFocusIds.map((focusId, index) => {
        const previousFocusId = navigationFocusIds[index - 1];
        const nextFocusId = navigationFocusIds[index + 1];

        return [
          focusId,
          {
            up: previousFocusId
              ? {
                  type: "item",
                  itemId: previousFocusId,
                }
              : SETTINGS_HEADER_RETURN_TARGET,
            down: nextFocusId
              ? {
                  type: "item",
                  itemId: nextFocusId,
                }
              : {
                  type: "block",
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [navigationFocusIds]);

  const renderItem = (item: ContentItem) => (
    <Checkbox
      key={item.id}
      id={item.id}
      label={item.label}
      checked={item.checked}
      focusId={item.focusId}
      navigationOverrides={navigationOverridesByFocusId[item.focusId]}
      block
      onChange={item.onChange}
    />
  );

  return (
    <div
      className={
        className
          ? `content-settings-section ${className}`
          : "content-settings-section"
      }
    >
      <SettingsSection
        title="Preferences"
        description="Choose how Hydra should handle trailers, content warnings, and achievement details."
      >
        <VerticalFocusGroup regionId={CONTENT_SECTION_REGION_ID} asChild>
          <div className="content-settings-section__content">
            {items.map(renderItem)}
            {trailingItems.map(renderItem)}
          </div>
        </VerticalFocusGroup>
      </SettingsSection>

      <ConfirmationModal
        visible={showWaylandSouvenirsWarning}
        title={t("wayland_souvenirs_warning_title")}
        description={t("wayland_souvenirs_warning_description")}
        confirmLabel={t("wayland_souvenirs_warning_confirm")}
        onClose={() => setShowWaylandSouvenirsWarning(false)}
        onConfirm={handleWaylandSouvenirsConfirm}
      />
    </div>
  );
}
