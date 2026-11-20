import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import type {
  Game,
  GameShop,
  GameUninstallOptions,
  GameUninstallPreview,
  GameUninstallResult,
} from "@types";
import { gamesSublevel, downloadsSublevel, levelKeys } from "@main/level";
import { updateGameRecord } from "@main/services/game-record-updater";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { removeLibraryGame } from "@main/helpers/remove-library-game";
import { Ludusavi } from "@main/services/ludusavi";
import { ICloudSaveService } from "@main/services/icloud-save-service";
import {
  CrossOverDetector,
  DEFAULT_BOTTLE_NAME,
} from "@main/services/crossover/crossover-detector";
import { CrossOverRunner } from "@main/services/crossover/crossover-runner";
import { NxPathsService } from "@main/services/nxnative/nx-paths";
import { NxRuntimeConfigService } from "@main/services/nxnative/nx-runtime-config-service";
import { WindowManager } from "@main/services/window-manager";
import { AppLogHub } from "@main/services/app-log-hub";
import { logger } from "@main/services/logger";

const UNINSTALLER_IGNORED_DIRS = new Set([
  "redist",
  "_commonredist",
  "commonredist",
  "directx",
  "vcredist",
  "dotnet",
  "__macosx",
  "node_modules",
]);

const ENGINE_SUBDIR_NAMES = new Set([
  "win64",
  "win32",
  "x64",
  "x86",
  "bin",
  "binaries",
  "ship",
  "release",
]);

/**
 * Folders that commonly hold many games side by side. They must never be
 * treated as the install dir of a single game.
 */
const MULTI_GAME_CONTAINER_NAMES = new Set([
  "dodi-repacks",
  "dodi repacks",
  "dodi",
  "fitgirl",
  "fitgirl repacks",
  "fitgirl-repacks",
  "repacks",
  "games",
  "jogos",
  "gog games",
  "epic games",
  "steam",
  "steamlibrary",
  "ubisoft",
  "ubisoft game launcher",
  "ea games",
  "origin games",
  "rockstar games",
  "emulations",
  "roms",
  "installers",
  "game installers",
]);

function normalizeAlphaNum(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function unescapeRegValue(raw: string): string {
  return raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function tokenizeNormalized(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length >= 2);
}

/**
 * Guard against accidentally deleting system directories, bottle roots, drive_c, or User home.
 */
export function isSafeRemovableInstallDir(dirPath: string): boolean {
  if (!dirPath || !dirPath.trim()) return false;
  const resolved = path.resolve(dirPath);
  if (resolved === "/" || resolved === path.resolve(os.homedir())) return false;

  const segments = resolved.split(path.sep).filter(Boolean);
  if (segments.length < 3) return false;

  const lower = resolved.toLowerCase();
  const baseLower = path.basename(resolved).toLowerCase();

  // Protect macOS system roots & Cerberus/CrossOver apps themselves
  if (
    lower === "/applications" ||
    lower === "/system" ||
    lower === "/library" ||
    lower === "/users" ||
    lower === "/volumes" ||
    lower === "/applications/crossover.app" ||
    lower === "/applications/cerberus.app"
  ) {
    return false;
  }

  // Protect /Volumes/<DriveName> root
  if (segments[0].toLowerCase() === "volumes" && segments.length === 2) {
    return false;
  }

  // Protect common Wine bottle / prefix / Windows system roots
  if (
    baseLower === "drive_c" ||
    baseLower === "program files" ||
    baseLower === "program files (x86)" ||
    baseLower === "programdata" ||
    baseLower === "windows" ||
    baseLower === "system32" ||
    baseLower === "syswow64" ||
    baseLower === "users" ||
    baseLower === "appdata" ||
    baseLower === "documents" ||
    baseLower === "desktop" ||
    baseLower === "downloads" ||
    baseLower === "bottles" ||
    baseLower === "steamapps" ||
    baseLower === "common" ||
    baseLower === "nxports" ||
    baseLower === "staging"
  ) {
    return false;
  }

  if (MULTI_GAME_CONTAINER_NAMES.has(baseLower)) {
    return false;
  }

  const parentBaseLower = path.basename(path.dirname(resolved)).toLowerCase();
  if (parentBaseLower === "bottles" || parentBaseLower === "users") {
    return false;
  }

  return true;
}

/**
 * Searches installDir (up to depth 2) for unins*.exe, uninstall.exe or *uninst*.exe.
 */
export function findUninstallerInDirectory(
  installDir: string,
  maxDepth = 2
): string | null {
  if (!installDir || !fs.existsSync(installDir)) return null;

  const candidates: Array<{ filePath: string; score: number; depth: number }> =
    [];

  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          depth < maxDepth &&
          !UNINSTALLER_IGNORED_DIRS.has(entry.name.toLowerCase())
        ) {
          walk(fullPath, depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) continue;

      const lower = entry.name.toLowerCase();
      if (!lower.endsWith(".exe")) continue;

      let score = -1;
      if (/^unins\d*\.exe$/i.test(lower)) score = 100;
      else if (lower === "uninstall.exe") score = 95;
      else if (/^uninst.*\.exe$/i.test(lower)) score = 80;
      else if (lower.includes("uninst")) score = 60;

      if (score > 0) {
        candidates.push({ filePath: fullPath, score, depth });
      }
    }
  };

  walk(installDir, 0);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.filePath.localeCompare(b.filePath);
  });

  return candidates[0].filePath;
}

