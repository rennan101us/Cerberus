import {
  AppTitleBar,
  FirstRunOnboardingModal,
  Sidebar,
  Toast,
} from "@renderer/components";
import { AutoUpdateSubHeader } from "@renderer/components/header/auto-update-sub-header";
import { SteamDepotAuthModal } from "@renderer/components/steam-depot-auth-modal/steam-depot-auth-modal";
import { ScanGamesProvider } from "@renderer/context";
import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useGamificationFeatureSync,
  useGamificationProgressSync,
  useDragTextSelection,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useDownloadOptionsListener } from "@renderer/hooks/use-download-options-listener";
import i18n from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearExtraction,
  closeToast,
  showToast,
  failClassicsScan,
  failRetroArchScan,
  finishClassicsScan,
  finishRetroArchScan,
  hydrateClassicsScan,
  hydrateRetroArchScan,
  setExtractionProgress,
  setGameRunning,
  setLibrarySyncingRemote,
  setLibraryAwaitingAccount,
  setProfileBackground,
  setUserDetails,
  setUserPreferences,
  toggleDraggingDisabled,
  updateClassicsScanProgress,
  updateRetroArchScanProgress,
  appendLog,
  setLogs,
  setNxBuildJob,
} from "@renderer/features";
import { applyHighlightTheme } from "./helpers/highlight-theme";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ArchiveDeletionModal } from "./pages/downloads/archive-deletion-error-modal";
import { AddFriendModal } from "./pages/profile/profile-content/add-friend-modal";
import { CloudGiftNotificationModal } from "./pages/shared-modals/cloud-gift-notification-modal";
import { useDesktopGamepadNavigation } from "./hooks/use-desktop-gamepad-navigation";
import { playMessageSound } from "./pages/chat-window/chat-sounds";

import type { UserPreferences } from "@types";
import "./app.scss";
import {
  getAchievementSoundUrl,
  getAchievementSoundVolume,
  injectCustomCss,
  removeCustomCss,
} from "./helpers";
import { levelDBService } from "./services/leveldb.service";

