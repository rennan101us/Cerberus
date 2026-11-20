import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GameUninstallPreview, LibraryGame } from "@types";
import {
  applyLibraryGroupAction,
  findLibraryGamePresentation,
  getLibraryGameMembers,
  getOfficialStoreMembers,
  getRemoveFilesTarget,
  isLibraryGameDownloading,
  isSameRemoveFilesTarget,
  type RemoveFilesTarget,
} from "@shared";
import { useIsSteamLibraryExecutable } from "@renderer/hooks/use-steam-library-executable";
import {
  Button,
  Checkbox,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../../../common";
import { ConfirmationModal } from "../../../modals";
import { useSourceArchive } from "@renderer/hooks/use-source-archive";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { useBigPictureToast } from "../../../../hooks/use-big-picture-toast.hook";
import { useNavigation } from "../../../../hooks";

import "./danger-zone-tab.scss";

const UNINSTALL_MODAL_CANCEL_ID = "bp-game-uninstall-cancel-btn";

function formatUninstallMb(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return "< 0.1 MB";
  return `${mb.toFixed(1)} MB`;
}

function getConfirmationConfig(
  pendingAction: DangerAction,
  game: LibraryGame,
  pendingRemoveFilesTarget: RemoveFilesTarget | null,
  t: (key: string, options?: Record<string, unknown>) => string,
  handleRemoveFromLibrary: () => Promise<void>,
  handleResetAchievements: () => Promise<void>,
  handleRemoveFiles: () => Promise<void>
) {
  switch (pendingAction) {
    case "remove-from-library":
      return {
        title: t("remove_from_library"),
        description: t("remove_from_library_description", { game: game.title }),
        confirmLabel: t("remove_from_library"),
        onConfirm: handleRemoveFromLibrary,
      };
    case "reset-achievements":
      return {
        title: t("reset_achievements"),
        description: t(
          game.shop === "steam"
            ? "reset_achievements_steam_description"
            : "reset_achievements_souvenirs_description",
          { game: game.title }
        ),
        confirmLabel: t("reset_achievements"),
        onConfirm: handleResetAchievements,
      };
    case "remove-files":
      if (pendingRemoveFilesTarget?.kind === "steam") {
        return {
          title: t("remove_game_files_steam_title"),
          description: t("remove_game_files_steam_description", {
            game: pendingRemoveFilesTarget.game.title,
          }),
          confirmLabel: t("remove_game_files_steam_confirm"),
          onConfirm: handleRemoveFiles,
        };
      }
      return {
        title: t("remove_game_files"),
        description: t("remove_game_files_description", {
          game: pendingRemoveFilesTarget?.game.title ?? game.title,
        }),
        confirmLabel: t("remove_game_files"),
        onConfirm: handleRemoveFiles,
      };
  }
}

export const GAME_DANGER_ZONE_PRIMARY_CONTROL_ID =
  "game-danger-zone-primary-control";

interface GameDangerZoneSettingsTabProps {
  game: LibraryGame;
  removeFilesGame?: LibraryGame;
  onClose: () => void;
}

type DangerAction =
  | "remove-from-library"
  | "reset-achievements"
  | "remove-files";

export function GameDangerZoneSettingsTab({
  game,
  removeFilesGame,
  onClose,
}: Readonly<GameDangerZoneSettingsTabProps>) {
  const { t } = useTranslation("big_picture");
  const { showSuccessToast, showErrorToast, showWarningToast } =
    useBigPictureToast();
  const { setFocus } = useNavigation();
  const [pendingAction, setPendingAction] = useState<DangerAction | null>(null);
  const [pendingRemoveFilesTarget, setPendingRemoveFilesTarget] =
    useState<RemoveFilesTarget | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteSourceArchive, setDeleteSourceArchive] = useState(false);
  const [showUninstallModal, setShowUninstallModal] = useState(false);
  const [loadingUninstallPreview, setLoadingUninstallPreview] = useState(false);
  const [uninstallPreview, setUninstallPreview] =
    useState<GameUninstallPreview | null>(null);
  const [uninstallDeleteSaves, setUninstallDeleteSaves] = useState(false);
  const [uninstallDeleteStaging, setUninstallDeleteStaging] = useState(false);
  const [uninstallingGame, setUninstallingGame] = useState(false);
  const hasSourceArchive = useSourceArchive(
    pendingRemoveFilesTarget?.kind === "hydra"
      ? pendingRemoveFilesTarget.game
      : null,
    pendingAction === "remove-files"
  );

  useEffect(() => {
    setDeleteSourceArchive(false);
  }, [pendingAction]);

  const steamUninstallAvailable =
    typeof globalThis.window.electron.uninstallGameOnSteam === "function";
  const removeFilesSource = useMemo(
    () => removeFilesGame ?? game,
    [removeFilesGame, game]
  );
  const hydraRemoveFilesTarget = getRemoveFilesTarget(removeFilesSource, false);
  const steamMember = getOfficialStoreMembers(
    getLibraryGameMembers(removeFilesSource)
  ).steam;
  const isSteamLibraryExecutable = useIsSteamLibraryExecutable(
    steamMember,
    hydraRemoveFilesTarget === null
  );
  const removeFilesTarget = getRemoveFilesTarget(
    removeFilesSource,
    steamUninstallAvailable,
    isSteamLibraryExecutable === true
  );
  const isGameDownloading =
    removeFilesTarget?.kind === "hydra" &&
    isLibraryGameDownloading(removeFilesTarget.game);
  const removeFilesSectionTitle =
    removeFilesTarget?.kind === "steam"
      ? t("remove_game_files_steam_title")
      : t("remove_game_files");
  const removeFilesSectionDescription =
    removeFilesTarget?.kind === "steam"
      ? t("remove_game_files_steam_description", {
          game: removeFilesTarget.game.title,
        })
      : t("remove_game_files_description", {
          game: removeFilesTarget?.game.title ?? game.title,
        });

  const clearPendingAction = useCallback(() => {
    setPendingAction(null);
    setPendingRemoveFilesTarget(null);
  }, []);

  const handleRemoveFromLibrary = useCallback(async () => {
    setActionLoading(true);
    try {
      const library = await globalThis.window.electron.getLibrary(true);
      const members = findLibraryGamePresentation(library, game)?.members ?? [
        game,
      ];
      await applyLibraryGroupAction(members, async (member) => {
        if (member.download)
          await globalThis.window.electron.cancelGameDownload(
            member.shop,
            member.objectId
          );
        await globalThis.window.electron.removeGameFromLibrary(
          member.shop,
          member.objectId
        );
      });
      showSuccessToast("Game removed from library");
      clearPendingAction();
      onClose();
    } catch {
      showErrorToast("Failed to remove from library");
    } finally {
      globalThis.window.dispatchEvent(new Event("library-update"));
      setActionLoading(false);
    }
  }, [game, onClose, showSuccessToast, showErrorToast, clearPendingAction]);

  const handleResetAchievements = useCallback(async () => {
    setActionLoading(true);
    try {
      await globalThis.window.electron.resetGameAchievements(
        game.shop,
        game.objectId
      );
      showSuccessToast("Achievements reset");
      clearPendingAction();
    } catch {
      showErrorToast("Failed to reset achievements");
    } finally {
      setActionLoading(false);
    }
  }, [game, showSuccessToast, showErrorToast, clearPendingAction]);

  const handleRemoveFiles = useCallback(async () => {
    const pendingTarget = pendingRemoveFilesTarget;
    if (!pendingTarget) return;

    setActionLoading(true);
    try {
      const liveTarget = getRemoveFilesTarget(
        removeFilesSource,
        steamUninstallAvailable,
        isSteamLibraryExecutable === true
      );
      if (!liveTarget || !isSameRemoveFilesTarget(liveTarget, pendingTarget)) {
        showErrorToast(t("remove_game_files_target_changed"));
        clearPendingAction();
        return;
      }

      if (
        liveTarget.kind === "hydra" &&
        isLibraryGameDownloading(liveTarget.game)
      ) {
        showErrorToast(t("remove_game_files_downloading"));
        clearPendingAction();
        return;
      }

      if (liveTarget.kind === "steam") {
        await globalThis.window.electron.uninstallGameOnSteam?.(
          liveTarget.appId
        );
        showSuccessToast(t("steam_uninstall_requested"));
        clearPendingAction();
        return;
      }

      await globalThis.window.electron.deleteGameFolder(
        liveTarget.game.shop,
        liveTarget.game.objectId,
        { deleteSourceArchive: hasSourceArchive && deleteSourceArchive }
      );
      showSuccessToast("Game files removed");
      clearPendingAction();
      globalThis.window.dispatchEvent(new Event("library-update"));
    } catch {
      showErrorToast(
        pendingTarget.kind === "steam"
          ? t("steam_uninstall_failed")
          : t("remove_game_files_failed")
      );
    } finally {
      setActionLoading(false);
    }
  }, [
    removeFilesSource,
    steamUninstallAvailable,
    isSteamLibraryExecutable,
    pendingRemoveFilesTarget,
    t,
    showSuccessToast,
    showErrorToast,
    clearPendingAction,
    hasSourceArchive,
    deleteSourceArchive,
  ]);

  const canUninstallGame = Boolean(
    game.executablePath ||
      game.switchPortedAppPath ||
      removeFilesSource.executablePath ||
      removeFilesSource.switchPortedAppPath
  );

  useEffect(() => {
    if (!showUninstallModal) return;
    let cancelled = false;
    setLoadingUninstallPreview(true);
    setUninstallDeleteSaves(false);
    setUninstallDeleteStaging(false);

    void globalThis.window.electron
      .getGameUninstallPreview(game.shop, game.objectId)
      .then((res) => {
        if (!cancelled) setUninstallPreview(res);
      })
      .catch(() => {
        if (!cancelled) setUninstallPreview(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingUninstallPreview(false);
      });

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(UNINSTALL_MODAL_CANCEL_ID);
    });

    return () => {
      cancelled = true;
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [game.objectId, game.shop, setFocus, showUninstallModal]);

  const handleConfirmUninstallGame = useCallback(async () => {
    setUninstallingGame(true);
    try {
      const result = await globalThis.window.electron.uninstallGame(
        game.shop,
        game.objectId,
        {
          deleteSaves: uninstallDeleteSaves,
          deleteStaging:
            uninstallPreview?.kind === "switch"
              ? uninstallDeleteStaging
              : false,
        }
      );

      if (!result.ok) {
        showErrorToast(result.error || t("uninstall_game_failed"));
        return;
      }

      if (result.warnings.length > 0) {
        showWarningToast(result.warnings[0]);
      } else {
        showSuccessToast(t("uninstall_game_success", { game: game.title }));
      }
      setShowUninstallModal(false);
      globalThis.window.dispatchEvent(new Event("library-update"));
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : t("uninstall_game_failed")
      );
    } finally {
      setUninstallingGame(false);
    }
  }, [
    game.objectId,
    game.shop,
    game.title,
    showErrorToast,
    showSuccessToast,
    showWarningToast,
    t,
    uninstallDeleteSaves,
    uninstallDeleteStaging,
    uninstallPreview?.kind,
  ]);

  const confirmationConfig = pendingAction
    ? getConfirmationConfig(
        pendingAction,
        game,
        pendingRemoveFilesTarget,
        t,
        handleRemoveFromLibrary,
        handleResetAchievements,
        handleRemoveFiles
      )
    : null;

  return (
    <VerticalFocusGroup className="game-danger-zone-settings-tab">
      <SettingsSection
        className="game-danger-zone-settings-tab__section"
        title={t("remove_from_library")}
        description={t("remove_from_library_description", {
          game: game.title,
        })}
      >
        <Button
          focusId={GAME_DANGER_ZONE_PRIMARY_CONTROL_ID}
          variant="danger"
          className="game-danger-zone-settings-tab__action-button"
          onClick={() => setPendingAction("remove-from-library")}
        >
          {t("remove_from_library")}
        </Button>
      </SettingsSection>

      {game.shop !== "custom" && (
        <SettingsSection
          className="game-danger-zone-settings-tab__section"
          title={t("reset_achievements")}
          description={t(
            game.shop === "steam"
              ? "reset_achievements_steam_description"
              : "reset_achievements_description",
            { game: game.title }
          )}
        >
          <Button
            variant="danger"
            className="game-danger-zone-settings-tab__action-button"
            disabled={!game.achievementCount}
            onClick={() => setPendingAction("reset-achievements")}
          >
            {t("reset_achievements")}
          </Button>
        </SettingsSection>
      )}

      {game.shop !== "custom" && (
        <SettingsSection
          className="game-danger-zone-settings-tab__section"
          title={removeFilesSectionTitle}
          description={removeFilesSectionDescription}
        >
          <Button
            variant="danger"
            className="game-danger-zone-settings-tab__action-button"
            disabled={!removeFilesTarget || isGameDownloading}
            onClick={() => {
              if (!removeFilesTarget || isGameDownloading) return;
              setPendingRemoveFilesTarget(removeFilesTarget);
              setPendingAction("remove-files");
            }}
          >
            {t("remove_game_files")}
          </Button>
        </SettingsSection>
      )}

      <SettingsSection
        className="game-danger-zone-settings-tab__section"
        title={t("uninstall_game")}
        description={t("uninstall_game_description")}
      >
        <Button
          variant="danger"
          className="game-danger-zone-settings-tab__action-button"
          disabled={!canUninstallGame || isGameDownloading}
          onClick={() => setShowUninstallModal(true)}
        >
          {t("uninstall_game")}
        </Button>
      </SettingsSection>

      {showUninstallModal && (
        <Modal
          visible={true}
          onClose={() => {
            if (!uninstallingGame) setShowUninstallModal(false);
          }}
          title={t("uninstall_game_modal_title", { game: game.title })}
          description={
            uninstallPreview?.kind === "switch"
              ? t("uninstall_game_switch_description", { game: game.title })
              : t("uninstall_game_windows_description", { game: game.title })
          }
          initialFocusId={UNINSTALL_MODAL_CANCEL_ID}
          closeOnBackdrop={!uninstallingGame}
          closeOnEscape={!uninstallingGame}
          busy={uninstallingGame}
        >
          <VerticalFocusGroup className="game-uninstall-modal__content">
            {loadingUninstallPreview ? (
              <div className="game-uninstall-modal__summary">
                <span>{t("uninstall_scanning")}</span>
              </div>
            ) : (
              <>
                <div className="game-uninstall-modal__summary">
                  {uninstallPreview?.installPath ? (
                    <>
                      <strong>
                        {uninstallPreview.kind === "switch"
                          ? t("uninstall_app_bundle")
                          : t("uninstall_install_folder")}{" "}
                        ({formatUninstallMb(uninstallPreview.installSizeBytes)})
                      </strong>
                      <span className="game-uninstall-modal__path">
                        {uninstallPreview.installPath}
                      </span>
                    </>
                  ) : (
                    <span>{t("uninstall_no_install_found")}</span>
                  )}
                  {uninstallPreview?.kind !== "switch" &&
                    uninstallPreview?.uninstallerPath && (
                      <span>
                        {t("uninstall_detected_uninstaller")}:{" "}
                        {uninstallPreview.uninstallerPath.split("/").pop()}
                      </span>
                    )}
                </div>

                {uninstallPreview?.kind === "switch" && (
                  <Checkbox
                    block
                    label={t("uninstall_delete_staging_checkbox", {
                      size: formatUninstallMb(
                        uninstallPreview?.stagingSizeBytes ?? 0
                      ),
                    })}
                    checked={uninstallDeleteStaging}
                    disabled={
                      uninstallingGame ||
                      (uninstallPreview?.stagingPaths.length ?? 0) === 0
                    }
                    onChange={setUninstallDeleteStaging}
                  />
                )}

                <Checkbox
                  block
                  label={t("uninstall_delete_saves_checkbox", {
                    size: formatUninstallMb(
                      uninstallPreview?.saveSizeBytes ?? 0
                    ),
                  })}
                  checked={uninstallDeleteSaves}
                  disabled={
                    uninstallingGame ||
                    (uninstallPreview?.savePaths.length ?? 0) === 0
                  }
                  onChange={setUninstallDeleteSaves}
                />
              </>
            )}

            <HorizontalFocusGroup className="game-uninstall-modal__actions">
              <Button
                variant="secondary"
                focusId={UNINSTALL_MODAL_CANCEL_ID}
                disabled={uninstallingGame}
                onClick={() => setShowUninstallModal(false)}
              >
                {t("cancel", { defaultValue: "Cancelar" })}
              </Button>
              <Button
                variant="danger"
                loading={uninstallingGame}
                disabled={
                  loadingUninstallPreview ||
                  uninstallingGame ||
                  !uninstallPreview?.canUninstall
                }
                onClick={() => {
                  void handleConfirmUninstallGame();
                }}
              >
                {uninstallingGame
                  ? t("uninstall_in_progress")
                  : t("uninstall_confirm")}
              </Button>
            </HorizontalFocusGroup>
          </VerticalFocusGroup>
        </Modal>
      )}

      {confirmationConfig && (
        <ConfirmationModal
          visible={true}
          title={confirmationConfig.title}
          description={confirmationConfig.description}
          confirmLabel={confirmationConfig.confirmLabel}
          danger
          loading={actionLoading}
          onClose={clearPendingAction}
          onConfirm={confirmationConfig.onConfirm}
          sourceArchiveOption={
            pendingAction === "remove-files" && hasSourceArchive
              ? {
                  checked: deleteSourceArchive,
                  onChange: setDeleteSourceArchive,
                }
              : null
          }
        />
      )}
    </VerticalFocusGroup>
  );
}