function extractExecutableFromUninstallString(rawValue: string): string | null {
  const unescaped = unescapeRegValue(rawValue).trim();
  if (!unescaped) return null;

  if (unescaped.startsWith('"')) {
    const endQuote = unescaped.indexOf('"', 1);
    if (endQuote > 1) {
      const inside = unescaped.slice(1, endQuote).trim();
      if (inside.toLowerCase().endsWith(".exe")) {
        return inside;
      }
    }
  }

  const exeMatch = unescaped.match(
    /([a-zA-Z]:\\[^"*?<>|\r\n]+?\.exe)(?=\s|$|")/i
  );
  if (exeMatch?.[1]) {
    return exeMatch[1].trim();
  }

  return null;
}

/**
 * Parses a Wine system.reg file for Microsoft\Windows\CurrentVersion\Uninstall entries matching gameTitle or installDir.
 */
export function parseWineRegistryUninstallString(
  systemRegContent: string,
  gameTitle: string,
  installDir?: string | null
): string | null {
  if (!systemRegContent) return null;

  const lines = systemRegContent.split(/\r?\n/);
  const uninstallSectionRe =
    /^\[.*\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\([^\]]+)\]/i;

  const targetAlpha = normalizeAlphaNum(gameTitle);
  const targetTokens = tokenizeNormalized(gameTitle);
  const installBaseLower = installDir
    ? path.basename(installDir).toLowerCase()
    : "";

  let inTargetSection = false;
  let currentProps: Record<string, string> = {};
  const entries: Array<Record<string, string>> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      if (inTargetSection && Object.keys(currentProps).length > 0) {
        entries.push(currentProps);
      }
      currentProps = {};
      const normalizedHeader = line.replace(/\\+/g, "\\");
      inTargetSection = uninstallSectionRe.test(normalizedHeader);
      continue;
    }

    if (!inTargetSection || !line) continue;
    const match = line.match(/^"([^"]+)"="(.*)"$/);
    if (match) {
      currentProps[match[1]] = unescapeRegValue(match[2]);
    }
  }
  if (inTargetSection && Object.keys(currentProps).length > 0) {
    entries.push(currentProps);
  }

  for (const entry of entries) {
    const displayName = entry.DisplayName || "";
    const installLoc = (entry.InstallLocation || "").replace(/\\+$/, "");
    const rawCmd = entry.UninstallString || entry.QuietUninstallString || "";
    if (!rawCmd) continue;

    let matches = false;
    if (installBaseLower && installLoc) {
      const locBase =
        installLoc
          .split(/[/\\]+/)
          .pop()
          ?.toLowerCase() || "";
      if (locBase && locBase === installBaseLower) {
        matches = true;
      }
    }

    if (!matches && displayName && targetAlpha.length >= 3) {
      const entryAlpha = normalizeAlphaNum(displayName);
      if (entryAlpha === targetAlpha) {
        matches = true;
      } else if (targetTokens.length >= 2) {
        const entryTokens = new Set(tokenizeNormalized(displayName));
        const allPresent = targetTokens.every((t) => entryTokens.has(t));
        if (allPresent) matches = true;
      }
    }

    if (matches) {
      const exePath = extractExecutableFromUninstallString(rawCmd);
      if (exePath) return exePath;
    }
  }

  return null;
}

