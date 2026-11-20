import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { dialog, shell } from "electron";
import type {
  NxGamePreset,
  NxGameRuntimeConfig,
  NxPortBuildOptions,
  NxRomFileItem,
  NxRomGame,
  NxTargetPlatform,
  UserPreferences,
} from "@types";
import { registerEvent } from "../register-event";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { updateGameRecord } from "@main/services/game-record-updater";
import { NxPathsService } from "@main/services/nxnative/nx-paths";
import { NxRepoService } from "@main/services/nxnative/nx-repo-service";
import { NxCompatibilityService } from "@main/services/nxnative/nx-compatibility-service";
import { NxCloudScraperService } from "@main/services/nxnative/nx-cloud-scraper-service";
import {
  NxDownloadService,
  type StartSwitchDownloadParams,
} from "@main/services/nxnative/nx-download-service";
import { NxScannerService } from "@main/services/nxnative/nx-scanner-service";
import { NxBuildService } from "@main/services/nxnative/nx-build-service";
import { NxRuntimeConfigService } from "@main/services/nxnative/nx-runtime-config-service";
import { NxToolchainService } from "@main/services/nxnative/nx-toolchain-service";
import { NxKeyCheckService } from "@main/services/nxnative/nx-keycheck-service";
import { NxHubService } from "@main/services/nxnative/nx-hub-service";
import { CerberusPathsService } from "@main/services/cerberus-paths";
import { checkAndroidProfileSupport } from "@main/services/nxnative/nx-build-helpers";

// --- Repos & Upstream ---

registerEvent("nxGetRepoStatus", async (_e, fetchRemote = false) =>
  NxRepoService.getStatus(Boolean(fetchRemote))
);

registerEvent("nxCloneRepo", async (_e, destinationPath?: string) =>
  NxRepoService.cloneNxnative(destinationPath)
);

registerEvent("nxSyncUpstreamNxnative", async () =>
  NxRepoService.syncUpstreamNxnative()
);

registerEvent("nxSyncUpstreamNx2Android", async () =>
  NxRepoService.syncUpstreamNx2Android()
);

// --- Paths & Hardware ---

registerEvent("nxGetResolvedPaths", async () => {
  const [
    nxnative,
    nx2android,
    outputDir,
    appSupportDir,
    stagingDir,
    tempDir,
    nx2aHome,
    pythonInfo,
    cerberusCacheRoot,
  ] = await Promise.all([
    NxPathsService.resolveNxnativePath(),
    NxPathsService.resolveNx2AndroidPath(),
    NxPathsService.getOutputDirectory(),
    NxPathsService.getAppSupportDirectory(),
    NxPathsService.getStagingDirectory(),
    NxPathsService.getTempDirectory(),
    NxPathsService.getNx2AndroidHomeDirectory(),
    NxPathsService.findBestPython(),
    CerberusPathsService.getCacheRoot(),
  ]);
  return {
    nxnativePath: nxnative.path,
    nxnativeValid: nxnative.isValid,
    nx2androidPath: nx2android.path,
    nx2androidValid: nx2android.isValid,
    outputDir,
    defaultOutputDir: NxPathsService.getDefaultOutputDirectory(cerberusCacheRoot),
    appSupportDir,
    defaultAppSupportDir:
      NxPathsService.getDefaultAppSupportDirectory(cerberusCacheRoot),
    stagingDir,
    defaultStagingDir:
      NxPathsService.getDefaultStagingDirectory(cerberusCacheRoot),
    cerberusCacheRoot,
    defaultCerberusCacheRoot: CerberusPathsService.getDefaultCacheRootDir(),
    appBundleDir: CerberusPathsService.getAppBundleContainerDir(),
    nx2androidHomeDir: nx2aHome,
    defaultNx2androidHomeDir:
      NxPathsService.getDefaultNx2AndroidHomeDirectory(cerberusCacheRoot),
    tempDir,
    outputFreeBytes: NxPathsService.getDiskFreeBytes(outputDir),
    stagingFreeBytes: NxPathsService.getDiskFreeBytes(stagingDir),
    cacheRootFreeBytes: NxPathsService.getDiskFreeBytes(cerberusCacheRoot),
    pythonPath: pythonInfo.path || "",
    pythonVersion: pythonInfo.version || "",
    hasAndroidModules: Boolean(pythonInfo.hasAndroidModules),
  };
});

