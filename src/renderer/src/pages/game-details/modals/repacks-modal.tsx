import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  PlusCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";

import {
  Badge,
  Button,
  Modal,
  TextField,
  CheckboxField,
  SteamIcon,
} from "@renderer/components";
import type {
  DownloadSource,
  Game,
  GameRepack,
  MacNativeDownloadOption,
  NxCloudAvailableGame,
  StoreLibraryGame,
} from "@types";
import { Download as LucideDownload, ExternalLink } from "lucide-react";
import { useToast } from "@renderer/hooks";

import { DownloadSettingsModal } from "./download-settings-modal";
import { gameDetailsContext } from "@renderer/context";
import {
  Downloader,
  getOfficialStoreMembers,
  isEpicMemberInCurrentScope,
} from "@shared";
import { orderBy } from "lodash-es";
import {
  useDate,
  useAppDispatch,
  useAppSelector,
  useIsNonSteamExecutable,
} from "@renderer/hooks";
import { clearNewDownloadOptions } from "@renderer/features";
import { levelDBService } from "@renderer/services/leveldb.service";
import { getRepackAvailabilityStatus } from "./repack-availability";
import {
  canDownloadOnSteam,
  getGameKey,
  isSteamImportedGame,
} from "@renderer/helpers";
import "./repacks-modal.scss";
import EpicLogo from "@renderer/assets/epic-integration-logo.svg?react";
import GogLogo from "@renderer/assets/gog-integration-logo.svg?react";
import { EpicInstallModal } from "./epic-install-modal";
import { useEpicManagedConnection } from "@renderer/hooks/use-epic-managed";
import { useLibrary } from "@renderer/hooks";
import type { LibraryGame } from "@types";
import { epicInstallTiming } from "@renderer/helpers/epic-install-timing";

export interface RepacksModalProps {
  visible: boolean;
  startDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string,
    automaticallyExtract: boolean,
    addToQueueOnly?: boolean,
    fileIndices?: number[],
    selectedFilesSize?: number | null,
    automaticallyDeleteArchiveFiles?: boolean,
    signal?: AbortSignal
  ) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

