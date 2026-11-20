import { useCallback, useContext, useEffect, useState } from "react";
import "./settings-appearance.scss";
import { ThemeActions, ThemeCard, ThemePlaceholder } from "./index";
import type { LauncherHighlightThemeId, Theme } from "@types";
import { ImportThemeModal } from "./modals/import-theme-modal";
import { settingsContext } from "@renderer/context";
import { useNavigate } from "react-router-dom";
import { levelDBService } from "@renderer/services/leveldb.service";
import { useAppSelector } from "@renderer/hooks";
import {
  applyHighlightTheme,
  HIGHLIGHT_THEME_OPTIONS,
} from "@renderer/helpers/highlight-theme";
import cn from "classnames";

interface SettingsAppearanceProps {
  appearance: {
    theme: string | null;
    authorId: string | null;
    authorName: string | null;
  };
}

export function SettingsAppearance({
  appearance,
}: Readonly<SettingsAppearanceProps>) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [isImportThemeModalVisible, setIsImportThemeModalVisible] =
    useState(false);
  const [importTheme, setImportTheme] = useState<{
    theme: string;
    authorId: string;
    authorName: string;
  } | null>(null);
  const [hasShownModal, setHasShownModal] = useState(false);

  const { clearTheme, updateUserPreferences } = useContext(settingsContext);
  const navigate = useNavigate();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const activeHighlight: LauncherHighlightThemeId =
    userPreferences?.highlightTheme ?? "cerberus";
  const customHighlightColor =
    userPreferences?.customHighlightColor ?? "#6F31FF";

  const handleSelectHighlight = async (
    themeId: LauncherHighlightThemeId,
    customHex?: string
  ) => {
    applyHighlightTheme(themeId, customHex ?? customHighlightColor);
    await updateUserPreferences({
      highlightTheme: themeId,
      ...(customHex ? { customHighlightColor: customHex } : {}),
    });
  };

  const loadThemes = useCallback(async () => {
    const themesList = (await levelDBService.values("themes")) as Theme[];
    setThemes(themesList);
  }, []);

  useEffect(() => {
    loadThemes();
  }, [loadThemes]);

  useEffect(() => {
    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      loadThemes();
    });

    return () => unsubscribe();
  }, [loadThemes]);

  useEffect(() => {
    if (
      appearance.theme &&
      appearance.authorId &&
      appearance.authorName &&
      !hasShownModal
    ) {
      setIsImportThemeModalVisible(true);
      setImportTheme({
        theme: appearance.theme,
        authorId: appearance.authorId,
        authorName: appearance.authorName,
      });
      setHasShownModal(true);

      navigate("/settings", { replace: true });
      clearTheme();
    }
  }, [
    appearance.theme,
    appearance.authorId,
    appearance.authorName,
    navigate,
    hasShownModal,
    clearTheme,
  ]);

  const onThemeImported = useCallback(() => {
    setIsImportThemeModalVisible(false);
    setImportTheme(null);
    loadThemes();
  }, [loadThemes]);

  return (
    <div className="settings-appearance">
      <div className="settings-appearance__highlight-section">
        <div className="settings-appearance__highlight-header">
          <div>
            <h4>Cor de Destaque (Highlight)</h4>
            <p>
              Personalize a cor de destaque da interface do Cerberus. O padrão
              mantém o visual original.
            </p>
          </div>
          <label className="settings-appearance__custom-picker">
            <span>Personalizada</span>
            <input
              type="color"
              value={customHighlightColor}
              onChange={(e) => handleSelectHighlight("custom", e.target.value)}
            />
          </label>
        </div>

        <div className="settings-appearance__highlight-grid">
          {HIGHLIGHT_THEME_OPTIONS.map((opt) => {
            const isActive = activeHighlight === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={cn("settings-appearance__highlight-card", {
                  "settings-appearance__highlight-card--active": isActive,
                })}
                onClick={() => handleSelectHighlight(opt.id)}
              >
                <span
                  className="settings-appearance__highlight-swatch"
                  style={{
                    background: `linear-gradient(135deg, ${opt.primary}, ${opt.secondary})`,
                  }}
                />
                <span className="settings-appearance__highlight-meta">
                  <strong>{opt.name}</strong>
                  <small>{opt.subtitle}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ThemeActions onListUpdated={loadThemes} themesCount={themes.length} />

      <div className="settings-appearance__themes">
        {!themes.length ? (
          <ThemePlaceholder onListUpdated={loadThemes} />
        ) : (
          [...themes]
            .sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime()
            )
            .map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                onListUpdated={loadThemes}
              />
            ))
        )}
      </div>

      {importTheme && (
        <ImportThemeModal
          visible={isImportThemeModalVisible}
          onClose={() => {
            setIsImportThemeModalVisible(false);
            clearTheme();
            setHasShownModal(false);
          }}
          onThemeImported={onThemeImported}
          themeName={importTheme.theme}
          authorId={importTheme.authorId}
          authorName={importTheme.authorName}
        />
      )}
    </div>
  );
}