export function mapWineWindowsPathToPosix(
  winPath: string,
  bottleDir: string
): string | null {
  if (!winPath) return null;
  const trimmed = winPath.trim().replace(/^"+|"+$/g, "");
  const match = trimmed.match(/^([a-zA-Z]):\\(.*)$/);
  if (!match) return null;

  const drive = match[1].toUpperCase();
  const relSegments = match[2].split(/\\+/).filter(Boolean);

  if (drive === "C") {
    return path.join(bottleDir, "drive_c", ...relSegments);
  }
  if (drive === "Z") {
    return path.join("/", ...relSegments);
  }

  const dosDevice = path.join(
    bottleDir,
    "dosdevices",
    `${drive.toLowerCase()}:`
  );
  try {
    const realTarget = fs.realpathSync(dosDevice);
    return path.join(realTarget, ...relSegments);
  } catch {
    return null;
  }
}

export async function computePathsSizeBytes(paths: string[]): Promise<number> {
  const uniqueResolved = Array.from(
    new Set(paths.filter(Boolean).map((p) => path.resolve(p)))
  ).sort((a, b) => a.length - b.length);

  // Drop child paths whose ancestor is already included
  const topLevelPaths: string[] = [];
  for (const candidate of uniqueResolved) {
    const coveredByParent = topLevelPaths.some((parent) => {
      const rel = path.relative(parent, candidate);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
    if (!coveredByParent) {
      topLevelPaths.push(candidate);
    }
  }

  let total = 0;

  const walk = async (target: string) => {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(target);
    } catch {
      return;
    }

    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      total += stat.size;
      return;
    }
    if (stat.isDirectory()) {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(target, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        await walk(path.join(target, entry.name));
      }
    }
  };

  for (const p of topLevelPaths) {
    await walk(p);
  }

  return total;
}

export function formatMegabytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return "< 0.1 MB";
  return `${mb.toFixed(1)} MB`;
}

