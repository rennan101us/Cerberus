import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FolderOpen,
  Gamepad2,
  Hammer,
  KeyRound,
  RefreshCw,
} from "lucide-react";
import cn from "classnames";
import type {
  Game,
  NxBuildEstimate,
  NxDependencyStatus,
  NxIosDevice,
  NxMetalToolchainInfo,
  NxProdKeysInfo,
  NxReposStatus,
  NxResolvedPaths,
  NxRomGame,
  NxSigningTeam,
  NxTargetPlatform,
} from "@types";
import {
  Badge,
  Button,
  CheckboxField,
  Modal,
  SelectField,
  TextField,
} from "@renderer/components";
import {
  AndroidOfficialIcon,
  IosIpadOsIcon,
  MacOSLogoIcon,
} from "@renderer/components/platform-icons/official-platform-icons";
import { useToast } from "@renderer/hooks";
import "./switch-port-modal.scss";

interface SwitchPortModalProps {
  visible: boolean;
  game: Game;
  onClose: () => void;
}

interface CachedPrereqs {
  at: number;
  missingDeps: NxDependencyStatus[];
  repos: NxReposStatus;
  prodKeys: NxProdKeysInfo;
}

// Module-level cache prevents flashing "missing dependencies" when reopening or switching tabs
const prereqsCache = new Map<NxTargetPlatform, CachedPrereqs>();
const PREREQS_TTL_MS = 60_000;

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function getSpeedCategoryMeta(
  cat: NxBuildEstimate["speedCategory"]
): { label: string; color: string } {
  switch (cat) {
    case "cached":
      return { label: "Cache Instantâneo", color: "#26d980" };
    case "fast":
      return { label: "Rápido", color: "#33bf66" };
    case "moderate":
      return { label: "Moderado", color: "#f2bf33" };
    case "heavy":
      return { label: "Pesado", color: "#f27a29" };
    case "veryHeavy":
      return { label: "Extenso", color: "#b359f2" };
  }
}