registerEvent(
  "nxApplyCacheRootPreset",
  async (
    _e,
    mode: "app-adjacent" | "custom",
    customRoot?: string,
    includeOutput = false
  ) => {
    let rawPrefs: UserPreferences = {};
    try {
      rawPrefs =
        ((await db.get<string, UserPreferences>(levelKeys.userPreferences, {
          valueEncoding: "json",
        })) as UserPreferences) || {};
    } catch {
      rawPrefs = {};
    }

    const resolvedRoot =
      mode === "app-adjacent"
        ? CerberusPathsService.getDefaultCacheRootDir()
        : customRoot?.trim()
          ? path.resolve(customRoot.trim())
          : CerberusPathsService.getDefaultCacheRootDir();

    fs.mkdirSync(resolvedRoot, { recursive: true });

    const updatedPrefs: UserPreferences = {
      ...rawPrefs,
      cerberusCacheRoot: resolvedRoot,
      ...(includeOutput
        ? { nxPortedOutputFolder: path.join(resolvedRoot, "Ports") }
        : {}),
      nxStagingFolder: path.join(resolvedRoot, "Staging"),
      nxAppSupportFolder: path.join(resolvedRoot, "AppSupport"),
      nx2androidHomeFolder: path.join(resolvedRoot, "nx2android"),
    };

    await db.put(levelKeys.userPreferences, updatedPrefs, {
      valueEncoding: "json",
    });

    const [
      nxnative,
      nx2android,
      outputDir,
      appSupportDir,
      stagingDir,
      tempDir,
      nx2aHome,
      pythonInfo,
    ] = await Promise.all([
      NxPathsService.resolveNxnativePath(),
      NxPathsService.resolveNx2AndroidPath(),
      NxPathsService.getOutputDirectory(),
      NxPathsService.getAppSupportDirectory(),
      NxPathsService.getStagingDirectory(),
      NxPathsService.getTempDirectory(),
      NxPathsService.getNx2AndroidHomeDirectory(),
      NxPathsService.findBestPython(),
    ]);

    return {
      nxnativePath: nxnative.path,
      nxnativeValid: nxnative.isValid,
      nx2androidPath: nx2android.path,
      nx2androidValid: nx2android.isValid,
      outputDir,
      defaultOutputDir:
        NxPathsService.getDefaultOutputDirectory(resolvedRoot),
      appSupportDir,
      defaultAppSupportDir:
        NxPathsService.getDefaultAppSupportDirectory(resolvedRoot),
      stagingDir,
      defaultStagingDir:
        NxPathsService.getDefaultStagingDirectory(resolvedRoot),
      cerberusCacheRoot: resolvedRoot,
      defaultCerberusCacheRoot: CerberusPathsService.getDefaultCacheRootDir(),
      appBundleDir: CerberusPathsService.getAppBundleContainerDir(),
      nx2androidHomeDir: nx2aHome,
      defaultNx2androidHomeDir:
        NxPathsService.getDefaultNx2AndroidHomeDirectory(resolvedRoot),
      tempDir,
      outputFreeBytes: NxPathsService.getDiskFreeBytes(outputDir),
      stagingFreeBytes: NxPathsService.getDiskFreeBytes(stagingDir),
      cacheRootFreeBytes: NxPathsService.getDiskFreeBytes(resolvedRoot),
      pythonPath: pythonInfo.path || "",
      pythonVersion: pythonInfo.version || "",
      hasAndroidModules: Boolean(pythonInfo.hasAndroidModules),
    };
  }
);

