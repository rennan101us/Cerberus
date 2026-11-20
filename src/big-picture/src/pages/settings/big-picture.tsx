import "./big-picture.scss";

import type { UserPreferences } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox, VerticalFocusGroup } from "../../components";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import {
  BIG_PICTURE_AUDIO_SECTION_REGION_ID,
  BIG_PICTURE_ITEM_FOCUS_IDS,
  BIG_PICTURE_SECTION_REGION_ID,
  BIG_PICTURE_STARTUP_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface BigPictureSettingsSectionProps {
  className?: string;
}

interface BigPictureForm {
  launchInBigPicture: boolean;
  bigPictureLaunchToLibraryPage: boolean;
  bigPictureSoundsEnabled: boolean;
  bigPictureVirtualKeyboardEnabled: boolean;
}

interface BigPictureItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: BigPictureForm = {
  launchInBigPicture: false,
  bigPictureLaunchToLibraryPage: false,
  bigPictureSoundsEnabled: true,
  bigPictureVirtualKeyboardEnabled: true,
};

const buildForm = (preferences: UserPreferences | null): BigPictureForm =>
  preferences
    ? {
        launchInBigPicture: preferences.launchInBigPicture ?? false,
        bigPictureLaunchToLibraryPage:
          preferences.bigPictureLaunchToLibraryPage ??
          preferences.launchToLibraryPage ??
          false,
        bigPictureSoundsEnabled: preferences.bigPictureSoundsEnabled ?? true,
        bigPictureVirtualKeyboardEnabled:
          preferences.bigPictureVirtualKeyboardEnabled ?? true,
      }
    : DEFAULT_FORM;

export function BigPictureSettingsSection({
  className,
}: Readonly<BigPictureSettingsSectionProps>) {
  const { t } = useTranslation("big_picture");
  const userPreferences = useUserPreferences();
  const [form, setForm] = useState<BigPictureForm>(() =>
    buildForm(userPreferences)
  );

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const updateUserPreferences = useCallback(
    async (values: Partial<BigPictureForm>) => {
      setForm((current) => ({ ...current, ...values }));

      await globalThis.window.electron.updateUserPreferences(values);
    },
    []
  );

  const handleLaunchInBigPictureChange = useCallback(
    (checked: boolean) => {
      updateUserPreferences({ launchInBigPicture: checked });
    },
    [updateUserPreferences]
  );

  const handleLaunchToLibraryPageChange = useCallback(
    (checked: boolean) => {
      updateUserPreferences({ bigPictureLaunchToLibraryPage: checked });
    },
    [updateUserPreferences]
  );

  const handleBigPictureSoundsChange = useCallback(
    (checked: boolean) => {
      updateUserPreferences({ bigPictureSoundsEnabled: checked });
    },
    [updateUserPreferences]
  );

  const handleVirtualKeyboardChange = useCallback(
    (checked: boolean) => {
      updateUserPreferences({ bigPictureVirtualKeyboardEnabled: checked });
    },
    [updateUserPreferences]
  );

  const startupItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "launch-in-big-picture",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.launchInBigPicture,
        label: t("settings_launch_in_big_picture"),
        checked: form.launchInBigPicture,
        onChange: handleLaunchInBigPictureChange,
      },
      {
        id: "launch-to-library-page",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.launchToLibraryPage,
        label: t("settings_launch_big_picture_in_library_page"),
        checked: form.bigPictureLaunchToLibraryPage,
        onChange: handleLaunchToLibraryPageChange,
      },
    ];
  }, [
    form.launchInBigPicture,
    form.bigPictureLaunchToLibraryPage,
    handleLaunchInBigPictureChange,
    handleLaunchToLibraryPageChange,
    t,
  ]);

  const inputItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "enable-virtual-keyboard",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.enableVirtualKeyboard,
        label: t("settings_enable_virtual_keyboard"),
        checked: form.bigPictureVirtualKeyboardEnabled,
        onChange: handleVirtualKeyboardChange,
      },
    ];
  }, [form.bigPictureVirtualKeyboardEnabled, handleVirtualKeyboardChange, t]);

  const audioItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "enable-big-picture-sounds",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.enableSounds,
        label: t("settings_enable_big_picture_sounds"),
        checked: form.bigPictureSoundsEnabled,
        onChange: handleBigPictureSoundsChange,
      },
    ];
  }, [form.bigPictureSoundsEnabled, handleBigPictureSoundsChange, t]);

  const inputNavigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    const previousFallback: FocusOverrideTarget = {
      type: "item",
      itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableSounds,
    };

    return Object.fromEntries(
      inputItems.map((item, index) => {
        const previousItem = inputItems[index - 1];
        const nextItem = inputItems[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : previousFallback,
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : {
                  type: "block",
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [inputItems]);

  const audioNavigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    const previousFallback: FocusOverrideTarget = {
      type: "item",
      itemId: BIG_PICTURE_ITEM_FOCUS_IDS.launchToLibraryPage,
    };

    return Object.fromEntries(
      audioItems.map((item, index) => {
        const previousItem = audioItems[index - 1];
        const nextItem = audioItems[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : previousFallback,
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : {
                  type: "item",
                  itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableVirtualKeyboard,
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [audioItems]);

  const startupNavigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      startupItems.map((item, index) => {
        const previousItem = startupItems[index - 1];
        const nextItem = startupItems[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : SETTINGS_HEADER_RETURN_TARGET,
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : {
                  type: "item",
                  itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableSounds,
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [startupItems]);

  return (
    <div
      className={
        className
          ? `big-picture-settings-section ${className}`
          : "big-picture-settings-section"
      }
    >
      <SettingsSection
        title={t("settings_startup_section_title")}
        description={t("settings_startup_section_description")}
      >
        <VerticalFocusGroup
          regionId={BIG_PICTURE_STARTUP_SECTION_REGION_ID}
          asChild
        >
          <div className="big-picture-settings-section__content">
            {startupItems.map((item) => (
              <Checkbox
                key={item.id}
                id={item.id}
                label={item.label}
                checked={item.checked}
                focusId={item.focusId}
                navigationOverrides={
                  startupNavigationOverridesByFocusId[item.focusId]
                }
                block
                onChange={item.onChange}
              />
            ))}
          </div>
        </VerticalFocusGroup>
      </SettingsSection>

      <SettingsSection
        title={t("settings_audio_section_title")}
        description={t("settings_audio_section_description")}
      >
        <VerticalFocusGroup
          regionId={BIG_PICTURE_AUDIO_SECTION_REGION_ID}
          asChild
        >
          <div className="big-picture-settings-section__content">
            {audioItems.map((item) => (
              <Checkbox
                key={item.id}
                id={item.id}
                label={item.label}
                checked={item.checked}
                focusId={item.focusId}
                navigationOverrides={
                  audioNavigationOverridesByFocusId[item.focusId]
                }
                block
                onChange={item.onChange}
              />
            ))}
          </div>
        </VerticalFocusGroup>
      </SettingsSection>

      <SettingsSection
        title={t("settings_input_section_title")}
        description={t("settings_input_section_description")}
      >
        <VerticalFocusGroup regionId={BIG_PICTURE_SECTION_REGION_ID} asChild>
          <div className="big-picture-settings-section__content">
            {inputItems.map((item) => (
              <Checkbox
                key={item.id}
                id={item.id}
                label={item.label}
                checked={item.checked}
                focusId={item.focusId}
                navigationOverrides={
                  inputNavigationOverridesByFocusId[item.focusId]
                }
                block
                onChange={item.onChange}
              />
            ))}
          </div>
        </VerticalFocusGroup>
      </SettingsSection>
    </div>
  );
}