export function SwitchPortModal({
  visible,
  game,
  onClose,
}: Readonly<SwitchPortModalProps>) {
  const { showSuccessToast, showErrorToast } = useToast();

  const isSwitch2 =
    game.shop === "switch2" ||
    game.switchGeneration === "switch2" ||
    Boolean(game.switchTitleId?.toUpperCase().startsWith("0400"));

  const [platform, setPlatform] = useState<NxTargetPlatform>("macApp");
  const [rom, setRom] = useState<NxRomGame | null>(null);
  const [estimate, setEstimate] = useState<NxBuildEstimate | null>(null);
  const [metalInfo, setMetalInfo] = useState<NxMetalToolchainInfo | null>(null);

  const initialCached = prereqsCache.get("macApp");
  const [repos, setRepos] = useState<NxReposStatus | null>(
    initialCached?.repos ?? null
  );
  const [prodKeys, setProdKeys] = useState<NxProdKeysInfo | null>(
    initialCached?.prodKeys ?? null
  );
  const [missingDeps, setMissingDeps] = useState<NxDependencyStatus[]>(
    initialCached?.missingDeps ?? []
  );
  const [prereqsChecked, setPrereqsChecked] = useState<boolean>(
    Boolean(initialCached)
  );

  const [iosDevices, setIosDevices] = useState<NxIosDevice[]>([]);
  const [signingTeams, setSigningTeams] = useState<NxSigningTeam[]>([]);
  const [loadingIosDevices, setLoadingIosDevices] = useState(false);
  const iosLoadedRef = useRef(false);

  // Form options (parity with NxNative Launcher PortGameModalView)
  const [autoDeployIos, setAutoDeployIos] = useState(false);
  const [selectedIosDevice, setSelectedIosDevice] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [romfsSplitLimitGB, setRomfsSplitLimitGB] = useState(4);
  const [showFps, setShowFps] = useState(false);
  const [keepExtracted, setKeepExtracted] = useState(true);
  const [allowOtherMetal, setAllowOtherMetal] = useState(true);
  const [surveyOnly, setSurveyOnly] = useState(false);
  const [appName, setAppName] = useState(game.title);
  const [bundleId, setBundleId] = useState("");
  const [language, setLanguage] = useState("auto");
  const [outputDir, setOutputDir] = useState("");
  const [stagingDir, setStagingDir] = useState("");
  const [appSupportDir, setAppSupportDir] = useState("");
  const [nx2androidHomeDir, setNx2androidHomeDir] = useState("");
  const [resolvedPaths, setResolvedPaths] = useState<NxResolvedPaths | null>(
    null
  );
  const [androidExperimental, setAndroidExperimental] = useState(false);
  const [androidProfileSupported, setAndroidProfileSupported] = useState<
    boolean | null
  >(null);

  const [isInstallingDeps, setIsInstallingDeps] = useState(false);
  const [installerLine, setInstallerLine] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  const shop: "switch1" | "switch2" =
    game.shop === "switch2" ? "switch2" : "switch1";

  const refreshPrerequisites = useCallback(
    async (targetPlatform: NxTargetPlatform, force = false) => {
      const cached = prereqsCache.get(targetPlatform);
      if (!force && cached && Date.now() - cached.at < PREREQS_TTL_MS) {
        setMissingDeps(cached.missingDeps);
        setRepos(cached.repos);
        setProdKeys(cached.prodKeys);
        setPrereqsChecked(true);
        return;
      }

      if (!cached) {
        setPrereqsChecked(false);
      }

      try {
        const [missing, repoStatus, keysInfo] = await Promise.all([
          window.electron.nxGetMissingDependenciesForPlatform(targetPlatform),
          window.electron.nxGetRepoStatus(false),
          window.electron.nxDetectProdKeys(),
        ]);
        prereqsCache.set(targetPlatform, {
          at: Date.now(),
          missingDeps: missing,
          repos: repoStatus,
          prodKeys: keysInfo,
        });
        setMissingDeps(missing);
        setRepos(repoStatus);
        setProdKeys(keysInfo);
      } finally {
        setPrereqsChecked(true);
      }
    },
    []
  );

  const loadIosDevices = useCallback(async (force = false) => {
    setLoadingIosDevices(true);
    try {
      const iosInfo = await window.electron.nxListIosDevicesAndTeams(force);
      setIosDevices(iosInfo.devices);
      setSigningTeams(iosInfo.teams);
      if (iosInfo.devices.length > 0) {
        setSelectedIosDevice((prev) => prev || iosInfo.devices[0]?.id || "");
        setAutoDeployIos(true);
      }
      if (iosInfo.teams.length > 0) {
        setSelectedTeam((prev) => prev || iosInfo.teams[0]?.id || "");
      }
      iosLoadedRef.current = true;
    } finally {
      setLoadingIosDevices(false);
    }
  }, []);

  const handleSelectRomSource = async () => {
    const picked = await window.electron.nxSelectRomForGameDialog(
      shop,
      game.objectId
    );
    if (picked?.rom) {
      setRom(picked.rom);
      showSuccessToast(`Origem vinculada: ${picked.rom.folderPath}`);
    }
  };

  // Load game/ROM/hardware estimate ONCE when opening the modal (never re-triggered on platform switch)
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setAppName(game.title);

    const loadInitial = async () => {
      // Trigger immediate baseline build estimate so time range appears right away
      void window.electron
        .nxGetBuildEstimate({
          titleId: game.switchTitleId || game.objectId,
          gameName: game.title,
          totalSizeBytes: game.romSizeBytes || 0,
          gameDirectory: game.switchRomPath || "",
          isSwitch2,
        })
        .then((est) => {
          if (!cancelled) setEstimate(est);
        })
        .catch(() => {});

      const [romRes, resolvedPaths, metal] = await Promise.all([
        window.electron.nxGetRomDetailsForGame(shop, game.objectId),
        window.electron.nxGetResolvedPaths(),
        window.electron.nxGetMetalToolchainInfo(),
      ]);

      if (cancelled) return;

      setRom(romRes.rom);
      setResolvedPaths(resolvedPaths);
      setOutputDir(resolvedPaths.outputDir);
      setStagingDir(resolvedPaths.stagingDir);
      setAppSupportDir(resolvedPaths.appSupportDir);
      setNx2androidHomeDir(resolvedPaths.nx2androidHomeDir);
      setMetalInfo(metal);

      // Refine build estimate with exact ROM folder & size (to detect pre-compiled shader cache!)
      const refinedDir = romRes.rom?.folderPath || game.switchRomPath || "";
      const refinedSize = romRes.rom?.totalSizeBytes || game.romSizeBytes || 0;
      const refinedEst = await window.electron.nxGetBuildEstimate({
        titleId: game.switchTitleId || romRes.rom?.titleId || game.objectId,
        gameName: game.title,
        totalSizeBytes: refinedSize,
        gameDirectory: refinedDir,
        isSwitch2,
      });
      if (!cancelled) setEstimate(refinedEst);
    };

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [
    visible,
    game.objectId,
    game.title,
    game.switchTitleId,
    game.switchRomPath,
    game.romSizeBytes,
    shop,
    isSwitch2,
  ]);

  // Lightweight prerequisite check only when visible or platform changes (uses 60s cache!)
  useEffect(() => {
    if (!visible) return;
    void refreshPrerequisites(platform, false);
  }, [visible, platform, refreshPrerequisites]);

  // Lazy-load iOS devices & signing teams ONLY when iOS platform is selected
  useEffect(() => {
    if (!visible || platform !== "ios") return;
    if (!iosLoadedRef.current) {
      void loadIosDevices();
    }
  }, [visible, platform, loadIosDevices]);

  // Check Android profile support when android is selected
  useEffect(() => {
    if (!visible || platform !== "android") return;
    const tid = game.switchTitleId || rom?.titleId || game.objectId;
    if (!tid) return;
    void window.electron
      .nxCheckAndroidProfileSupport(tid)
      .then((res) => {
        setAndroidProfileSupported(res.supported);
        if (!res.supported) {
          setAndroidExperimental(true);
        }
      })
      .catch(() => {
        setAndroidProfileSupported(false);
        setAndroidExperimental(true);
      });
  }, [visible, platform, game.switchTitleId, rom?.titleId, game.objectId]);

  useEffect(() => {
    if (!visible) return;
    const unsub = window.electron.onNxInstallerProgress((ev) => {
      if (ev.phase === "output" && ev.line) {
        setInstallerLine(ev.line);
      } else if (ev.phase === "start" && ev.itemName) {
        setInstallerLine(`Instalando ${ev.itemName}...`);
      } else if (ev.phase === "complete") {
        setIsInstallingDeps(false);
        setInstallerLine("");
        prereqsCache.clear();
        void refreshPrerequisites(platform, true);
      }
    });
    return () => unsub();
  }, [visible, platform, refreshPrerequisites]);

  const effectiveSourcePath =
    rom?.baseFilePath ||
    rom?.folderPath ||
    game.switchRomPath ||
    (platform === "ios"
      ? game.switchPortedIpaPath ||
        game.switchPortedAppPath ||
        game.executablePath
      : game.switchPortedAppPath ||
        game.switchPortedIpaPath ||
        game.executablePath) ||
    "";

  const isExtractedOrPortedSource = Boolean(
    effectiveSourcePath &&
      (effectiveSourcePath.toLowerCase().endsWith(".ipa") ||
        effectiveSourcePath.toLowerCase().endsWith(".app") ||
        effectiveSourcePath.toUpperCase().endsWith("_BUILD") ||
        effectiveSourcePath.toLowerCase().endsWith(".framework"))
  );

  const isNupOrDump = Boolean(
    rom?.isNup ||
      rom?.isDumpFolder ||
      isSwitch2 ||
      isExtractedOrPortedSource
  );
  // Only treat items as missing AFTER prereqsChecked === true (eliminates false initial flash!)
  const needsProdKeys = prereqsChecked && !isNupOrDump && !prodKeys?.isValid;
  const needsNxnativeRepo = prereqsChecked && !repos?.nxnative.isValid;
  const needsNx2aRepo =
    prereqsChecked && platform === "android" && !repos?.nx2android.isValid;
  const isSwitch2AndroidBlocked = platform === "android" && isSwitch2;
  const hasRomFolder = Boolean(effectiveSourcePath);

  const selectedDeviceObj =
    iosDevices.find((d) => d.id === selectedIosDevice) || null;
  const isIosDeviceLocked =
    platform === "ios" &&
    autoDeployIos &&
    selectedDeviceObj?.isAvailable === false;
  const isIosDeviceMissingForAutoDeploy =
    platform === "ios" &&
    autoDeployIos &&
    !loadingIosDevices &&
    iosDevices.length === 0;
  const isIosTeamMissingForAutoDeploy =
    platform === "ios" &&
    autoDeployIos &&
    !loadingIosDevices &&
    signingTeams.length === 0;

  const hasPendingPrereqs =
    prereqsChecked &&
    (!hasRomFolder ||
      missingDeps.length > 0 ||
      needsNxnativeRepo ||
      needsNx2aRepo ||
      needsProdKeys);

  const canStartPort =
    prereqsChecked &&
    hasRomFolder &&
    !isSwitch2AndroidBlocked &&
    !needsNxnativeRepo &&
    !needsNx2aRepo &&
    !needsProdKeys &&
    missingDeps.length === 0 &&
    !isInstallingDeps;

  const handleInstallPlatformDeps = async () => {
    setIsInstallingDeps(true);
    setInstallerLine("Preparando instalação de dependências...");
    try {
      if (needsNxnativeRepo) {
        setInstallerLine("Clonando backend nxnative...");
        const cloneRes = await window.electron.nxCloneRepo();
        if (!cloneRes.ok) {
          showErrorToast(cloneRes.message);
          return;
        }
      }
      if (needsNx2aRepo) {
        setInstallerLine("Baixando backend nx2android...");
        const nx2Res = await window.electron.nxSyncUpstreamNx2Android();
        if (!nx2Res.ok) {
          showErrorToast(nx2Res.message);
          return;
        }
      }
      if (missingDeps.length > 0) {
        const res =
          await window.electron.nxInstallMissingDependencies(platform);
        if (!res.ok) {
          showErrorToast(
            res.error || "Algumas dependências falharam. Verifique a aba Logs."
          );
          return;
        }
      }
      showSuccessToast(
        `Dependências de ${platformLabel(platform)} prontas! Port liberado.`
      );
      prereqsCache.clear();
      await refreshPrerequisites(platform, true);
    } finally {
      setIsInstallingDeps(false);
      setInstallerLine("");
    }
  };

  const handleApplyAppAdjacentCachePreset = async () => {
    try {
      const updated = await window.electron.nxApplyCacheRootPreset(
        "app-adjacent",
        undefined,
        false
      );
      setResolvedPaths(updated);
      setStagingDir(updated.stagingDir);
      setAppSupportDir(updated.appSupportDir);
      setNx2androidHomeDir(updated.nx2androidHomeDir);
      showSuccessToast(
        "Caches de compilação direcionados para Cerberus_Cache junto ao app."
      );
    } catch {
      showErrorToast("Falha ao aplicar pasta de cache.");
    }
  };

  const handleChooseCustomCacheRoot = async () => {
    const res = await window.electron.showOpenDialog({
      title: "Selecionar Pasta Raiz de Armazenamento e Caches",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: resolvedPaths?.cerberusCacheRoot,
    });
    const picked = res.filePaths?.[0];
    if (!res.canceled && picked) {
      try {
        const updated = await window.electron.nxApplyCacheRootPreset(
          "custom",
          picked,
          false
        );
        setResolvedPaths(updated);
        setStagingDir(updated.stagingDir);
        setAppSupportDir(updated.appSupportDir);
        setNx2androidHomeDir(updated.nx2androidHomeDir);
        showSuccessToast(`Pasta raiz de cache alterada para: ${picked}`);
      } catch {
        showErrorToast("Falha ao aplicar pasta raiz.");
      }
    }
  };

  const handleSelectOutputFolder = async () => {
    const res = await window.electron.showOpenDialog({
      title: "Selecionar Pasta de Saída dos Ports",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: outputDir || resolvedPaths?.outputDir,
    });
    if (res.filePaths?.[0]) {
      setOutputDir(res.filePaths[0]);
      await window.electron.updateUserPreferences({
        nxPortedOutputFolder: res.filePaths[0],
      });
    }
  };

  const handleSelectStagingFolder = async () => {
    const res = await window.electron.showOpenDialog({
      title: "Selecionar Pasta de Staging / Cache de Compilação",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: stagingDir || resolvedPaths?.stagingDir,
    });
    if (res.filePaths?.[0]) {
      setStagingDir(res.filePaths[0]);
      await window.electron.updateUserPreferences({
        nxStagingFolder: res.filePaths[0],
      });
    }
  };

  const handleSelectAppSupportFolder = async () => {
    const res = await window.electron.showOpenDialog({
      title: "Selecionar Pasta AppSupport (Hub / Saves)",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: appSupportDir || resolvedPaths?.appSupportDir,
    });
    if (res.filePaths?.[0]) {
      setAppSupportDir(res.filePaths[0]);
      await window.electron.updateUserPreferences({
        nxAppSupportFolder: res.filePaths[0],
      });
    }
  };

  const handleSelectNx2aHomeFolder = async () => {
    const res = await window.electron.showOpenDialog({
      title: "Selecionar Pasta Home / Cache do Nx2Android",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: nx2androidHomeDir || resolvedPaths?.nx2androidHomeDir,
    });
    if (res.filePaths?.[0]) {
      setNx2androidHomeDir(res.filePaths[0]);
      await window.electron.updateUserPreferences({
        nx2androidHomeFolder: res.filePaths[0],
      });
    }
  };

  const handleStartPort = async () => {
    const gameDirectory = effectiveSourcePath;
    if (!gameDirectory) {
      showErrorToast(
        "Selecione o arquivo ou pasta de origem (.nsp, .xci, .nup, .ipa ou pasta) antes de iniciar."
      );
      return;
    }

    setIsStarting(true);
    try {
      const res = await window.electron.nxStartPortBuild({
        shop,
        objectId: game.objectId,
        gameTitle: game.title,
        titleId: game.switchTitleId || rom?.titleId || game.objectId,
        gameDirectory,
        sourceFiles:
          rom?.files && rom.files.length > 0
            ? rom.files.map((f) => f.path)
            : undefined,
        platform,
        customOutputFolder: outputDir || null,
        stagingWorkDirectory: stagingDir || null,
        androidExperimental:
          platform === "android" ? androidExperimental : undefined,
        appName: appName.trim() || game.title,
        bundleId: bundleId.trim() || null,
        language,
        showFps,
        keepExtracted,
        surveyOnly,
        romfsSeparate:
          platform === "ios" &&
          (rom?.totalSizeBytes || 0) >= romfsSplitLimitGB * 1024 ** 3,
        romfsSplitLimitGB,
        allowOtherMetal,
        autoDeployToIos: platform === "ios" && autoDeployIos,
        iosDeviceId: selectedIosDevice || null,
        iosSigningTeamId: selectedTeam || null,
        isSwitch2,
        isNup: rom?.isNup ?? false,
      });

      if (res.ok) {
        showSuccessToast(
          `Port de "${game.title}" iniciado! Estimativa: ${estimate?.formattedRange || "em andamento"}.`
        );
        onClose();
      } else {
        showErrorToast(res.error || "Não foi possível iniciar o port.");
      }
    } finally {
      setIsStarting(false);
    }
  };

  const platformLabel = (p: NxTargetPlatform) => {
    if (p === "macApp") return "macOS (.app)";
    if (p === "ios") return "iOS / iPadOS (.ipa)";
    return "Android (.apk)";
  };

  const speedMeta = estimate
    ? getSpeedCategoryMeta(estimate.speedCategory)
    : null;

  return (
    <Modal
      visible={visible}
      large
      title="Portar Jogo — NxNative / Nx2Android"
      description="Compile a ROM baixada em um aplicativo nativo com as mesmas opções do NxNative Launcher."
      onClose={onClose}
    >
      <div className="switch-port-modal">
        {/* 1. Game Identity Card */}
        <div className="switch-port-modal__card switch-port-modal__identity">
          <div className="switch-port-modal__cover">
            {game.iconUrl ? (
              <img src={game.iconUrl} alt={game.title} />
            ) : (
              <Gamepad2 size={24} />
            )}
          </div>
          <div className="switch-port-modal__identity-info">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <h4>{game.title}</h4>
              <Button
                theme="outline"
                size="small"
                onClick={() => void handleSelectRomSource()}
                title="Selecionar ou alterar arquivo/pasta da ROM ou origem do port"
              >
                <FolderOpen size={12} />{" "}
                {effectiveSourcePath
                  ? "Alterar Origem"
                  : "Selecionar ROM / Origem"}
              </Button>
            </div>
            <div className="switch-port-modal__meta-row">
              <code>{game.switchTitleId || game.objectId}</code>
              <span>
                {formatBytes(rom?.totalSizeBytes || game.romSizeBytes || 0)}
              </span>
              <Badge>{isSwitch2 ? "Switch 2" : "Switch 1"}</Badge>
              {isNupOrDump && <Badge>Sem prod.keys</Badge>}
            </div>
            {effectiveSourcePath && (
              <small className="switch-port-modal__path">
                {effectiveSourcePath}
              </small>
            )}
          </div>
        </div>

        {/* 2. Target Platform Selector (Official macOS | iOS/iPadOS | Android Icons) */}
        <div className="switch-port-modal__card">
          <h5>Plataforma Alvo</h5>
          <div className="switch-port-modal__platforms">
            {(
              [
                {
                  id: "macApp" as const,
                  title: "macOS",
                  sub: "App Nativo (.app)",
                  icon: <MacOSLogoIcon size={18} />,
                  accent: undefined,
                },
                {
                  id: "ios" as const,
                  title: "iOS / iPadOS",
                  sub: isSwitch2
                    ? "App Bundle Único (Experimental)"
                    : "App Bundle Único (.ipa)",
                  icon: <IosIpadOsIcon size={18} />,
                  accent: undefined,
                },
                {
                  id: "android" as const,
                  title: "Android",
                  sub: "nx2android Vulkan (.apk)",
                  icon: (
                    <AndroidOfficialIcon
                      size={18}
                      style={{
                        color: platform === "android" ? "#3DDC84" : undefined,
                      }}
                    />
                  ),
                  accent: "android",
                },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={cn("switch-port-modal__platform-btn", {
                  "switch-port-modal__platform-btn--active":
                    platform === opt.id,
                  "switch-port-modal__platform-btn--android-active":
                    platform === "android" && opt.id === "android",
                })}
                onClick={() => setPlatform(opt.id)}
              >
                <span className="switch-port-modal__platform-icon">
                  {opt.icon}
                </span>
                <div>
                  <strong>{opt.title}</strong>
                  <small>{opt.sub}</small>
                </div>
                {platform === opt.id && (
                  <CheckCircle2 size={15} className="check-icon" />
                )}
              </button>
            ))}
          </div>

          {isSwitch2AndroidBlocked && (
            <div className="switch-port-modal__alert switch-port-modal__alert--error">
              <AlertTriangle size={15} />
              <span>
                Jogos de Switch 2 ainda não são suportados no backend Android
                (nx2android). Selecione macOS ou iOS/iPadOS.
              </span>
            </div>
          )}

          {platform === "ios" && isSwitch2 && (
            <div className="switch-port-modal__alert switch-port-modal__alert--warn">
              <AlertTriangle size={15} />
              <span>
                Switch 2 no iOS/iPadOS é experimental e exige iPad M1+ ou iPhone
                Pro com memória estendida.
              </span>
            </div>
          )}
        </div>

        {/* 3. Prerequisites & Direct Dependency Installer (Only shown AFTER check confirms missing items) */}
        {hasPendingPrereqs && (
          <div className="switch-port-modal__card switch-port-modal__prereqs">
            <div className="switch-port-modal__prereqs-head">
              <div className="switch-port-modal__prereqs-title">
                <AlertTriangle size={16} className="warn-icon" />
                <div>
                  <strong>
                    Dependências pendentes para {platformLabel(platform)}
                  </strong>
                  <small>
                    Instale os itens abaixo para liberar o botão de portar para{" "}
                    {platformLabel(platform)}.
                  </small>
                </div>
              </div>

              {(missingDeps.length > 0 ||
                needsNxnativeRepo ||
                needsNx2aRepo) && (
                <Button
                  theme="primary"
                  size="small"
                  onClick={handleInstallPlatformDeps}
                  disabled={isInstallingDeps}
                >
                  <Download size={14} />
                  {isInstallingDeps
                    ? "Instalando..."
                    : `Baixar e Instalar Dependências (${
                        missingDeps.length +
                        (needsNxnativeRepo ? 1 : 0) +
                        (needsNx2aRepo ? 1 : 0)
                      })`}
                </Button>
              )}
            </div>

            {installerLine && (
              <div className="switch-port-modal__live-line">
                <code>{installerLine}</code>
              </div>
            )}

            <ul className="switch-port-modal__missing-list">
              {!hasRomFolder && (
                <li className="switch-port-modal__keys-row">
                  <span>
                    <FolderOpen size={13} /> Origem do jogo (.nsp / .xci / .nup
                    / .ipa / pasta) não localizada automaticamente
                  </span>
                  <Button
                    theme="primary"
                    size="small"
                    onClick={() => void handleSelectRomSource()}
                  >
                    <FolderOpen size={13} /> Selecionar ROM / Origem Agora
                  </Button>
                </li>
              )}
              {needsNxnativeRepo && (
                <li className="switch-port-modal__keys-row">
                  <span>Repositório backend nxnative (seedds/nxnative)</span>
                  <Button
                    theme="outline"
                    size="small"
                    disabled={isInstallingDeps}
                    onClick={() => void handleInstallPlatformDeps()}
                  >
                    Clonar Agora
                  </Button>
                </li>
              )}
              {needsNx2aRepo && (
                <li className="switch-port-modal__keys-row">
                  <span>
                    Repositório backend nx2android (shirai91/nx2android)
                  </span>
                  <Button
                    theme="outline"
                    size="small"
                    disabled={isInstallingDeps}
                    onClick={() => void handleInstallPlatformDeps()}
                  >
                    Sincronizar Agora
                  </Button>
                </li>
              )}
              {missingDeps.map((dep) => (
                <li key={dep.id} className="switch-port-modal__keys-row">
                  <span>
                    {dep.name}{" "}
                    {dep.downloadSizeBadge && (
                      <small>({dep.downloadSizeBadge})</small>
                    )}
                  </span>
                  <Button
                    theme="outline"
                    size="small"
                    disabled={isInstallingDeps}
                    onClick={async () => {
                      setIsInstallingDeps(true);
                      try {
                        const res = await window.electron.nxInstallDependency(
                          dep.id
                        );
                        if (res.ok) {
                          prereqsCache.clear();
                          await refreshPrerequisites(platform, true);
                        } else if (res.error) {
                          showErrorToast(res.error);
                        }
                      } finally {
                        setIsInstallingDeps(false);
                      }
                    }}
                  >
                    <Download size={12} /> Instalar
                  </Button>
                </li>
              ))}
              {needsProdKeys && (
                <li className="switch-port-modal__keys-row">
                  <span>
                    <KeyRound size={13} /> prod.keys ausente (necessário para
                    descriptografar NSP/XCI de Switch 1)
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button
                      theme="outline"
                      size="small"
                      onClick={async () => {
                        const detected =
                          await window.electron.nxDetectProdKeys();
                        setProdKeys(detected);
                        prereqsCache.clear();
                        if (detected.isValid) {
                          showSuccessToast(
                            `prod.keys detectado: ${detected.path}`
                          );
                        } else {
                          showErrorToast(
                            "prod.keys não encontrado automaticamente. Selecione o arquivo manualmente."
                          );
                        }
                      }}
                    >
                      Auto-Detectar
                    </Button>
                    <Button
                      theme="primary"
                      size="small"
                      onClick={async () => {
                        const k =
                          await window.electron.nxSelectProdKeysDialog();
                        if (k) {
                          setProdKeys(k);
                          prereqsCache.clear();
                        }
                      }}
                    >
                      Selecionar prod.keys
                    </Button>
                  </div>
                </li>
              )}
            </ul>
          </div>
        )}

        {/* 4. Hardware Estimate (NxNative Launcher Parity) & Updates/DLCs */}
        <div className="switch-port-modal__two-col">
          <div className="switch-port-modal__card">
            <div className="switch-port-modal__est-head">
              <h5>
                <Clock size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
                Tempo Estimado de Port
              </h5>
              {estimate && (
                <span className="switch-port-modal__chip-pill">
                  <MacOSLogoIcon size={11} />
                  {estimate.chipName} ({estimate.coreCount} cores)
                </span>
              )}
            </div>
            <div className="switch-port-modal__est-time">
              <strong>{estimate?.formattedRange || "Calculando..."}</strong>
              {estimate && speedMeta && (
                <span
                  className="switch-port-modal__speed-pill"
                  style={{
                    backgroundColor: `${speedMeta.color}28`,
                    borderColor: `${speedMeta.color}88`,
                  }}
                >
                  <span
                    className="switch-port-modal__speed-dot"
                    style={{ backgroundColor: speedMeta.color }}
                  />
                  {speedMeta.label}
                </span>
              )}
            </div>
            {estimate && estimate.shaderCount > 0 && (
              <div className="switch-port-modal__shader-meta">
                <code>
                  {estimate.shaderCount.toLocaleString("pt-BR")} shaders
                </code>
              </div>
            )}
            <small>{estimate?.explanation}</small>
          </div>

          <div className="switch-port-modal__card">
            <h5>Updates &amp; DLCs Detectados</h5>
            {rom && (rom.updateCount > 0 || rom.dlcCount > 0) ? (
              <div className="switch-port-modal__meta-row">
                {rom.updateCount > 0 && (
                  <Badge>{rom.updateCount} Update(s)</Badge>
                )}
                {rom.dlcCount > 0 && <Badge>{rom.dlcCount} DLC(s)</Badge>}
              </div>
            ) : (
              <small>
                Nenhum update ou DLC adicional encontrado na pasta da ROM.
              </small>
            )}
          </div>
        </div>

        {/* 5. iOS Deploy Options */}
        {platform === "ios" && (
          <div className="switch-port-modal__card">
            <div className="switch-port-modal__est-head">
              <h5>Opções de Deploy iOS / iPadOS (App Bundle Único)</h5>
              <Button
                theme="outline"
                size="small"
                disabled={loadingIosDevices}
                onClick={() => void loadIosDevices(true)}
              >
                <RefreshCw
                  size={12}
                  className={cn({ spin: loadingIosDevices })}
                />
                {loadingIosDevices ? "Buscando..." : "Atualizar Dispositivos"}
              </Button>
            </div>
            <small>
              Todos os jogos portados são enviados juntos dentro de 1 único App
              Bundle (NxN Launcher) no seu iPhone ou iPad.
            </small>
            <CheckboxField
              label="Instalar automaticamente no iPhone/iPad conectado ao terminar (NxN Launcher — App Único Multi-Jogos)"
              checked={autoDeployIos}
              onChange={() => setAutoDeployIos((v) => !v)}
            />

            {/* Guided Assistant for iOS Device Connection / Lock / Signing Team */}
            {isIosDeviceMissingForAutoDeploy && (
              <div
                className="switch-port-modal__alert switch-port-modal__alert--warn"
                style={{
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle size={15} />
                  <strong>
                    Nenhum iPhone ou iPad detectado para instalação automática
                  </strong>
                </div>
                <small style={{ opacity: 0.9, lineHeight: 1.45 }}>
                  1. Conecte o iPhone/iPad via cabo USB • 2. Desbloqueie a tela e
                  toque em <strong>&quot;Confiar neste Computador&quot;</strong>{" "}
                  • 3. Ative o <strong>Modo Desenvolvedor</strong> em Ajustes →
                  Privacidade e Segurança.
                </small>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    theme="primary"
                    size="small"
                    disabled={loadingIosDevices}
                    onClick={() => void loadIosDevices(true)}
                  >
                    <RefreshCw size={12} /> Procurar Dispositivos Novamente
                  </Button>
                  <Button
                    theme="outline"
                    size="small"
                    onClick={() => setAutoDeployIos(false)}
                  >
                    Apenas Gerar .IPA Local (Instalar Depois)
                  </Button>
                </div>
              </div>
            )}

            {isIosDeviceLocked && selectedDeviceObj && (
              <div
                className="switch-port-modal__alert switch-port-modal__alert--warn"
                style={{
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle size={15} />
                  <strong>
                    {selectedDeviceObj.name} está com a tela bloqueada ou offline
                  </strong>
                </div>
                <small style={{ opacity: 0.9 }}>
                  Desbloqueie a tela do seu {selectedDeviceObj.name} e mantenha-a
                  acesa para permitir a instalação do NxN Launcher via USB.
                </small>
                <Button
                  theme="primary"
                  size="small"
                  disabled={loadingIosDevices}
                  onClick={() => void loadIosDevices(true)}
                >
                  <RefreshCw size={12} /> Verificar Desbloqueio Agora
                </Button>
              </div>
            )}

            {isIosTeamMissingForAutoDeploy && (
              <div
                className="switch-port-modal__alert switch-port-modal__alert--warn"
                style={{
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle size={15} />
                  <strong>
                    Nenhuma Conta Apple / Signing Team detectada no Xcode
                  </strong>
                </div>
                <small style={{ opacity: 0.9, lineHeight: 1.45 }}>
                  Para instalar diretamente no iPhone/iPad, adicione seu Apple ID
                  (gratuito ou desenvolvedor) em{" "}
                  <strong>Xcode → Settings → Accounts</strong>.
                </small>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    theme="primary"
                    size="small"
                    onClick={() => void window.electron.nxOpenXcodeAccounts()}
                  >
                    Abrir Xcode para Adicionar Apple ID
                  </Button>
                  <Button
                    theme="outline"
                    size="small"
                    disabled={loadingIosDevices}
                    onClick={() => void loadIosDevices(true)}
                  >
                    <RefreshCw size={12} /> Recarregar Equipes
                  </Button>
                </div>
              </div>
            )}
            <div className="switch-port-modal__two-col">
              <SelectField
                label="Dispositivo iOS / iPadOS"
                theme="dark"
                value={selectedIosDevice}
                onChange={(e) => {
                  setSelectedIosDevice(e.target.value);
                  if (e.target.value) setAutoDeployIos(true);
                }}
                options={
                  iosDevices.length > 0
                    ? iosDevices.map((d) => ({
                        key: d.id,
                        value: d.id,
                        label: `${d.name} (${d.model} · iOS ${d.osVersion}${d.isUsb ? " · USB" : ""}${d.isAvailable === false ? " · Bloqueado/Offline" : ""})`,
                      }))
                    : [
                        {
                          key: "none",
                          value: "",
                          label: loadingIosDevices
                            ? "Procurando dispositivos iOS / iPadOS..."
                            : "Nenhum iPhone ou iPad detectado (conecte via USB e desbloqueie a tela)",
                        },
                      ]
                }
              />
              <SelectField
                label="Signing Team (Apple Developer / Personal Team)"
                theme="dark"
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                options={[
                  {
                    key: "unsigned",
                    value: "",
                    label: "Sem assinatura (Gerar NxN Launcher.ipa)",
                  },
                  ...signingTeams.map((t) => ({
                    key: t.id,
                    value: t.id,
                    label: t.displayName,
                  })),
                ]}
              />
            </div>
          </div>
        )}

        {/* 6. Advanced Settings (Collapsible) */}
        <div className="switch-port-modal__card">
          <button
            type="button"
            className="switch-port-modal__adv-toggle"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? (
              <ChevronDown size={15} />
            ) : (
              <ChevronRight size={15} />
            )}
            <span>Configurações Avançadas de Build</span>
          </button>

          {showAdvanced && (
            <div className="switch-port-modal__adv-body">
              <div className="switch-port-modal__two-col">
                <TextField
                  label="Nome do App"
                  theme="dark"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                />
                <TextField
                  label="Bundle ID (opcional)"
                  theme="dark"
                  value={bundleId}
                  placeholder="com.nxnative.game"
                  onChange={(e) => setBundleId(e.target.value)}
                />
              </div>

              <SelectField
                label="Idioma Padrão do Build"
                theme="dark"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                options={[
                  { key: "auto", value: "auto", label: "Automático" },
                  { key: "pt-BR", value: "pt-BR", label: "Português (Brasil)" },
                  { key: "en-US", value: "en-US", label: "English (US)" },
                  { key: "es-419", value: "es-419", label: "Español (LatAm)" },
                  { key: "ja", value: "ja", label: "日本語 (Japanese)" },
                ]}
              />

              {platform === "ios" && (
                <div className="switch-port-modal__slider-box">
                  <div>
                    <span>Limite de divisão RomFS Separado (iOS)</span>
                    <strong>{romfsSplitLimitGB} GB</strong>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={16}
                    step={1}
                    value={romfsSplitLimitGB}
                    onChange={(e) =>
                      setRomfsSplitLimitGB(Number.parseInt(e.target.value, 10))
                    }
                  />
                </div>
              )}

              <CheckboxField
                label={
                  platform === "android"
                    ? "Ativar patch 60 FPS (--fps60)"
                    : "Mostrar contador de FPS no build (--show-fps)"
                }
                checked={showFps}
                onChange={() => setShowFps((v) => !v)}
              />

              {platform !== "android" && (
                <>
                  <CheckboxField
                    label="Manter arquivos extraídos (--keep-extracted)"
                    checked={keepExtracted}
                    onChange={() => setKeepExtracted((v) => !v)}
                  />

                  <div className="switch-port-modal__metal-row">
                    <CheckboxField
                      label="Permitir versão atual do compilador Metal (--allow-other-metal)"
                      checked={allowOtherMetal}
                      onChange={() => setAllowOtherMetal((v) => !v)}
                    />
                    {metalInfo && (
                      <Badge>
                        {metalInfo.shortVersion} ·{" "}
                        {metalInfo.isVerified ? "Verificado" : "Compatível"}
                      </Badge>
                    )}
                  </div>

                  <CheckboxField
                    label="Modo Survey Only — apenas inspecionar sem compilar (--survey-only)"
                    checked={surveyOnly}
                    onChange={() => setSurveyOnly((v) => !v)}
                  />
                </>
              )}

              {platform === "android" && (
                <>
                  <CheckboxField
                    label="Modo Experimental (--experimental) — permite portar jogos sem perfil no android.tsv"
                    checked={androidExperimental}
                    onChange={() => setAndroidExperimental((v) => !v)}
                  />
                  {androidProfileSupported === false && (
                    <small style={{ color: "#f2bf33", marginTop: -4 }}>
                      Aviso: Este jogo não possui perfil oficial no android.tsv
                      do nx2android. O modo experimental foi ativado
                      automaticamente para permitir a conversão.
                    </small>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 7. Armazenamento, Saída e Cache */}
        <div className="switch-port-modal__card">
          <div className="switch-port-modal__est-head">
            <div>
              <h5>Armazenamento, Saída e Cache</h5>
              <small>
                Controle total sobre onde os arquivos portados, caches de
                compilação e diretórios de ferramentas são salvos.
              </small>
            </div>
            {resolvedPaths && (
              <Badge>
                Livre:{" "}
                {formatBytes(
                  resolvedPaths.cacheRootFreeBytes ||
                    resolvedPaths.outputFreeBytes
                )}
              </Badge>
            )}
          </div>

          <div className="switch-port-modal__cache-preset-row">
            <Button
              theme="outline"
              size="small"
              onClick={() => void handleApplyAppAdjacentCachePreset()}
            >
              <FolderOpen size={13} /> Usar Cerberus_Cache (junto ao app)
            </Button>
            <Button
              theme="outline"
              size="small"
              onClick={() => void handleChooseCustomCacheRoot()}
            >
              <FolderOpen size={13} /> Escolher Pasta Raiz para Tudo...
            </Button>
          </div>

          <div className="switch-port-modal__paths-grid">
            <div className="switch-port-modal__path-item">
              <TextField
                label="Pasta de Saída dos Jogos Portados (Output)"
                theme="dark"
                value={outputDir}
                readOnly
                disabled
                rightContent={
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button
                      theme="outline"
                      size="small"
                      onClick={() => void handleSelectOutputFolder()}
                    >
                      Alterar
                    </Button>
                    <Button
                      theme="outline"
                      size="small"
                      onClick={() =>
                        outputDir &&
                        window.electron.nxRevealInFinder(outputDir)
                      }
                    >
                      Abrir
                    </Button>
                  </div>
                }
              />
            </div>

            <div className="switch-port-modal__path-item">
              <TextField
                label="Cache de Build e Staging de Compilação"
                theme="dark"
                value={stagingDir}
                readOnly
                disabled
                rightContent={
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button
                      theme="outline"
                      size="small"
                      onClick={() => void handleSelectStagingFolder()}
                    >
                      Alterar
                    </Button>
                    <Button
                      theme="outline"
                      size="small"
                      onClick={() =>
                        stagingDir &&
                        window.electron.nxRevealInFinder(stagingDir)
                      }
                    >
                      Abrir
                    </Button>
                  </div>
                }
              />
            </div>

            <div className="switch-port-modal__path-item">
              <TextField
                label="AppSupport (iOS Hub, Saves e Arte)"
                theme="dark"
                value={appSupportDir}
                readOnly
                disabled
                rightContent={
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button
                      theme="outline"
                      size="small"
                      onClick={() => void handleSelectAppSupportFolder()}
                    >
                      Alterar
                    </Button>
                    <Button
                      theme="outline"
                      size="small"
                      onClick={() =>
                        appSupportDir &&
                        window.electron.nxRevealInFinder(appSupportDir)
                      }
                    >
                      Abrir
                    </Button>
                  </div>
                }
              />
            </div>

            {platform === "android" && (
              <div className="switch-port-modal__path-item">
                <TextField
                  label="Cache Android (NX2A_HOME — toolchains, NDK e repositório)"
                  theme="dark"
                  value={nx2androidHomeDir}
                  readOnly
                  disabled
                  rightContent={
                    <div style={{ display: "flex", gap: 4 }}>
                      <Button
                        theme="outline"
                        size="small"
                        onClick={() => void handleSelectNx2aHomeFolder()}
                      >
                        Alterar
                      </Button>
                      <Button
                        theme="outline"
                        size="small"
                        onClick={() =>
                          nx2androidHomeDir &&
                          window.electron.nxRevealInFinder(nx2androidHomeDir)
                        }
                      >
                        Abrir
                      </Button>
                    </div>
                  }
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="switch-port-modal__footer">
          <Button theme="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            theme="primary"
            disabled={!canStartPort || isStarting}
            onClick={() => void handleStartPort()}
          >
            <Hammer size={15} />
            {isStarting
              ? "Iniciando..."
              : !prereqsChecked
                ? "Verificando..."
                : `Portar para ${platformLabel(platform)}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