registerEvent("nxCheckAndroidProfileSupport", async (_e, titleId: string) => {
  const nx2a = await NxPathsService.resolveNx2AndroidPath();
  return checkAndroidProfileSupport(nx2a.isValid ? nx2a.path : null, titleId);
});

registerEvent(
  "nxMigrateAppSupportFolder",
  async (_e, sourceDir: string, targetDir: string) =>
    NxPathsService.migrateDirectoryContents(sourceDir, targetDir)
);

registerEvent("nxGetSystemHardwareInfo", async () =>
  NxPathsService.getHardwareInfo()
);

registerEvent("nxRevealInFinder", async (_e, targetPath: string) => {
  if (targetPath) {
    shell.showItemInFolder(targetPath);
  }
});

// --- Compatibility & Cloud Streams ---

registerEvent("nxGetCompatibleGames", async (_e, forceRefresh = false) =>
  NxCompatibilityService.getCompatibleGames(Boolean(forceRefresh))
);

registerEvent("nxRefreshCompatibleGames", async () =>
  NxCompatibilityService.refreshCompatibleGames()
);

registerEvent("nxSyncSwitchSources", async () =>
  NxCloudScraperService.syncAllSwitchSources()
);

registerEvent("nxResolveGameStreams", async (_e, titleId: string) =>
  NxCloudScraperService.getStreamsForTitleId(titleId)
);

registerEvent(
  "nxResolveLiveGameStreams",
  async (
    _e,
    titleId: string,
    title: string,
    generation: "switch1" | "switch2"
  ) =>
    NxCloudScraperService.resolveStreamsForSingleGame(
      titleId,
      title,
      generation
    )
);

registerEvent(
  "nxStartSwitchGameDownload",
  async (_e, params: StartSwitchDownloadParams) =>
    NxDownloadService.startSwitchGameDownload(params)
);

registerEvent("nxOpenExternalUrl", async (_e, url: string) => {
  if (url) {
    await shell.openExternal(url);
  }
});

// --- Scanner & Library ---

registerEvent("nxScanLibraryAndRoms", async () =>
  NxScannerService.scanAndSyncToLibrary()
);

