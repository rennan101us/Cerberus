import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, Modal } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { GameUninstallPreview, LibraryGame } from "@types";
import "./uninstall-game-modal.scss";

interface UninstallGameModalProps {
  visible: boolean;
  game: LibraryGame;
  onClose: () => void;
  onUninstalled: () => void;
}

function formatMb(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return "< 0.1 MB";
  return `${mb.toFixed(1)} MB`;
}

export function UninstallGameModal({
  visible,
  game,
  onClose,
  onUninstalled,
}: Readonly<UninstallGameModalProps>) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast, showWarningToast } = useToast();

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [preview, setPreview] = useState<GameUninstallPreview | null>(null);
  const [deleteSaves, setDeleteSaves] = useState(false);
  const [deleteStaging, setDeleteStaging] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoadingPreview(true);
    setDeleteSaves(false);
    setDeleteStaging(false);

    void window.electron
      .getGameUninstallPreview(game.shop, game.objectId)
      .then((res) => {
        if (!cancelled) setPreview(res);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [game.objectId, game.shop, visible]);

  const handleConfirm = async () => {
    setUninstalling(true);
    try {
      const result = await window.electron.uninstallGame(
        game.shop,
        game.objectId,
        {
          deleteSaves,
          deleteStaging: preview?.kind === "switch" ? deleteStaging : false,
        }
      );

      if (!result.ok) {
        showErrorToast(result.error || t("uninstall_game_failed"));
        return;
      }

      if (result.warnings.length > 0) {
        showWarningToast(result.warnings[0]);
      } else {
        showSuccessToast(
          t("uninstall_game_success", { game: game.title })
        );
      }

      onUninstalled();
      onClose();
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : t("uninstall_game_failed")
      );
    } finally {
      setUninstalling(false);
    }
  };

  const isSwitch = preview?.kind === "switch";
  const hasSaves = (preview?.savePaths.length ?? 0) > 0;
  const hasStaging = (preview?.stagingPaths.length ?? 0) > 0;

  return (
    <Modal
      visible={visible}
      title={t("danger_uninstall_modal_title", { game: game.title })}
      description={
        isSwitch
          ? t("danger_uninstall_switch_description", { game: game.title })
          : t("danger_uninstall_windows_description", { game: game.title })
      }
      onClose={uninstalling ? () => {} : onClose}
    >
      <div className="uninstall-game-modal__content">
        {loadingPreview ? (
          <div className="uninstall-game-modal__summary">
            <span>{t("uninstall_scanning")}</span>
          </div>
        ) : (
          <>
            <div className="uninstall-game-modal__summary">
              {preview?.installPath ? (
                <>
                  <strong>
                    {isSwitch
                      ? t("uninstall_app_bundle")
                      : t("uninstall_install_folder")}{" "}
                    ({formatMb(preview.installSizeBytes)})
                  </strong>
                  <span className="uninstall-game-modal__path">
                    {preview.installPath}
                  </span>
                </>
              ) : (
                <span>{t("uninstall_no_install_found")}</span>
              )}

              {!isSwitch && preview?.uninstallerPath && (
                <span className="uninstall-game-modal__hint">
                  {t("uninstall_detected_uninstaller")}:{" "}
                  <code>{preview.uninstallerPath.split("/").pop()}</code>
                </span>
              )}
              {!isSwitch && preview?.canUninstall && !preview?.uninstallerPath && (
                <span className="uninstall-game-modal__hint">
                  {t("uninstall_no_uninstaller_cleanup")}
                </span>
              )}
            </div>

            <div className="uninstall-game-modal__options">
              {isSwitch && (
                <CheckboxField
                  label={t("uninstall_delete_staging_checkbox", {
                    size: formatMb(preview?.stagingSizeBytes ?? 0),
                  })}
                  checked={deleteStaging}
                  disabled={!hasStaging || uninstalling}
                  onChange={(e) => setDeleteStaging(e.target.checked)}
                />
              )}

              <CheckboxField
                label={t("uninstall_delete_saves_checkbox", {
                  size: formatMb(preview?.saveSizeBytes ?? 0),
                })}
                checked={deleteSaves}
                disabled={!hasSaves || uninstalling}
                onChange={(e) => setDeleteSaves(e.target.checked)}
              />
            </div>
          </>
        )}

        <div className="uninstall-game-modal__actions">
          <Button
            onClick={onClose}
            theme="outline"
            disabled={uninstalling}
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void handleConfirm()}
            theme="danger"
            disabled={
              loadingPreview || uninstalling || !preview?.canUninstall
            }
          >
            {uninstalling
              ? t("uninstalling_progress")
              : t("danger_uninstall")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