export interface AppProps {
  children: React.ReactNode;
}

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary, library, downloadLibrary } = useLibrary();

  // Listen for new download options updates
  useDownloadOptionsListener();
  useDragTextSelection();
  useDesktopGamepadNavigation();

  const { t } = useTranslation("app");

  const { clearDownload, setLastPacket, lastPacket } = useDownload();

  const {
    hasActiveSubscription,
    fetchUserDetails,
    updateUserDetails,
    clearUserDetails,
  } = useUserDetails();

  useGamificationFeatureSync();
  useGamificationProgressSync();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();
  const location = useLocation();

  const draggingDisabled = useAppSelector(
    (state) => state.window.draggingDisabled
  );
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const toast = useAppSelector((state) => state.toast);

  const [version, setVersion] = useState("");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [forceOpenOnboarding, setForceOpenOnboarding] = useState(false);

  useEffect(() => {
    window.electron.getVersion().then(setVersion);
  }, []);

  const { showSuccessToast, showErrorToast, showWarningToast } = useToast();

  const [showArchiveDeletionModal, setShowArchiveDeletionModal] =
    useState(false);
  const [archivePaths, setArchivePaths] = useState<string[]>([]);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);

  useEffect(() => {
    Promise.all([
      levelDBService.get("userPreferences", null, "json"),
      updateLibrary(),
    ]).then(([preferences]) => {
      const prefs = preferences as UserPreferences | null;
      dispatch(setUserPreferences(prefs));
      applyHighlightTheme(prefs?.highlightTheme, prefs?.customHighlightColor);
      setPreferencesLoaded(true);
    });
  }, [dispatch, updateLibrary]);

  useEffect(() => {
    const openHandler = () => setForceOpenOnboarding(true);
    window.addEventListener("cerberus:open-onboarding", openHandler);
    return () =>
      window.removeEventListener("cerberus:open-onboarding", openHandler);
  }, []);

  useEffect(() => {
    window.electron
      .logsGetAll()
      .then((all) => dispatch(setLogs(all)))
      .catch(() => {});
    window.electron
      .nxGetActiveBuildJob()
      .then((job) => dispatch(setNxBuildJob(job)))
      .catch(() => {});

    const unsubLog = window.electron.onNxLog((entry) => {
      dispatch(appendLog(entry));
    });
    const unsubBuild = window.electron.onNxBuildProgress((ev) => {
      if (ev.phase === "done") {
        dispatch(setNxBuildJob(null));
        showSuccessToast(`Port de "${ev.gameTitle}" concluído com sucesso!`);
        void updateLibrary();
      } else if (ev.phase === "error") {
        dispatch(setNxBuildJob(null));
        showErrorToast(ev.error || `Falha ao portar "${ev.gameTitle}".`);
      } else if (ev.phase === "cancelled") {
        dispatch(setNxBuildJob(null));
        showWarningToast(`Port de "${ev.gameTitle}" cancelado.`);
      } else {
        dispatch(setNxBuildJob(ev));
      }
    });
    const unsubLib = window.electron.onNxLibraryUpdated(() => {
      void updateLibrary();
    });

    return () => {
      unsubLog();
      unsubBuild();
      unsubLib();
    };
  }, [
    dispatch,
    showErrorToast,
    showSuccessToast,
    showWarningToast,
    updateLibrary,
  ]);

  useEffect(() => {
    const unsubscribe = window.electron.onUserPreferencesUpdated(
      (preferences) => {
        if (!preferences) {
          dispatch(setUserPreferences(null));
          return;
        }

        if (preferences.language && preferences.language !== i18n.language) {
          void i18n.changeLanguage(preferences.language);
        }

        applyHighlightTheme(
          preferences.highlightTheme,
          preferences.customHighlightColor
        );

        dispatch(setUserPreferences(preferences));
      }
    );

    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  useEffect(() => {
    const unsubscribe = window.electron.onDownloadProgress(
      (downloadProgress) => {
        if (
          downloadProgress?.progress === 1 &&
          !downloadProgress.isCheckingFiles &&
          !downloadProgress.isDownloadingMetadata
        ) {
          clearDownload();
          updateLibrary();
          return;
        }

        setLastPacket(downloadProgress);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [clearDownload, setLastPacket, updateLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onHardDelete(() => {
      updateLibrary();
    });

    return () => unsubscribe();
  }, [updateLibrary]);

  useEffect(() => {
    const refreshLibrary = () => {
      void updateLibrary();
    };

    window.addEventListener("hydra:game-visibility-updated", refreshLibrary);
    return () =>
      window.removeEventListener(
        "hydra:game-visibility-updated",
        refreshLibrary
      );
  }, [updateLibrary]);

  useEffect(() => {
    if (!lastPacket?.gameId) return;

    const activeGame = downloadLibrary.find(
      (game) => game.id === lastPacket.gameId
    );

    if (!activeGame || activeGame.download?.status !== "active") {
      clearDownload();
    }
  }, [clearDownload, lastPacket?.gameId, downloadLibrary]);

  const setupExternalResources = useCallback(async () => {
    const cachedUserDetails = window.localStorage.getItem("userDetails");

    if (cachedUserDetails) {
      const { profileBackground, ...userDetails } =
        JSON.parse(cachedUserDetails);

      dispatch(setUserDetails(userDetails));
      dispatch(setProfileBackground(profileBackground));
    }
  }, [dispatch]);

  useEffect(() => {
    setupExternalResources();
  }, [setupExternalResources]);

  const onSignIn = useCallback(() => {
    dispatch(setLibraryAwaitingAccount(true));
    fetchUserDetails().then((response) => {
      if (response) {
        updateUserDetails(response);
        showSuccessToast(t("successfully_signed_in"));
      }
    });
  }, [dispatch, fetchUserDetails, t, showSuccessToast, updateUserDetails]);

  useEffect(() => {
    const unsubscribe = window.electron.onGamesRunning((gamesRunning) => {
      if (gamesRunning.length) {
        const runningIds = new Set(gamesRunning.map((game) => game.id));
        const concealedExecutables = new Set(
          downloadLibrary
            .filter(
              (game) =>
                game.isConcealed &&
                game.executablePath &&
                runningIds.has(game.id)
            )
            .map((game) => game.executablePath!.toLowerCase())
        );
        const lastGame = gamesRunning[gamesRunning.length - 1];
        const libraryGame = library.find(
          (library) => library.id === lastGame.id
        );

        if (
          libraryGame &&
          !concealedExecutables.has(
            libraryGame.executablePath?.toLowerCase() ?? ""
          )
        ) {
          dispatch(
            setGameRunning({
              ...libraryGame,
              coverImageUrl: libraryGame.coverImageUrl ?? null,
              sessionDurationInMillis: lastGame.sessionDurationInMillis,
            })
          );
          return;
        }
      }
      dispatch(setGameRunning(null));
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch, library, downloadLibrary]);

  useEffect(() => {
    window.electron.getActiveClassicsImport().then((snapshot) => {
      if (snapshot) dispatch(hydrateClassicsScan(snapshot));
    });

    const unsubscribe = window.electron.onClassicsImportProgress((payload) => {
      if (payload.type === "error") {
        dispatch(failClassicsScan(payload.message));
        return;
      }

      if (payload.type === "progress") {
        dispatch(updateClassicsScanProgress(payload));
        return;
      }

      dispatch(
        finishClassicsScan({
          cancelled: payload.type === "cancelled",
          system: payload.system,
          result: {
            fileCount: payload.fileCount,
            sizeBytes: payload.sizeBytes,
            matched: payload.matched,
            unmatched: payload.unmatched,
            unmatchedFiles: payload.unmatchedFiles,
            unsupportedPackages: payload.unsupportedPackages,
          },
        })
      );
      if (payload.type === "done" && payload.unsupportedPackages > 0) {
        showWarningToast(
          t("ps4_pkg_not_supported", { count: payload.unsupportedPackages })
        );
      }
      updateLibrary();
    });

    return () => unsubscribe();
  }, [dispatch, updateLibrary, showWarningToast, t]);

  useEffect(() => {
    window.electron.getActiveRetroArchImport().then((snapshot) => {
      if (snapshot) dispatch(hydrateRetroArchScan(snapshot));
    });

    const unsubscribe = window.electron.onRetroArchImportProgress((payload) => {
      if (payload.type === "error") {
        dispatch(failRetroArchScan(payload.message));
        return;
      }

      if (payload.type === "progress") {
        dispatch(updateRetroArchScanProgress(payload));
        return;
      }

      dispatch(
        finishRetroArchScan({
          cancelled: payload.type === "cancelled",
          result: {
            fileCount: payload.fileCount,
            sizeBytes: payload.sizeBytes,
            matched: payload.matched,
            unmatched: payload.unmatched,
            unmatchedFiles: payload.unmatchedFiles,
          },
        })
      );
      updateLibrary();
    });

    return () => unsubscribe();
  }, [dispatch, updateLibrary]);

  useEffect(() => {
    let hasReceivedSyncState = false;

    void window.electron.getRemoteLibrarySyncState().then((syncing) => {
      if (!hasReceivedSyncState) dispatch(setLibrarySyncingRemote(syncing));
    });

    return window.electron.onRemoteLibrarySyncStateChange((syncing) => {
      hasReceivedSyncState = true;

      if (syncing) {
        dispatch(setLibrarySyncingRemote(true));
        return;
      }

      void updateLibrary().finally(() => {
        dispatch(setLibrarySyncingRemote(false));
        dispatch(setLibraryAwaitingAccount(false));
      });
    });
  }, [dispatch, updateLibrary]);

  useEffect(() => {
    const listeners = [
      window.electron.onSignIn(onSignIn),
      window.electron.onLibraryBatchComplete(() => {
        updateLibrary();
      }),
      window.electron.onDownloadsUpdated(() => {
        updateLibrary();
      }),
      window.electron.onSignOut(() => clearUserDetails()),
      window.electron.onExtractionProgress((shop, objectId, progress) => {
        dispatch(setExtractionProgress({ shop, objectId, progress }));
      }),
      window.electron.onExtractionComplete(() => {
        dispatch(clearExtraction());
        updateLibrary();
      }),
      window.electron.onExtractionFailed((_shop, _objectId, failure) => {
        dispatch(clearExtraction());
        updateLibrary();

        if (failure?.reason === "unsupported-format") {
          showErrorToast(
            t("extraction_unsupported_format_title", { ns: "downloads" }),
            t("extraction_unsupported_format_description", {
              ns: "downloads",
              format: failure.format,
            })
          );
          return;
        }

        if (failure?.reason === "pkg-keys-unavailable") {
          showErrorToast(
            t("extraction_failed_title", { ns: "downloads" }),
            t("extraction_pkg_keys_unavailable_description", {
              ns: "downloads",
            })
          );
          return;
        }

        if (failure?.reason === "file-not-found") {
          showErrorToast(
            t("extraction_file_not_found_title", { ns: "downloads" }),
            t("extraction_file_not_found_description", { ns: "downloads" })
          );
          return;
        }

        showErrorToast(
          t("extraction_failed_title", { ns: "downloads" }),
          t("extraction_failed_description", { ns: "downloads" })
        );
      }),
      window.electron.onGameExecutableNotFound(() => {
        showErrorToast(
          t("executable_not_found_title", { ns: "game_details" }),
          t("executable_not_found_description", { ns: "game_details" })
        );
      }),
      window.electron.onDownloadHalted((gameTitle) => {
        updateLibrary();
        showErrorToast(
          t("download_halted_title", { ns: "downloads" }),
          t("download_halted_description", {
            ns: "downloads",
            title: gameTitle,
          })
        );
      }),
      window.electron.onArchiveDeletionPrompt((paths) => {
        setArchivePaths(paths);
        setShowArchiveDeletionModal(true);
      }),
      window.electron.onGameInstallerClosed(
        (_shop, _objectId, executableFound) => {
          updateLibrary();

          if (executableFound) {
            showSuccessToast(
              t("game_installed_title", { ns: "downloads" }),
              t("game_installed_description", { ns: "downloads" })
            );
            return;
          }

          showWarningToast(
            t("installed_game_not_found_title", { ns: "downloads" }),
            t("installed_game_not_found_description", { ns: "downloads" })
          );
        }
      ),
      window.electron.onCommonRedistProgress(({ complete }) => {
        if (!complete) return;

        showSuccessToast(
          t("installation_complete", { ns: "bottom_panel" }),
          t("installation_complete_message", { ns: "bottom_panel" })
        );
      }),
    ];

    return () => {
      listeners.forEach((unsubscribe) => unsubscribe());
    };
  }, [
    onSignIn,
    updateLibrary,
    clearUserDetails,
    dispatch,
    showErrorToast,
    showSuccessToast,
    showWarningToast,
    t,
  ]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [location.pathname, location.search]);

  useEffect(() => {
    new MutationObserver(() => {
      const modal = document.body.querySelector("[data-hydra-dialog]");

      dispatch(toggleDraggingDisabled(Boolean(modal)));
    }).observe(document.body, {
      attributes: false,
      childList: true,
    });
  }, [dispatch, draggingDisabled]);

  const loadAndApplyTheme = useCallback(async () => {
    const allThemes = (await levelDBService.values("themes")) as {
      isActive?: boolean;
      code?: string;
    }[];
    const activeTheme = allThemes.find((theme) => theme.isActive);
    if (activeTheme?.code) {
      injectCustomCss(activeTheme.code);
    } else {
      removeCustomCss();
    }
  }, []);

  useEffect(() => {
    loadAndApplyTheme();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      loadAndApplyTheme();
    });

    return () => unsubscribe();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onNavigate((path) => {
      navigate(path);
    });

    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onOpenAddFriendModal(() => {
      setShowAddFriendModal(true);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onShowToast((toast) => {
      dispatch(showToast(toast));
    });

    return () => unsubscribe();
  }, [dispatch]);

  const playAudio = useCallback(async () => {
    const soundUrl = await getAchievementSoundUrl();
    const volume = await getAchievementSoundVolume();
    const audio = new Audio(soundUrl);
    audio.volume = volume;
    audio.play();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onAchievementUnlocked(
      (suppressSound) => {
        if (!suppressSound) playAudio();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [playAudio]);

  // Sent here when the chat window is closed or still loading.
  useEffect(() => {
    return window.electron.onChatMessageSound(() => {
      void playMessageSound();
    });
  }, []);

  useEffect(() => {
    return window.electron.onSocialGameInvite(({ friend, invite }) => {
      dispatch(
        showToast({
          title: `Convite de ${friend.displayName}`,
          message: `Chamou você para jogar ${invite.gameTitle}. Abra o chat para entrar.`,
          type: "success",
        })
      );
    });
  }, [dispatch]);

  const handleToastClose = useCallback(() => {
    dispatch(closeToast());
  }, [dispatch]);

  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  useEffect(() => {
    if (
      window.electron.platform !== "linux" ||
      window.electron.hasNativeWindowDecorations
    ) {
      return;
    }

    if (window.electron.isWayland) {
      document.body.classList.add("window-rounded");
    }

    let cancelled = false;

    const applyMaximizeState = (isMaximized: boolean) => {
      if (cancelled) return;
      setIsWindowMaximized(isMaximized);
      document.body.classList.toggle("window-maximized", isMaximized);
    };

    window.electron.isMainWindowMaximized().then(applyMaximizeState);
    const unsubscribe =
      window.electron.onWindowMaximizeChange(applyMaximizeState);

    return () => {
      cancelled = true;
      unsubscribe();
      document.body.classList.remove("window-rounded");
      document.body.classList.remove("window-maximized");
    };
  }, []);

  return (
    <>
      <AppTitleBar
        hasActiveSubscription={hasActiveSubscription}
        version={version}
        isWindowMaximized={isWindowMaximized}
      />

      <Toast
        visible={toast.visible}
        title={toast.title}
        message={toast.message}
        type={toast.type}
        onClose={handleToastClose}
        duration={toast.duration}
      />

      <CloudGiftNotificationModal />

      <ArchiveDeletionModal
        visible={showArchiveDeletionModal}
        archivePaths={archivePaths}
        onClose={() => setShowArchiveDeletionModal(false)}
      />

      <AddFriendModal
        visible={showAddFriendModal}
        onClose={() => setShowAddFriendModal(false)}
      />

      <SteamDepotAuthModal />

      <FirstRunOnboardingModal
        visible={
          forceOpenOnboarding ||
          (preferencesLoaded &&
            !userPreferences?.hasCompletedFirstRunOnboarding)
        }
        onClose={() => setForceOpenOnboarding(false)}
      />

      <ScanGamesProvider>
        <main>
          <Sidebar />

          <article className="container">
            <AutoUpdateSubHeader />

            <section
              ref={contentRef}
              id="scrollableDiv"
              className="container__content"
            >
              <Outlet />
            </section>
          </article>
        </main>
      </ScanGamesProvider>
    </>
  );
}