registerEvent(
  "nxGetRomDetailsForGame",
  async (_e, shop: "switch1" | "switch2", objectId: string) => {
    const gameKey = levelKeys.game(shop, objectId);
    let game = await gamesSublevel.get(gameKey).catch(() => null);
    let roms = NxScannerService.getCachedRomGames();
    if (roms.length === 0) {
      const scan = await NxScannerService.scanAndSyncToLibrary();
      roms = scan.roms;
      game = (await gamesSublevel.get(gameKey).catch(() => null)) ?? game;
    }

    const tid = (game?.switchTitleId || objectId).toUpperCase();
    const normGameTitle = (game?.title || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    let matched: NxRomGame | null =
      roms.find((r) => r.titleId?.toUpperCase() === tid) ||
      roms.find(
        (r) => game?.switchRomPath && r.folderPath === game.switchRomPath
      ) ||
      (normGameTitle.length >= 4
        ? roms.find((r) => {
            const normRom = r.name
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "");
            return (
              normRom === normGameTitle ||
              normRom.includes(normGameTitle) ||
              normGameTitle.includes(normRom)
            );
          }) || null
        : null);

    // If not found in cached ROMs, run a fresh scan (discovers /Volumes/Nintendo/Games)
    if (!matched) {
      const scan = await NxScannerService.scanAndSyncToLibrary();
      roms = scan.roms;
      game = (await gamesSublevel.get(gameKey).catch(() => null)) ?? game;
      matched =
        roms.find((r) => r.titleId?.toUpperCase() === tid) ||
        roms.find(
          (r) => game?.switchRomPath && r.folderPath === game.switchRomPath
        ) ||
        (normGameTitle.length >= 4
          ? roms.find((r) => {
              const normRom = r.name
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "");
              return (
                normRom === normGameTitle ||
                normRom.includes(normGameTitle) ||
                normGameTitle.includes(normRom)
              );
            }) || null
          : null);
    }

    // Fallback: resolve existing <TitleID>_build, .ipa, .app, or MobileHub framework
    if (!matched) {
      const [outputDir, stagingDir, hubDirs] = await Promise.all([
        NxPathsService.getOutputDirectory(),
        NxPathsService.getStagingDirectory(),
        NxHubService.getHubDirectories(),
      ]);

      const candidateBuildDirs = [
        path.join(outputDir, `${tid}_build`),
        path.join(stagingDir, `${tid}_build`),
        path.join("/Volumes/Nintendo/Games/Switch 1", `${tid}_build`),
        path.join("/Volumes/Nintendo/Games", `${tid}_build`),
      ];
      const existingBuildDir =
        candidateBuildDirs.find((d) => fs.existsSync(d)) || null;

      let existingIpaPath =
        game?.switchPortedIpaPath && fs.existsSync(game.switchPortedIpaPath)
          ? game.switchPortedIpaPath
          : null;
      if (!existingIpaPath && fs.existsSync(outputDir)) {
        for (const entry of fs.readdirSync(outputDir)) {
          if (entry.startsWith("._") || !entry.toLowerCase().endsWith(".ipa")) {
            continue;
          }
          if (entry.toLowerCase() === "nxn launcher.ipa") continue;
          const normEntry = entry
            .slice(0, -4)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
          if (
            entry.toUpperCase().includes(tid) ||
            (normGameTitle.length >= 4 &&
              (normEntry === normGameTitle ||
                normEntry.includes(normGameTitle) ||
                normGameTitle.includes(normEntry)))
          ) {
            existingIpaPath = path.join(outputDir, entry);
            break;
          }
        }
      }

      const existingAppPath =
        (game?.switchPortedAppPath &&
          fs.existsSync(game.switchPortedAppPath) &&
          game.switchPortedAppPath) ||
        (game?.executablePath &&
          fs.existsSync(game.executablePath) &&
          game.executablePath) ||
        null;

      const existingHubFwPath = path.join(
        hubDirs.frameworksDir,
        `DmGame${tid}.framework`
      );
      const hasHubFw = fs.existsSync(existingHubFwPath);

      const fallbackSource =
        (game?.switchRomPath &&
          fs.existsSync(game.switchRomPath) &&
          game.switchRomPath) ||
        existingBuildDir ||
        existingIpaPath ||
        existingAppPath ||
        (hasHubFw ? existingHubFwPath : null);

      if (fallbackSource) {
        let sizeBytes = game?.romSizeBytes || game?.installedSizeInBytes || 0;
        if (!sizeBytes) {
          try {
            const st = fs.statSync(fallbackSource);
            if (!st.isDirectory()) sizeBytes = st.size;
          } catch {
            // ignore
          }
        }
        matched = {
          id: tid,
          name: game?.title || tid,
          titleId: tid,
          baseFilePath: fallbackSource,
          folderPath: fallbackSource,
          files: [],
          updateCount: 0,
          dlcCount: 0,
          totalSizeBytes: sizeBytes,
          isNup: fallbackSource.toLowerCase().endsWith(".nup"),
          isDumpFolder: Boolean(
            existingBuildDir || existingIpaPath || hasHubFw || existingAppPath
          ),
          generation: shop,
        };
      }
    }

    return {
      rom: matched,
      game,
    };
  }
);