export function RepacksModal({
  visible,
  startDownload,
  onClose,
}: Readonly<RepacksModalProps>) {
  const [filteredRepacks, setFilteredRepacks] = useState<GameRepack[]>([]);
  const [repack, setRepack] = useState<GameRepack | null>(null);
  const [showSelectFolderModal, setShowSelectFolderModal] = useState(false);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [selectedFingerprints, setSelectedFingerprints] = useState<string[]>(
    []
  );
  const [filterTerm, setFilterTerm] = useState("");

  const [lastCheckTimestamp, setLastCheckTimestamp] = useState<string | null>(
    null
  );
  const [isLoadingTimestamp, setIsLoadingTimestamp] = useState(true);
  const [viewedRepackIds, setViewedRepackIds] = useState<Set<string>>(
    new Set()
  );

  const { game, presentation, repacks, shop, objectId, gameTitle, updateGame } =
    useContext(gameDetailsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const isSwitchShop = shop === "switch1" || shop === "switch2";
  const isMacNativeShop = shop === "mac_native";

  const [switchStreams, setSwitchStreams] = useState<NxCloudAvailableGame[]>(
    []
  );
  const [loadingSwitchStreams, setLoadingSwitchStreams] = useState(false);
  const [switchDirectLink, setSwitchDirectLink] = useState("");
  const [startingSwitchKey, setStartingSwitchKey] = useState<string | null>(
    null
  );

  const [macOptions, setMacOptions] = useState<MacNativeDownloadOption[]>([]);
  const [loadingMacOptions, setLoadingMacOptions] = useState(false);
  const [startingMacId, setStartingMacId] = useState<string | null>(null);
  const [storeAccounts, setStoreAccounts] = useState<{
    steam: boolean;
    epic: boolean;
    gog: boolean;
  }>({ steam: false, epic: false, gog: false });
  const [startingStoreProvider, setStartingStoreProvider] = useState<
    "steam" | "epic" | "gog" | null
  >(null);
  const [ownedStoreGames, setOwnedStoreGames] = useState<StoreLibraryGame[]>(
    []
  );

  useEffect(() => {
    if (!visible) return;
    window.electron?.storesGetAccounts?.()
      ?.then((res) => {
        if (!res) return;
        setStoreAccounts({
          steam: Boolean(res.steam?.connected),
          epic: Boolean(res.epic?.connected),
          gog: Boolean(res.gog?.connected),
        });
      })
      ?.catch(() => {});

    window.electron?.storesGetOwnedGames?.()
      ?.then((games) => setOwnedStoreGames(games || []))
      ?.catch(() => {});
  }, [visible]);

  useEffect(() => {
    if (!visible || !isSwitchShop || !objectId) return;
    let cancelled = false;
    setLoadingSwitchStreams(true);
    setSwitchDirectLink("");
    const tid = game?.switchTitleId || objectId;
    const gen = shop === "switch2" ? "switch2" : "switch1";

    void (async () => {
      try {
        const cached = await window.electron.nxResolveGameStreams(tid);
        if (!cancelled && cached.length > 0) {
          setSwitchStreams(cached);
          setLoadingSwitchStreams(false);
        }
        const live = await window.electron.nxResolveLiveGameStreams(
          tid,
          gameTitle || game?.title || tid,
          gen
        );
        if (!cancelled) {
          setSwitchStreams(live.length > 0 ? live : cached);
        }
      } catch {
        if (!cancelled) setSwitchStreams([]);
      } finally {
        if (!cancelled) setLoadingSwitchStreams(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    visible,
    isSwitchShop,
    objectId,
    shop,
    game?.switchTitleId,
    game?.title,
    gameTitle,
  ]);

  useEffect(() => {
    if (!visible || !isMacNativeShop || !objectId) return;
    let cancelled = false;
    setLoadingMacOptions(true);

    void window.electron
      .macNativeGetDownloadOptions(objectId, gameTitle || game?.title)
      .then((res) => {
        if (!cancelled) setMacOptions(res.options ?? []);
      })
      .catch(() => {
        if (!cancelled) setMacOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMacOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, isMacNativeShop, objectId, gameTitle, game?.title]);

  const handleStartSwitchDownload = async (opts: {
    streamUrl?: string;
    directUri?: string;
  }) => {
    if (!objectId) return;
    const key = opts.directUri || opts.streamUrl || "direct";
    setStartingSwitchKey(key);
    try {
      const tid = game?.switchTitleId || objectId;
      const gen = shop === "switch2" ? "switch2" : "switch1";
      const title = gameTitle || game?.title || tid;
      const res = await window.electron.nxStartSwitchGameDownload({
        titleId: tid,
        title,
        generation: gen,
        streamUrl: opts.streamUrl,
        directUri: opts.directUri,
      });

      if (res.ok) {
        showSuccessToast(
          `Download de "${title}" iniciado! Acompanhe na aba Downloads.`
        );
        await Promise.all([updateLibrary(), updateGame()]);
        onClose();
      } else if (res.fallbackBrowser) {
        await window.electron.nxOpenExternalUrl(
          res.url || opts.streamUrl || ""
        );
        showErrorToast(
          "Este portal exige verificação no navegador. A página foi aberta externamente."
        );
      } else {
        showErrorToast(
          res.error || "Não foi possível iniciar o download deste link."
        );
      }
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Erro ao iniciar download Switch."
      );
    } finally {
      setStartingSwitchKey(null);
    }
  };

  const handleStartMacNativeDownload = async (
    option: MacNativeDownloadOption
  ) => {
    if (!objectId) return;
    setStartingMacId(option.id);
    try {
      const title = gameTitle || game?.title || objectId;
      const res = await window.electron.macNativeStartDownload({
        objectId,
        title,
        option,
      });

      if (res.ok) {
        showSuccessToast(
          `Download de "${title}" iniciado! Acompanhe na aba Downloads.`
        );
        await Promise.all([updateLibrary(), updateGame()]);
        onClose();
      } else if (res.fallbackBrowser && res.url) {
        await window.electron.nxOpenExternalUrl(res.url);
        showErrorToast(
          res.error ||
            `${option.hoster} requer abertura no navegador. A página foi aberta externamente.`
        );
      } else {
        showErrorToast(
          res.error || "Não foi possível iniciar o download Mac Native."
        );
      }
    } catch (err) {
      showErrorToast(
        err instanceof Error
          ? err.message
          : "Erro ao iniciar download Mac Native."
      );
    } finally {
      setStartingMacId(null);
    }
  };
  const { steam: steamGame, epic: epicGame } = getOfficialStoreMembers(
    presentation?.members ?? (game ? [game] : [])
  );
  const { installationAvailable: epicAvailable, connection } =
    useEpicManagedConnection();
  const { updateLibrary } = useLibrary();
  const [epicInstallGame, setEpicInstallGame] = useState<LibraryGame | null>(
    null
  );
  const activeEpicInstallGame =
    epicInstallGame?.epicImportScope &&
    epicGame &&
    epicInstallGame.objectId === epicGame.objectId &&
    epicInstallGame.epicImportScope.environment ===
      epicGame.epicImportScope?.environment &&
    epicInstallGame.epicImportScope.userId ===
      epicGame.epicImportScope?.userId &&
    epicInstallGame.epicImportScope.connectionId ===
      epicGame.epicImportScope?.connectionId
      ? epicInstallGame
      : null;
  useEffect(() => {
    if (epicInstallGame && !activeEpicInstallGame) setEpicInstallGame(null);
  }, [epicInstallGame, activeEpicInstallGame]);

  const { t } = useTranslation("game_details");

  const { formatDate } = useDate();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  useEffect(() => {
    const fetchDownloadSources = async () => {
      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const sorted = orderBy(sources, "createdAt", "desc");
      setDownloadSources(sorted);
    };

    fetchDownloadSources();
  }, []);

  useEffect(() => {
    const fetchLastCheckTimestamp = async () => {
      setIsLoadingTimestamp(true);

      try {
        const timestamp = (await levelDBService.get(
          "downloadSourcesSinceValue",
          null,
          "utf8"
        )) as string | null;

        setLastCheckTimestamp(timestamp);
      } catch {
        setLastCheckTimestamp(null);
      } finally {
        setIsLoadingTimestamp(false);
      }
    };

    if (visible && userPreferences?.enableNewDownloadOptionsBadges !== false) {
      fetchLastCheckTimestamp();
    } else {
      setIsLoadingTimestamp(false);
    }
  }, [visible, repacks, userPreferences?.enableNewDownloadOptionsBadges]);

  useEffect(() => {
    if (
      visible &&
      game?.newDownloadOptionsCount &&
      game.newDownloadOptionsCount > 0
    ) {
      const gameKey = getGameKey(game.shop, game.objectId);
      levelDBService
        .get(gameKey, "games")
        .then((gameData) => {
          if (gameData) {
            const updated = {
              ...(gameData as Game),
              newDownloadOptionsCount: undefined,
            };
            return levelDBService.put(gameKey, updated, "games");
          }
          return Promise.resolve();
        })
        .catch(() => {});

      const gameId = `${game.shop}:${game.objectId}`;
      dispatch(clearNewDownloadOptions({ gameId }));
    }
  }, [visible, game, dispatch]);

  const isDirectHttpsRepack = (repack: GameRepack) =>
    Array.isArray(repack.uris) &&
    repack.uris.some(
      (uri) =>
        (uri.startsWith("https://") || uri.startsWith("http://")) &&
        !uri.toLowerCase().endsWith(".torrent")
    );

  const sortedRepacks = useMemo(() => {
    return orderBy(
      repacks,
      [
        (repack) => (isDirectHttpsRepack(repack) ? 1 : 0),
        (repack) => repack.uploadDate,
      ],
      ["desc", "desc"]
    );
  }, [repacks]);

  useEffect(() => {
    const term = filterTerm.trim().toLowerCase();

    const byTerm = sortedRepacks.filter((repack) => {
      if (!term) return true;
      const lowerTitle = repack.title.toLowerCase();
      const lowerRepacker = repack.downloadSourceName.toLowerCase();
      return lowerTitle.includes(term) || lowerRepacker.includes(term);
    });

    const bySource = byTerm.filter((repack) => {
      if (selectedFingerprints.length === 0) return true;

      return downloadSources.some(
        (src) =>
          src.fingerprint &&
          selectedFingerprints.includes(src.fingerprint) &&
          src.name === repack.downloadSourceName
      );
    });

    setFilteredRepacks(bySource);
  }, [sortedRepacks, filterTerm, selectedFingerprints, downloadSources]);

  const handleRepackClick = (repack: GameRepack) => {
    setRepack(repack);
    setShowSelectFolderModal(true);
    setViewedRepackIds((prev) => new Set(prev).add(repack.id));
  };

  const handleFilter: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setFilterTerm(event.target.value);
  };

  const toggleFingerprint = (fingerprint: string) => {
    setSelectedFingerprints((prev) =>
      prev.includes(fingerprint)
        ? prev.filter((f) => f !== fingerprint)
        : [...prev, fingerprint]
    );
  };

  const checkIfLastDownloadedOption = (repack: GameRepack) => {
    if (!game?.download) return false;
    if (!Array.isArray(repack.uris)) return false;
    return repack.uris.some((uri) => uri.includes(game.download!.uri));
  };

  const isNewRepack = (repack: GameRepack): boolean => {
    if (isLoadingTimestamp) return false;

    if (viewedRepackIds.has(repack.id)) return false;

    if (!lastCheckTimestamp || !repack.createdAt) {
      return false;
    }

    try {
      const lastCheckDate = new Date(lastCheckTimestamp);

      if (isNaN(lastCheckDate.getTime())) {
        return false;
      }

      const lastCheckUtc = lastCheckDate.toISOString();

      return repack.createdAt > lastCheckUtc;
    } catch {
      return false;
    }
  };

  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const steamOptionTerm = filterTerm.trim().toLowerCase();
  const isNonSteamExecutable = useIsNonSteamExecutable(steamGame);

  const currentNormalizedTitle = useMemo(() => {
    const raw = gameTitle || game?.title || "";
    return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  }, [gameTitle, game?.title]);

  const matchedOwnedSteam = useMemo(() => {
    return ownedStoreGames.find(
      (g) =>
        g.provider === "steam" &&
        (g.storeId === objectId ||
          (currentNormalizedTitle &&
            g.title.toLowerCase().replace(/[^a-z0-9]/g, "") ===
              currentNormalizedTitle))
    );
  }, [ownedStoreGames, objectId, currentNormalizedTitle]);

  const matchedOwnedEpic = useMemo(() => {
    return ownedStoreGames.find(
      (g) =>
        g.provider === "epic" &&
        (g.storeId === objectId ||
          (currentNormalizedTitle &&
            g.title.toLowerCase().replace(/[^a-z0-9]/g, "") ===
              currentNormalizedTitle))
    );
  }, [ownedStoreGames, objectId, currentNormalizedTitle]);

  const matchedOwnedGog = useMemo(() => {
    return ownedStoreGames.find(
      (g) =>
        g.provider === "gog" &&
        (g.storeId === objectId ||
          (currentNormalizedTitle &&
            g.title.toLowerCase().replace(/[^a-z0-9]/g, "") ===
              currentNormalizedTitle))
    );
  }, [ownedStoreGames, objectId, currentNormalizedTitle]);

  const effectiveSteamId =
    steamGame?.objectId ||
    (game?.shop === "steam" ? game.objectId : null) ||
    (shop === "steam" ? objectId : null) ||
    presentation?.members?.find((m) => m.shop === "steam")?.objectId ||
    matchedOwnedSteam?.storeId ||
    null;

  const effectiveEpicId =
    epicGame?.objectId ||
    (game?.shop === "epic" ? game.objectId : null) ||
    (shop === "epic" ? objectId : null) ||
    presentation?.members?.find((m) => m.shop === "epic")?.objectId ||
    matchedOwnedEpic?.storeId ||
    null;

  const effectiveGogId =
    (game?.shop === "gog" ? game.objectId : null) ||
    (shop === "gog" ? objectId : null) ||
    (game?.source === "gog" ? game.objectId : null) ||
    presentation?.members?.find(
      (m) => m.shop === "gog" || (m as { source?: string }).source === "gog"
    )?.objectId ||
    matchedOwnedGog?.storeId ||
    null;

  const hasOwnedSteam =
    (storeAccounts.steam &&
      Boolean(
        steamGame?.hasActiveSteamImport ||
          game?.hasActiveSteamImport ||
          game?.shop === "steam" ||
          shop === "steam" ||
          presentation?.members?.some((m) => m.shop === "steam") ||
          game?.source === "steam" ||
          matchedOwnedSteam
      )) ||
    Boolean(canDownloadOnSteam(steamGame)) ||
    Boolean(isSteamImportedGame(steamGame) && isNonSteamExecutable);

  const hasOwnedEpic =
    (storeAccounts.epic &&
      Boolean(
        epicGame?.hasActiveEpicImport ||
          game?.hasActiveEpicImport ||
          game?.shop === "epic" ||
          shop === "epic" ||
          presentation?.members?.some((m) => m.shop === "epic") ||
          game?.source === "epic" ||
          matchedOwnedEpic
      )) ||
    Boolean(epicAvailable && isEpicMemberInCurrentScope(epicGame, connection));

  const hasOwnedGog =
    storeAccounts.gog &&
    Boolean(
      game?.shop === "gog" ||
        shop === "gog" ||
        game?.source === "gog" ||
        presentation?.members?.some(
          (m) => m.shop === "gog" || (m as { source?: string }).source === "gog"
        ) ||
        matchedOwnedGog
    );

  const showSteamOption =
    Boolean(effectiveSteamId) &&
    selectedFingerprints.length === 0 &&
    (!steamOptionTerm ||
      "steam".includes(steamOptionTerm) ||
      (game?.title ?? "").toLowerCase().includes(steamOptionTerm));

  const showEpicOption =
    Boolean(effectiveEpicId) &&
    selectedFingerprints.length === 0 &&
    (!steamOptionTerm ||
      "epic games".includes(steamOptionTerm) ||
      "epic".includes(steamOptionTerm) ||
      (game?.title ?? "").toLowerCase().includes(steamOptionTerm));

  const showGogOption =
    Boolean(effectiveGogId) &&
    selectedFingerprints.length === 0 &&
    (!steamOptionTerm ||
      "gog".includes(steamOptionTerm) ||
      (game?.title ?? "").toLowerCase().includes(steamOptionTerm));

  const handleGogOptionClick = async () => {
    const gogId = effectiveGogId;
    if (!gogId) return;

    if (!storeAccounts.gog) {
      showErrorToast(
        "Conecte sua conta GOG em Ajustes → Lojas para baixar instaladores oficiais."
      );
      navigate("/settings?tab=gog");
      onClose();
      return;
    }

    setStartingStoreProvider("gog");
    try {
      const downloads = await window.electron.storesGetGogDownloads(gogId);
      if (!downloads) {
        showErrorToast("Nenhum instalador GOG encontrado para este jogo.");
        return;
      }
      const isMac = window.electron.platform === "darwin";
      const installers =
        isMac && downloads.macInstallers.length > 0
          ? downloads.macInstallers
          : downloads.windowsInstallers;

      if (!installers || installers.length === 0) {
        showErrorToast("Nenhum arquivo instalador disponível no GOG.");
        return;
      }

      const chosen = installers[0];
      const firstFile = chosen.files?.[0];
      if (!firstFile?.downlink) {
        showErrorToast("Link de download direto do GOG não disponível.");
        return;
      }

      const directUrl = await window.electron.storesResolveGogDownlink(
        firstFile.downlink
      );
      if (!directUrl) {
        showErrorToast("Não foi possível resolver o link direto da CDN GOG.");
        return;
      }

      showSuccessToast(
        `Instalador GOG (${chosen.os === "mac" ? "Mac Native" : "Windows - Red Wine"}) pronto para download!`
      );
      onClose();
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Erro ao obter download GOG."
      );
    } finally {
      setStartingStoreProvider(null);
    }
  };

  const handleSteamOptionClick = async () => {
    const steamId = effectiveSteamId;
    if (!steamId) return;

    if (hasOwnedSteam) {
      setStartingStoreProvider("steam");
      try {
        const res = await window.electron.storesStartGameDownload({
          provider: "steam",
          storeId: steamId,
          title: gameTitle || game?.title || steamId,
        });
        if (res.ok) {
          showSuccessToast(
            "Download oficial Steam iniciado! Acompanhe na aba Downloads."
          );
          void Promise.all([updateLibrary(), updateGame()]);
          onClose();
        } else {
          showErrorToast(res.error || "Erro ao baixar pela Steam.");
        }
      } finally {
        setStartingStoreProvider(null);
      }
      return;
    }

    void window.electron.installGameOnSteam(steamId);
    onClose();
  };

  const handleEpicOptionClick = async () => {
    const epicId = effectiveEpicId;
    if (!epicId) return;

    if (storeAccounts.epic && hasOwnedEpic) {
      setStartingStoreProvider("epic");
      try {
        const res = await window.electron?.storesStartGameDownload?.({
          provider: "epic",
          storeId: epicId,
          title: gameTitle || game?.title || epicId,
        });
        if (res?.ok) {
          showSuccessToast(
            "Download oficial Epic Games iniciado! Acompanhe na aba Downloads."
          );
          void Promise.all([updateLibrary(), updateGame()]);
          onClose();
        } else {
          showErrorToast(res?.error || "Erro ao baixar pela Epic Games.");
        }
      } finally {
        setStartingStoreProvider(null);
      }
      return;
    }

    if (epicGame) {
      epicInstallTiming.beginOptions(epicGame.objectId);
      setEpicInstallGame(epicGame);
      return;
    }

    showErrorToast(
      "Conecte sua conta Epic Games em Ajustes → Lojas para baixar instaladores oficiais via Legendary."
    );
    navigate("/settings?tab=epic");
    onClose();
  };

  useEffect(() => {
    if (!visible) {
      setFilterTerm("");
      setSelectedFingerprints([]);
      setIsFilterDrawerOpen(false);
    }
  }, [visible]);

  if (isSwitchShop) {
    return (
      <Modal
        visible={visible}
        title={t("download_options_title")}
        description={`Opções de download para ${gameTitle || game?.title || objectId}`}
        onClose={onClose}
      >
        <div className="switch-catalogue__streams-modal">
          <div className="switch-catalogue__direct-link-box">
            <TextField
              placeholder="Colar link direto (.nsp/.nsz/.xci/.nup/.zip) ou magnet:..."
              value={switchDirectLink}
              onChange={(e) => setSwitchDirectLink(e.target.value)}
            />
            <Button
              theme="primary"
              disabled={!switchDirectLink.trim() || startingSwitchKey !== null}
              onClick={() =>
                void handleStartSwitchDownload({
                  directUri: switchDirectLink.trim(),
                })
              }
            >
              <LucideDownload size={14} /> Baixar Link
            </Button>
          </div>

          {loadingSwitchStreams ? (
            <p>Buscando fontes cadastradas e portais ao vivo...</p>
          ) : switchStreams.length === 0 ? (
            <div className="switch-catalogue__streams-empty">
              <p>
                Nenhum link automático encontrado nas suas fontes Switch para
                este título.
              </p>
              <small>
                Verifique as fontes (BlueRoms, RomsHQ, NSWPedia) em Ajustes →
                Fontes de Download ou cole um link direto / magnet acima.
              </small>
              <div className="switch-catalogue__streams-actions">
                <Button
                  theme="outline"
                  onClick={() => {
                    onClose();
                    navigate("/settings?tab=download_sources");
                  }}
                >
                  Ir para Fontes de Download
                </Button>
              </div>
            </div>
          ) : (
            <div className="switch-catalogue__streams-list">
              {switchStreams.map((s) => {
                const isStarting = startingSwitchKey === s.downloadURL;
                return (
                  <div
                    key={`${s.sourceId}-${s.downloadURL}`}
                    className="switch-catalogue__stream-row"
                  >
                    <div>
                      <strong>{s.sourceName}</strong>
                      <small>
                        {s.isTorrent
                          ? "Torrent / Magnet (P2P)"
                          : "HTTPS Direto · Recomendado em Redes Restritas"}
                        {s.fileSizeFormatted ? ` · ${s.fileSizeFormatted}` : ""}
                      </small>
                    </div>
                    <div className="switch-catalogue__stream-row-actions">
                      <Button
                        theme="primary"
                        onClick={() =>
                          void handleStartSwitchDownload({
                            streamUrl: s.downloadURL,
                          })
                        }
                        disabled={startingSwitchKey !== null}
                      >
                        <LucideDownload size={13} />{" "}
                        {isStarting ? "Resolvendo..." : "Baixar"}
                      </Button>
                      <Button
                        theme="outline"
                        onClick={() =>
                          void window.electron.nxOpenExternalUrl(s.downloadURL)
                        }
                        title="Abrir no navegador"
                      >
                        <ExternalLink size={13} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
    );
  }

  if (isMacNativeShop) {
    return (
      <Modal
        visible={visible}
        title={t("download_options_title")}
        description={`Opções de download Mac Native para ${gameTitle || game?.title || objectId}`}
        onClose={onClose}
      >
        <div className="switch-catalogue__streams-modal">
          {loadingMacOptions ? (
            <p>Buscando links em Appstorrent e TorrentMac...</p>
          ) : macOptions.length === 0 ? (
            <div className="switch-catalogue__streams-empty">
              <p>
                Nenhum link de download encontrado no momento para este jogo Mac
                Native.
              </p>
              <small>
                Tente atualizar o catálogo Mac Native ou tente novamente em
                alguns instantes.
              </small>
            </div>
          ) : (
            <div className="switch-catalogue__streams-list">
              {macOptions.map((opt) => {
                const isStarting = startingMacId === opt.id;
                return (
                  <div key={opt.id} className="switch-catalogue__stream-row">
                    <div>
                      <strong>{opt.title}</strong>
                      <small>
                        {opt.sourceLabel} · {opt.hoster} ·{" "}
                        {opt.isTorrent
                          ? "Torrent / Magnet (P2P)"
                          : "HTTPS Direto · Recomendado em Redes Restritas"}
                        {opt.fileSize ? ` · ${opt.fileSize}` : ""}
                      </small>
                    </div>
                    <div className="switch-catalogue__stream-row-actions">
                      <Button
                        theme="primary"
                        onClick={() => void handleStartMacNativeDownload(opt)}
                        disabled={startingMacId !== null}
                      >
                        <LucideDownload size={13} />{" "}
                        {isStarting ? "Iniciando..." : "Baixar"}
                      </Button>
                      <Button
                        theme="outline"
                        onClick={() =>
                          void window.electron.nxOpenExternalUrl(opt.detailUrl)
                        }
                        title="Abrir página da fonte"
                      >
                        <ExternalLink size={13} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <>
      <DownloadSettingsModal
        visible={showSelectFolderModal}
        onClose={() => setShowSelectFolderModal(false)}
        startDownload={startDownload}
        repack={repack}
      />
      <EpicInstallModal
        game={activeEpicInstallGame}
        presentationGame={activeEpicInstallGame ? (presentation ?? game) : null}
        onClose={() => setEpicInstallGame(null)}
        onStarted={() => {
          setEpicInstallGame(null);
          void Promise.all([updateLibrary(), updateGame()]);
          onClose();
        }}
      />

      <Modal
        visible={visible}
        title={t("download_options_title")}
        description={t("repacks_modal_description")}
        onClose={onClose}
      >
        <div
          className={`repacks-modal__filter-container ${isFilterDrawerOpen ? "repacks-modal__filter-container--drawer-open" : ""}`}
        >
          <div className="repacks-modal__filter-top">
            <TextField
              placeholder={t("filter")}
              value={filterTerm}
              onChange={handleFilter}
            />
            {downloadSources.length > 0 && (
              <Button
                type="button"
                theme="outline"
                onClick={() => setIsFilterDrawerOpen(!isFilterDrawerOpen)}
                className="repacks-modal__filter-toggle"
              >
                {t("filter_by_source")}
                {isFilterDrawerOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
              </Button>
            )}
          </div>

          <div
            className={`repacks-modal__download-sources ${isFilterDrawerOpen ? "repacks-modal__download-sources--open" : ""}`}
          >
            <div className="repacks-modal__source-grid">
              {downloadSources
                .filter(
                  (
                    source
                  ): source is DownloadSource & { fingerprint: string } =>
                    source.fingerprint !== undefined
                )
                .map((source) => {
                  const label = source.name || source.url;
                  const truncatedLabel =
                    label.length > 16 ? label.substring(0, 16) + "..." : label;
                  return (
                    <div
                      key={source.fingerprint}
                      className="repacks-modal__source-item"
                    >
                      <CheckboxField
                        label={truncatedLabel}
                        checked={selectedFingerprints.includes(
                          source.fingerprint
                        )}
                        onChange={() => toggleFingerprint(source.fingerprint)}
                      />
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        <div className="repacks-modal__repacks">
          {(showSteamOption || showEpicOption || showGogOption) && (
            <div className="repacks-modal__section-header">
              <span>Lojas Oficiais</span>
            </div>
          )}

          {showSteamOption && (
            <Button
              theme="dark"
              disabled={startingStoreProvider !== null}
              onClick={() => void handleSteamOptionClick()}
              className="repacks-modal__repack-button repacks-modal__repack-button--official"
            >
              <span
                className="repacks-modal__availability-orb repacks-modal__availability-orb--online"
                data-tooltip-id="availability-orb-steam"
                data-tooltip-content={t("source_online")}
              />
              <Tooltip id="availability-orb-steam" />

              <p className="repacks-modal__repack-title repacks-modal__steam-title">
                <SteamIcon size={16} />
                <span>{game?.title ?? steamGame?.title ?? "Steam"}</span>
                <span className="repacks-modal__store-badge">
                  Loja Oficial · Steam
                </span>
              </p>

              <p className="repacks-modal__repack-info">
                {startingStoreProvider === "steam"
                  ? "Iniciando download Steam..."
                  : hasOwnedSteam
                    ? "Steam Oficial · Baixar versão Windows (DepotDownloader)"
                    : t("download_on_steam")}
              </p>
            </Button>
          )}

          {showEpicOption && (
            <Button
              theme="dark"
              disabled={startingStoreProvider !== null}
              onClick={() => void handleEpicOptionClick()}
              className="repacks-modal__repack-button repacks-modal__repack-button--official"
            >
              <span
                className="repacks-modal__availability-orb repacks-modal__availability-orb--online"
                data-tooltip-id="availability-orb-epic"
                data-tooltip-content={t("source_online")}
              />
              <Tooltip id="availability-orb-epic" />

              <p className="repacks-modal__repack-title repacks-modal__steam-title">
                <EpicLogo width={16} height={16} aria-hidden="true" />
                <span>{game?.title ?? epicGame?.title ?? "Epic Games"}</span>
                <span className="repacks-modal__store-badge">
                  Loja Oficial · Epic
                </span>
              </p>
              <p className="repacks-modal__repack-info">
                {startingStoreProvider === "epic"
                  ? "Iniciando download Epic Games..."
                  : hasOwnedEpic
                    ? "Epic Games Oficial · Baixar versão Windows (Legendary)"
                    : t("download_on_epic")}
              </p>
            </Button>
          )}

          {showGogOption && (
            <Button
              theme="dark"
              disabled={startingStoreProvider !== null}
              onClick={() => void handleGogOptionClick()}
              className="repacks-modal__repack-button repacks-modal__repack-button--official"
            >
              <span
                className="repacks-modal__availability-orb repacks-modal__availability-orb--online"
                data-tooltip-id="availability-orb-gog"
                data-tooltip-content={t("source_online")}
              />
              <Tooltip id="availability-orb-gog" />

              <p className="repacks-modal__repack-title repacks-modal__steam-title">
                <GogLogo width={16} height={16} aria-hidden="true" />
                <span>{game?.title ?? "GOG Galaxy"}</span>
                <span className="repacks-modal__store-badge">
                  Loja Oficial · GOG
                </span>
              </p>
              <p className="repacks-modal__repack-info">
                {startingStoreProvider === "gog"
                  ? "Obtendo instalador GOG..."
                  : hasOwnedGog
                    ? "GOG Galaxy Oficial · Instaladores macOS e Windows"
                    : "GOG Oficial · Conectar conta em Ajustes"}
              </p>
            </Button>
          )}

          {(showSteamOption || showEpicOption || showGogOption) &&
            filteredRepacks.length > 0 && (
              <>
                <div className="repacks-modal__separator" />
                <div className="repacks-modal__section-header">
                  <span>Fontes Adicionadas pelo Usuário</span>
                </div>
              </>
            )}

          {filteredRepacks.length === 0
            ? !showSteamOption &&
              !showEpicOption &&
              !showGogOption && (
                <div className="repacks-modal__no-results">
                  <div className="repacks-modal__no-results-content">
                    <div className="repacks-modal__no-results-text">
                      {t("no_repacks_found")}
                    </div>
                    <div className="repacks-modal__no-results-button">
                      <Button
                        type="button"
                        theme="primary"
                        onClick={() => {
                          onClose();
                          navigate("/settings?tab=download_sources");
                        }}
                      >
                        <PlusCircleIcon />
                        {t("add_download_source", { ns: "settings" })}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            : filteredRepacks.map((repack) => {
                const isLastDownloadedOption =
                  checkIfLastDownloadedOption(repack);
                const availabilityStatus = getRepackAvailabilityStatus(repack);
                const tooltipId = `availability-orb-${repack.id}`;

                return (
                  <Button
                    key={repack.id}
                    theme="dark"
                    onClick={() => handleRepackClick(repack)}
                    className="repacks-modal__repack-button"
                  >
                    <span
                      className={`repacks-modal__availability-orb repacks-modal__availability-orb--${availabilityStatus}`}
                      data-tooltip-id={tooltipId}
                      data-tooltip-content={t(`source_${availabilityStatus}`)}
                    />
                    <Tooltip id={tooltipId} />

                    <p className="repacks-modal__repack-title">
                      {repack.title}
                      {userPreferences?.enableNewDownloadOptionsBadges !==
                        false &&
                        isNewRepack(repack) && (
                          <span className="repacks-modal__new-badge">
                            {t("new_download_option")}
                          </span>
                        )}
                    </p>

                    {isLastDownloadedOption && (
                      <Badge>{t("last_downloaded_option")}</Badge>
                    )}

                    <p className="repacks-modal__repack-info">
                      {repack.fileSize} - {repack.downloadSourceName} -{" "}
                      {isDirectHttpsRepack(repack)
                        ? "HTTPS Direto (Redes Restritas) - "
                        : "Torrent/P2P - "}
                      {repack.uploadDate ? formatDate(repack.uploadDate) : ""}
                    </p>
                  </Button>
                );
              })}
        </div>
      </Modal>
    </>
  );
}
