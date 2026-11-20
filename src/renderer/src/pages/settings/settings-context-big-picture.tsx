import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { UserPreferences } from "@types";

const buildForm = (preferences: UserPreferences | null) => ({
  launchInBigPicture: preferences?.launchInBigPicture ?? false,
  bigPictureLaunchToLibraryPage:
    preferences?.bigPictureLaunchToLibraryPage ??
    preferences?.launchToLibraryPage ??
    false,
  bigPictureSoundsEnabled: preferences?.bigPictureSoundsEnabled ?? true,
  bigPictureVirtualKeyboardEnabled:
    preferences?.bigPictureVirtualKeyboardEnabled ?? true,
});

export function SettingsContextBigPicture() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState(() => buildForm(userPreferences));

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("big_picture_startup")}</h3>

        <CheckboxField
          label={t("launch_hydra_in_big_picture")}
          checked={form.launchInBigPicture}
          onChange={() =>
            handleChange({
              launchInBigPicture: !form.launchInBigPicture,
            })
          }
        />

        <CheckboxField
          label={t("launch_big_picture_in_library_page")}
          checked={form.bigPictureLaunchToLibraryPage}
          onChange={() =>
            handleChange({
              bigPictureLaunchToLibraryPage:
                !form.bigPictureLaunchToLibraryPage,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("big_picture_audio")}</h3>

        <CheckboxField
          label={t("big_picture_enable_sounds")}
          checked={form.bigPictureSoundsEnabled}
          onChange={() =>
            handleChange({
              bigPictureSoundsEnabled: !form.bigPictureSoundsEnabled,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("big_picture_input")}</h3>

        <CheckboxField
          label={t("big_picture_enable_virtual_keyboard")}
          checked={form.bigPictureVirtualKeyboardEnabled}
          onChange={() =>
            handleChange({
              bigPictureVirtualKeyboardEnabled:
                !form.bigPictureVirtualKeyboardEnabled,
            })
          }
        />
      </div>
    </div>
  );
}