registerEvent(
  "nxSelectRomForGameDialog",
  async (_e, shop: "switch1" | "switch2", objectId: string) => {
    const res = await dialog.showOpenDialog({
      title: "Selecionar ROM ou Pasta de Origem (.nsp, .nsz, .xci, .nup, .ipa ou Pasta)",
      properties: ["openFile", "openDirectory"],
      filters: [
        {
          name: "ROMs & Pacotes Switch",
          extensions: ["nsp", "nsz", "nzs", "xci", "xcz", "nup", "ipa", "app"],
        },
        { name: "Todos os arquivos", extensions: ["*"] },
      ],
    });
    const picked = res.filePaths?.[0];
    if (res.canceled || !picked) return null;

    const isFile =
      fs.existsSync(picked) &&
      !fs.statSync(picked).isDirectory() &&
      !picked.toLowerCase().endsWith(".ipa") &&
      !picked.toLowerCase().endsWith(".nup");
    const sourceFolder = isFile ? path.dirname(picked) : picked;

    const gameKey = levelKeys.game(shop, objectId);
    const updatedGame = await updateGameRecord(gameKey, (current) => ({
      ...current,
      switchRomPath: isFile ? picked : sourceFolder,
    })).catch(() => null);

    const tid = (updatedGame?.switchTitleId || objectId).toUpperCase();
    let sizeBytes = 0;
    try {
      const st = fs.statSync(picked);
      if (!st.isDirectory()) sizeBytes = st.size;
    } catch {
      // ignore
    }

    const files: NxRomFileItem[] = [];

    if (isFile) {
      files.push({
        path: picked,
        name: path.basename(picked),
        sizeBytes,
        type: "base",
        titleId: tid,
        versionString: null,
      });
      try {
        const siblingNames = fs.readdirSync(sourceFolder);
        const prefix = tid.length >= 13 ? tid.slice(0, 13) : tid;
        for (const name of siblingNames) {
          const full = path.join(sourceFolder, name);
          if (full === picked) continue;
          const ext = path.extname(name).toLowerCase();
          if (![".nsp", ".nsz", ".xci", ".xcz"].includes(ext)) continue;
          const upper = name.toUpperCase();
          if (prefix && upper.includes(prefix)) {
            const st = fs.statSync(full);
            const isUpdate =
              upper.includes("UPD") ||
              upper.includes("[UPD]") ||
              (upper.includes("[0100") && upper.endsWith("800]"));
            const isDlc = upper.includes("DLC") || upper.includes("[DLC]");
            const type: "base" | "update" | "dlc" = isUpdate
              ? "update"
              : isDlc
                ? "dlc"
                : "update";
            files.push({
              path: full,
              name,
              sizeBytes: st.size,
              type,
              titleId: tid,
              versionString: null,
            });
          }
        }
      } catch {
        // ignore
      }
    } else {
      try {
        const entries = fs.readdirSync(sourceFolder);
        for (const name of entries) {
          const full = path.join(sourceFolder, name);
          const ext = path.extname(name).toLowerCase();
          if ([".nsp", ".nsz", ".xci", ".xcz", ".nup"].includes(ext)) {
            const st = fs.statSync(full);
            const upper = name.toUpperCase();
            const isUpdate = upper.includes("UPD") || upper.includes("[UPD]");
            const isDlc = upper.includes("DLC") || upper.includes("[DLC]");
            files.push({
              path: full,
              name,
              sizeBytes: st.size,
              type: isUpdate ? "update" : isDlc ? "dlc" : "base",
              titleId: tid,
              versionString: null,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    const updateCount = files.filter((f) => f.type === "update").length;
    const dlcCount = files.filter((f) => f.type === "dlc").length;
    const totalSizeBytes = files.reduce(
      (acc, f) => acc + f.sizeBytes,
      isFile ? 0 : sizeBytes
    );

    const rom: NxRomGame = {
      id: tid,
      name: updatedGame?.title || path.basename(picked),
      titleId: tid,
      baseFilePath: isFile
        ? picked
        : (files.find((f) => f.type === "base")?.path || picked),
      folderPath: sourceFolder,
      files,
      updateCount,
      dlcCount,
      totalSizeBytes: totalSizeBytes || sizeBytes,
      isNup: picked.toLowerCase().endsWith(".nup"),
      isDumpFolder:
        picked.toLowerCase().endsWith(".ipa") ||
        picked.toUpperCase().endsWith("_BUILD") ||
        fs.existsSync(path.join(sourceFolder, "base", "exefs", "main.npdm")) ||
        fs.existsSync(path.join(sourceFolder, "exefs", "main.npdm")),
      generation: shop,
    };

    return { rom, game: updatedGame };
  }
);

registerEvent("nxGetHubStatus", async () => NxHubService.getHubStatus());

registerEvent(
  "nxDeployToIosHub",
  async (
    _e,
    params: {
      titleId: string;
      gameTitle: string;
      gameDirectory?: string | null;
      deviceId: string;
      teamId?: string | null;
    }
  ) => NxHubService.deployRegisteredGameToDevice(params)
);

registerEvent("nxOpenXcodeAccounts", async () => {
  execFile("/usr/bin/open", ["-a", "Xcode"], () => {});
  return { ok: true };
});

// --- Build / Portar Jogo ---

registerEvent(
  "nxGetBuildEstimate",
  async (
    _e,
    params: {
      titleId?: string | null;
      gameName: string;
      totalSizeBytes: number;
      gameDirectory: string;
      isSwitch2: boolean;
    }
  ) => NxBuildService.estimateBuild(params)
);

registerEvent("nxGetMetalToolchainInfo", async () =>
  NxBuildService.detectMetalToolchain()
);

registerEvent(
  "nxListIosDevicesAndTeams",
  async (_e, force = false) =>
    NxBuildService.listIosDevicesAndTeams(Boolean(force))
);

registerEvent("nxStartPortBuild", async (_e, options: NxPortBuildOptions) =>
  NxBuildService.startBuild(options)
);

registerEvent("nxCancelPortBuild", async () => NxBuildService.cancelBuild());

registerEvent("nxGetActiveBuildJob", async () => NxBuildService.getActiveJob());

// --- Per-Game Runtime Config, Presets, Mods, iCloud ---

registerEvent(
  "nxGetGameRuntimeConfig",
  async (_e, shop: "switch1" | "switch2", objectId: string) =>
    NxRuntimeConfigService.loadRuntimeConfig(shop, objectId)
);

registerEvent(
  "nxSaveGameRuntimeConfig",
  async (
    _e,
    shop: "switch1" | "switch2",
    objectId: string,
    config: NxGameRuntimeConfig
  ) => NxRuntimeConfigService.saveRuntimeConfig(shop, objectId, config)
);

registerEvent("nxGetGameLanguages", async (_e, appPath: string) =>
  NxScannerService.getSupportedLanguages(appPath)
);

registerEvent(
  "nxLaunchSwitchGame",
  async (_e, shop: "switch1" | "switch2", objectId: string) =>
    NxRuntimeConfigService.launchSwitchGame(shop, objectId)
);

registerEvent(
  "nxListPresets",
  async (_e, titleId: string, gameTitle?: string) =>
    NxRuntimeConfigService.listPresets(titleId, gameTitle)
);

registerEvent(
  "nxSavePreset",
  async (
    _e,
    titleId: string,
    name: string,
    config: NxGameRuntimeConfig,
    gameTitle?: string
  ) => NxRuntimeConfigService.saveCustomPreset(titleId, name, config, gameTitle)
);

registerEvent(
  "nxDeletePreset",
  async (_e, titleId: string, presetName: string) =>
    NxRuntimeConfigService.deleteCustomPreset(titleId, presetName)
);

registerEvent(
  "nxExportPresetDialog",
  async (_e, preset: NxGamePreset, gameTitle?: string) => {
    const res = await dialog.showSaveDialog({
      title: "Exportar Preset (.nxn)",
      defaultPath: `${preset.name}.nxn`,
      filters: [{ name: "NxNative Preset", extensions: ["nxn"] }],
    });
    if (res.canceled || !res.filePath) return null;
    return NxRuntimeConfigService.exportPresetToFile(
      preset,
      res.filePath,
      gameTitle
    );
  }
);

registerEvent(
  "nxImportPresetDialog",
  async (_e, titleId: string, gameTitle?: string) => {
    const res = await dialog.showOpenDialog({
      title: "Importar Preset (.nxn)",
      properties: ["openFile"],
      filters: [{ name: "NxNative Preset", extensions: ["nxn"] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return NxRuntimeConfigService.importPresetFromFile(
      titleId,
      res.filePaths[0],
      gameTitle
    );
  }
);

registerEvent(
  "nxListMods",
  async (_e, titleId: string, appPath?: string | null) =>
    NxRuntimeConfigService.discoverMods(titleId, appPath)
);

registerEvent("nxInstallModDialog", async (_e, titleId: string) => {
  const res = await dialog.showOpenDialog({
    title: "Selecionar Mod (.zip ou Pasta)",
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Mod Archive", extensions: ["zip"] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return NxRuntimeConfigService.installMod(titleId, res.filePaths[0]);
});

registerEvent("nxToggleMod", async (_e, titleId: string, folderPath: string) =>
  NxRuntimeConfigService.toggleMod(titleId, folderPath)
);

registerEvent("nxDeleteMod", async (_e, titleId: string, folderPath: string) =>
  NxRuntimeConfigService.deleteMod(titleId, folderPath)
);

registerEvent("nxOpenModsFolder", async (_e, titleId: string) => {
  const dir = await NxRuntimeConfigService.getModsDirectory(titleId);
  await shell.openPath(dir);
});

registerEvent("nxGetGameICloudStatus", async (_e, titleId: string) => ({
  available: NxPathsService.isICloudDriveAvailable(),
  enabled: await NxRuntimeConfigService.isGameICloudSyncEnabled(titleId),
}));

registerEvent(
  "nxSetGameICloudSync",
  async (_e, titleId: string, enabled: boolean) =>
    NxRuntimeConfigService.setGameICloudSync(titleId, enabled)
);

registerEvent("nxOpenSaveFolder", async (_e, titleId: string) => {
  const dir = await NxRuntimeConfigService.getSaveDirectory(titleId);
  await shell.openPath(dir);
});

// --- Prerequisites, Prod.keys & Storage/Caches ---

registerEvent("nxCheckPrerequisites", async () =>
  NxToolchainService.checkPrerequisites()
);

registerEvent(
  "nxGetMissingDependenciesForPlatform",
  async (_e, platform: NxTargetPlatform) =>
    NxToolchainService.getMissingForPlatform(platform)
);

registerEvent("nxInstallDependency", async (_e, dependencyId: string) =>
  NxToolchainService.runDependencyAction("install", dependencyId)
);

registerEvent("nxRepairDependency", async (_e, dependencyId: string) =>
  NxToolchainService.runDependencyAction("repair", dependencyId)
);

registerEvent("nxUninstallDependency", async (_e, dependencyId: string) =>
  NxToolchainService.runDependencyAction("uninstall", dependencyId)
);

registerEvent(
  "nxInstallMissingDependencies",
  async (_e, platform?: NxTargetPlatform) =>
    NxToolchainService.installMissingDependencies(platform)
);

registerEvent("nxDetectProdKeys", async () =>
  NxKeyCheckService.resolveProdKeys()
);

registerEvent("nxSelectProdKeysDialog", async () => {
  const res = await dialog.showOpenDialog({
    title: "Selecionar prod.keys",
    properties: ["openFile"],
    filters: [{ name: "Switch Keys", extensions: ["keys"] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return NxKeyCheckService.setProdKeysPath(res.filePaths[0]);
});

registerEvent("nxGetStorageStats", async () =>
  NxToolchainService.getStorageStats()
);

registerEvent("nxCleanBuildCache", async () =>
  NxToolchainService.cleanBuildCache()
);

registerEvent("nxCleanArtworkCache", async () =>
  NxToolchainService.cleanArtworkCache()
);

registerEvent("nxPurgeICloudBackups", async () =>
  NxToolchainService.purgeICloudBackups()
);

registerEvent("nxSetGlobalICloudSync", async (_e, enabled: boolean) => {
  let prefs: UserPreferences = {};
  try {
    prefs = (await db.get<string, UserPreferences>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })) as UserPreferences;
  } catch {
    prefs = {};
  }
  await db.put(
    levelKeys.userPreferences,
    { ...prefs, nxICloudSyncEnabled: enabled },
    { valueEncoding: "json" }
  );
  return enabled;
});