function deduplicateExistingPaths(
  candidates: Array<string | null | undefined>
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of candidates) {
    if (!raw || !raw.trim()) continue;
    const resolved = path.resolve(raw);
    if (seen.has(resolved)) continue;
    if (!fs.existsSync(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

export async function buildSwitchUninstallPreview(params: {
  titleId: string;
  title: string;
  appPath: string | null;
  stagingDir: string;
  canonicalDataDir: string;
  appSupportDir: string;
  cachesDir?: string | null;
}): Promise<GameUninstallPreview> {
  const upTid = params.titleId.toUpperCase();
  const lowTid = params.titleId.toLowerCase();
  const normalizedTitle = normalizeAlphaNum(params.title);

  const installPath =
    params.appPath &&
    params.appPath.toLowerCase().endsWith(".app") &&
    fs.existsSync(params.appPath)
      ? path.resolve(params.appPath)
      : null;

  const stagingCandidates: string[] = [];
  if (params.stagingDir && fs.existsSync(params.stagingDir)) {
    try {
      const entries = fs.readdirSync(params.stagingDir, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        const lowerName = entry.name.toLowerCase();
        const alphaName = normalizeAlphaNum(entry.name);
        if (
          (lowTid && lowerName.includes(lowTid)) ||
          (normalizedTitle.length >= 4 && alphaName === normalizedTitle)
        ) {
          stagingCandidates.push(path.join(params.stagingDir, entry.name));
        }
      }
    } catch {
      // ignore unreadable staging root
    }
  }

  for (const baseDir of [params.canonicalDataDir, params.appSupportDir]) {
    if (!baseDir) continue;
    stagingCandidates.push(path.join(baseDir, upTid, "temp"));
    stagingCandidates.push(path.join(baseDir, upTid, "pso_archive"));
  }
  if (params.cachesDir) {
    stagingCandidates.push(path.join(params.cachesDir, upTid));
  }

  const savePaths = deduplicateExistingPaths([
    path.join(params.canonicalDataDir, upTid, "save"),
    path.join(params.appSupportDir, upTid, "save"),
  ]);

  const stagingPaths = deduplicateExistingPaths(stagingCandidates);

  const [installSizeBytes, saveSizeBytes, stagingSizeBytes] = await Promise.all(
    [
      installPath ? computePathsSizeBytes([installPath]) : Promise.resolve(0),
      computePathsSizeBytes(savePaths),
      computePathsSizeBytes(stagingPaths),
    ]
  );

  return {
    kind: "switch",
    canUninstall: Boolean(installPath),
    installPath,
    installSizeBytes,
    uninstallerPath: null,
    uninstallerSource: null,
    savePaths,
    saveSizeBytes,
    stagingPaths,
    stagingSizeBytes,
    bottleName: null,
  };
}

export async function executeSwitchUninstall(
  preview: GameUninstallPreview,
  options: GameUninstallOptions
): Promise<GameUninstallResult> {
  const removedPaths: string[] = [];
  const warnings: string[] = [];

  if (
    preview.installPath &&
    preview.installPath.toLowerCase().endsWith(".app") &&
    isSafeRemovableInstallDir(preview.installPath) &&
    fs.existsSync(preview.installPath)
  ) {
    try {
      await fs.promises.rm(preview.installPath, {
        recursive: true,
        force: true,
      });
      removedPaths.push(preview.installPath);
    } catch (err) {
      warnings.push(
        `Falha ao remover .app (${preview.installPath}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  if (options.deleteStaging) {
    for (const stagingPath of preview.stagingPaths) {
      if (!fs.existsSync(stagingPath)) continue;
      if (!isSafeRemovableInstallDir(stagingPath)) continue;
      try {
        await fs.promises.rm(stagingPath, { recursive: true, force: true });
        removedPaths.push(stagingPath);
      } catch (err) {
        warnings.push(
          `Falha ao remover staging (${stagingPath}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  if (options.deleteSaves) {
    for (const savePath of preview.savePaths) {
      if (!fs.existsSync(savePath)) continue;
      try {
        await fs.promises.rm(savePath, { recursive: true, force: true });
        removedPaths.push(savePath);
      } catch (err) {
        warnings.push(
          `Falha ao remover save (${savePath}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  return {
    ok: removedPaths.length > 0 || warnings.length === 0,
    uninstallerRan: false,
    removedPaths,
    warnings,
  };
}

export class GameUninstallService {
  private static resolveWindowsInstallDir(
    executablePath?: string | null,
    otherExecutablePaths: string[] = []
  ): string | null {
    if (!executablePath || !fs.existsSync(executablePath)) return null;

    const others = otherExecutablePaths
      .filter(Boolean)
      .map((p) => path.resolve(p).toLowerCase());
    const containsOtherGame = (dir: string) => {
      const prefix = path.resolve(dir).toLowerCase() + path.sep;
      return others.some((o) => o.startsWith(prefix));
    };

    let candidate = path.dirname(path.resolve(executablePath));

    for (let step = 0; step < 2; step++) {
      const baseLower = path.basename(candidate).toLowerCase();
      const isEngineSubdir = ENGINE_SUBDIR_NAMES.has(baseLower);

      // The candidate already has its own uninstaller: it is the game root.
      if (
        !isEngineSubdir &&
        findUninstallerInDirectory(candidate, 0) !== null
      ) {
        break;
      }

      const parent = path.dirname(candidate);
      const parentHasDirectUninstaller =
        findUninstallerInDirectory(parent, 0) !== null;

      if (
        (isEngineSubdir || parentHasDirectUninstaller) &&
        isSafeRemovableInstallDir(parent) &&
        !containsOtherGame(parent)
      ) {
        candidate = parent;
        continue;
      }
      break;
    }

    if (containsOtherGame(candidate)) return null;
    return isSafeRemovableInstallDir(candidate) ? candidate : null;
  }

  private static async collectWindowsShortcutPaths(
    bottleDir: string,
    gameTitle: string
  ): Promise<string[]> {
    const normalizedTitle = normalizeAlphaNum(gameTitle);
    if (normalizedTitle.length < 4 || !fs.existsSync(bottleDir)) return [];

    const matches: string[] = [];
    const usersDir = path.join(bottleDir, "drive_c", "users");
    const searchRoots: string[] = [
      path.join(
        bottleDir,
        "drive_c",
        "ProgramData",
        "Microsoft",
        "Windows",
        "Start Menu"
      ),
    ];

    if (fs.existsSync(usersDir)) {
      try {
        for (const u of fs.readdirSync(usersDir, { withFileTypes: true })) {
          if (!u.isDirectory()) continue;
          searchRoots.push(path.join(usersDir, u.name, "Desktop"));
          searchRoots.push(
            path.join(
              usersDir,
              u.name,
              "AppData",
              "Roaming",
              "Microsoft",
              "Windows",
              "Start Menu"
            )
          );
        }
      } catch {
        // ignore
      }
    }

    const walkShortcuts = (dir: string, depth: number) => {
      if (!fs.existsSync(dir)) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < 3) walkShortcuts(fullPath, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();
        if (!lower.endsWith(".lnk") && !lower.endsWith(".url")) continue;
        const stemAlpha = normalizeAlphaNum(path.parse(entry.name).name);
        if (stemAlpha && stemAlpha.includes(normalizedTitle)) {
          matches.push(fullPath);
        }
      }
    };

    for (const root of searchRoots) {
      walkShortcuts(root, 0);
    }

    return matches;
  }

  private static async findWindowsSavePaths(
    game: Game,
    bottleDir: string | null
  ): Promise<string[]> {
    const candidates: string[] = [];

    try {
      const preview = await Ludusavi.previewGame(
        game.shop,
        game.objectId,
        bottleDir
      );
      if (preview) {
        for (const entry of Object.values(preview.games ?? {})) {
          if (!entry?.files) continue;
          for (const [filePath, info] of Object.entries(entry.files)) {
            if (info.change !== "Removed") {
              candidates.push(filePath);
            }
          }
        }
      }
    } catch {
      // non-fatal
    }

    if (candidates.length === 0) {
      try {
        const info = await ICloudSaveService.getGameSaveInfo(
          game.shop,
          game.objectId
        );
        for (const p of info.localSavePaths ?? []) {
          candidates.push(p);
        }
        if (info.customSavePath) {
          candidates.push(info.customSavePath);
        }
      } catch {
        // non-fatal
      }
    }

    return deduplicateExistingPaths(candidates);
  }

  public static async getUninstallPreview(
    shop: GameShop,
    objectId: string
  ): Promise<GameUninstallPreview> {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);

    if (!game) {
      return {
        kind: "generic",
        canUninstall: false,
        installPath: null,
        installSizeBytes: 0,
        uninstallerPath: null,
        uninstallerSource: null,
        savePaths: [],
        saveSizeBytes: 0,
        stagingPaths: [],
        stagingSizeBytes: 0,
        bottleName: null,
      };
    }

    if (shop === "switch1" || shop === "switch2") {
      const [stagingDir, appSupportDir] = await Promise.all([
        NxPathsService.getStagingDirectory(),
        NxPathsService.getAppSupportDirectory(),
      ]);

      return buildSwitchUninstallPreview({
        titleId: game.switchTitleId || objectId,
        title: game.title,
        appPath: game.switchPortedAppPath || game.executablePath || null,
        stagingDir,
        canonicalDataDir:
          NxRuntimeConfigService.getCanonicalMacNxNativeDataDir(),
        appSupportDir,
        cachesDir: NxPathsService.getCachesDirectory(),
      });
    }

    const isRedWine =
      process.platform === "darwin" &&
      (Boolean(game.macOSCompatibility) ||
        Boolean(game.winePrefixPath) ||
        (game.executablePath?.toLowerCase().endsWith(".exe") ?? false) ||
        shop === "custom" ||
        shop === "steam" ||
        shop === "epic");

    const bottleName = isRedWine
      ? game.macOSCompatibility?.bottleName || DEFAULT_BOTTLE_NAME
      : null;

    let bottleDir: string | null = null;
    if (bottleName) {
      const bottlesDir = await CrossOverDetector.getBottlesDirectory().catch(
        () => null
      );
      bottleDir = bottlesDir ? path.join(bottlesDir, bottleName) : null;
    }

    const otherExecutablePaths: string[] = [];
    try {
      for await (const [otherKey, other] of gamesSublevel.iterator()) {
        if (otherKey === levelKeys.game(shop, objectId)) continue;
        if (other?.isDeleted) continue;
        if (other?.executablePath) {
          otherExecutablePaths.push(other.executablePath);
        }
      }
    } catch {
      // non-fatal
    }

    const installPath = this.resolveWindowsInstallDir(
      game.executablePath,
      otherExecutablePaths
    );

    // Only look inside this game's own folder (shallow) and never run more
    // than one uninstaller.
    let uninstallerPath = installPath
      ? findUninstallerInDirectory(installPath, 1)
      : null;
    let uninstallerSource: "directory" | "registry" | null = uninstallerPath
      ? "directory"
      : null;

    if (!uninstallerPath && bottleDir && fs.existsSync(bottleDir)) {
      const systemRegPath = path.join(bottleDir, "system.reg");
      if (fs.existsSync(systemRegPath)) {
        try {
          const regContent = await fs.promises.readFile(systemRegPath, "utf8");
          const regWinExe = parseWineRegistryUninstallString(
            regContent,
            game.title,
            installPath
          );
          if (regWinExe) {
            const posixExe = mapWineWindowsPathToPosix(regWinExe, bottleDir);
            if (posixExe && fs.existsSync(posixExe)) {
              uninstallerPath = posixExe;
              uninstallerSource = "registry";
            }
          }
        } catch {
          // ignore reg read errors
        }
      }
    }

    const savePaths = await this.findWindowsSavePaths(
      game,
      game.winePrefixPath || bottleDir
    );

    const [installSizeBytes, saveSizeBytes] = await Promise.all([
      installPath ? computePathsSizeBytes([installPath]) : Promise.resolve(0),
      computePathsSizeBytes(savePaths),
    ]);

    return {
      kind: isRedWine ? "windows-red-wine" : "generic",
      canUninstall: Boolean(installPath || uninstallerPath),
      installPath,
      installSizeBytes,
      uninstallerPath,
      uninstallerSource,
      savePaths,
      saveSizeBytes,
      stagingPaths: [],
      stagingSizeBytes: 0,
      bottleName,
    };
  }

  public static async uninstallGame(
    shop: GameShop,
    objectId: string,
    options: GameUninstallOptions
  ): Promise<GameUninstallResult> {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    if (!game) {
      return {
        ok: false,
        uninstallerRan: false,
        removedPaths: [],
        warnings: [],
        error: "Jogo não encontrado na biblioteca.",
      };
    }

    const preview = await this.getUninstallPreview(shop, objectId);
    let result: GameUninstallResult;

    if (preview.kind === "switch") {
      result = await executeSwitchUninstall(preview, options);
      AppLogHub.info(
        "nxnative",
        `Desinstalação Switch concluída para "${game.title}" (${result.removedPaths.length} itens removidos).`
      );
    } else {
      const removedPaths: string[] = [];
      const warnings: string[] = [];
      let uninstallerRan = false;

      if (preview.uninstallerPath && fs.existsSync(preview.uninstallerPath)) {
        const runRes = await CrossOverRunner.runCommandAndWait(
          preview.uninstallerPath,
          [],
          {
            bottleName: preview.bottleName || DEFAULT_BOTTLE_NAME,
            timeoutMs: 600_000,
          }
        );
        uninstallerRan = runRes.ok;
        if (!runRes.ok) {
          // Cancelled or failed: do not touch any remaining files.
          return {
            ok: false,
            uninstallerRan: false,
            removedPaths: [],
            warnings: [],
            error: runRes.error
              ? `Desinstalador não concluído (${runRes.error}). Nenhum arquivo foi removido.`
              : "Desinstalador cancelado ou falhou. Nenhum arquivo foi removido.",
          };
        }
      }

      if (
        preview.installPath &&
        fs.existsSync(preview.installPath) &&
        isSafeRemovableInstallDir(preview.installPath)
      ) {
        try {
          // Move leftovers to the macOS Trash instead of deleting permanently.
          await shell.trashItem(preview.installPath);
          removedPaths.push(preview.installPath);
        } catch (err) {
          warnings.push(
            `Falha ao apagar pasta do jogo (${preview.installPath}): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      if (preview.bottleName) {
        try {
          const bottlesDir = await CrossOverDetector.getBottlesDirectory();
          const bottleDir = path.join(bottlesDir, preview.bottleName);
          const shortcuts = await this.collectWindowsShortcutPaths(
            bottleDir,
            game.title
          );
          for (const shortcut of shortcuts) {
            await fs.promises.rm(shortcut, { force: true }).catch(() => {});
            removedPaths.push(shortcut);
          }
        } catch {
          // non-fatal shortcut cleanup
        }
      }

      if (options.deleteSaves) {
        for (const savePath of preview.savePaths) {
          if (!fs.existsSync(savePath)) continue;
          try {
            await fs.promises.rm(savePath, { recursive: true, force: true });
            removedPaths.push(savePath);
          } catch (err) {
            warnings.push(
              `Falha ao remover save (${savePath}): ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      }

      AppLogHub.info(
        "crossover",
        `Desinstalação Windows concluída para "${game.title}" (desinstalador: ${uninstallerRan ? "executado" : "n/a"}, removidos: ${removedPaths.length}).`
      );
      logger.info(
        `[GameUninstall] Uninstalled "${game.title}" (${shop}:${objectId}): ${removedPaths.length} removed paths`
      );

      result = {
        ok: true,
        uninstallerRan,
        removedPaths,
        warnings,
      };
    }

    if (options.removeFromLibrary) {
      await removeLibraryGame(shop, objectId);
    } else {
      await updateGameRecord(gameKey, (curr) => {
        const cleared = updateGameExecutablePath(curr, null);
        return {
          ...cleared,
          switchPortedAppPath: undefined,
          installedSizeInBytes: undefined,
          trackingExecutablePaths: undefined,
          trackingExecutablePathsUpdatedAt: null,
        };
      });
      await downloadsSublevel.del(gameKey).catch(() => {});
    }

    WindowManager.sendToAppWindows("on-nx-library-updated", {
      romsCount: 0,
      portedCount: 0,
    });

    return result;
  }
}
