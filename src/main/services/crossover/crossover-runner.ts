import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Game, MacOSCompatibilityOptions, UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { CrossOverDetector, DEFAULT_BOTTLE_NAME } from "./crossover-detector";
import { CrossOverProvisioner } from "./crossover-provisioner";
import { logger } from "../logger";
import { AppLogHub } from "../app-log-hub";
import { ControllerProfileService } from "../controllers/controller-profile-service";
import { hasTrackedGamesRunning } from "../game-running-state";
import {
  buildInstallerEnvOverrides,
  buildInstallerWineArgs,
  cleanupStaleInnoTempDirs,
  detectRepackInstaller,
  prepareShortInstallerLink,
  removeShortInstallerLink,
  type RepackDetectionResult,
} from "./fitgirl-installer-helpers";

export {
  buildInstallerEnvOverrides,
  buildInstallerWineArgs,
  cleanupStaleInnoTempDirs,
  detectRepackInstaller,
  prepareShortInstallerLink,
  removeShortInstallerLink,
  type RepackDetectionResult,
};

const execFileAsync = promisify(execFile);

/** Flushes an idle bottle wineserver so MSync state does not stick across FitGirl safe mode. */
export async function flushIdleBottleWineserver(
  bottleDir: string,
  bottlesDir: string
): Promise<boolean> {
  if (hasTrackedGamesRunning()) {
    return false;
  }

  const wineserverBin = CrossOverDetector.getBinaryPath("wineserver");
  if (!wineserverBin || !fs.existsSync(wineserverBin)) {
    return false;
  }

  try {
    await execFileAsync(wineserverBin, ["-k"], {
      env: {
        ...(process.env as Record<string, string>),
        WINEPREFIX: bottleDir,
        CX_BOTTLE_PATH: bottlesDir,
      },
      timeout: 8000,
    });
    return true;
  } catch {
    // No active wineserver for this bottle
    return false;
  }
}

const KNOWN_PLAYER_INI_FILES = new Set([
  "steam_emu.ini",
  "tenoke.ini",
  "ds.ini",
  "flt.ini",
  "codex.ini",
  "rune.ini",
  "onlinefix.ini",
  "onlinefix64.ini",
  "ali213.ini",
  "valve.ini",
  "smartsteamemu.ini",
  "cream_api.ini",
  "hlm.ini",
  "skidrow.ini",
  "3dmgame.ini",
  "configs.user.ini",
  "steam_api.ini",
]);

const GENERIC_PARENT_DIRS = new Set([
  "binaries",
  "win64",
  "win32",
  "x64",
  "x86",
  "shipping",
  "retail",
  "bin",
  "game",
]);

export interface CrossOverLaunchOptions {
  executablePath: string;
  args?: string[];
  launchOptions?: string | null;
  compatibility?: MacOSCompatibilityOptions;
  cwd?: string;
  onExit?: (code: number | null) => void;
  waitChildren?: boolean;
}

export class CrossOverRunner {
  public static async prepareLaunchEnvironment(
    compatibility?: MacOSCompatibilityOptions,
    bottleDir?: string
  ): Promise<Record<string, string>> {
    const backend = compatibility?.graphicsBackend ?? "d3dmetal";
    const syncMode = compatibility?.syncMode ?? "msync";
    const metalHud = compatibility?.metalHud ?? false;
    const rosettaAvx = compatibility?.rosettaAvx ?? true;
    const highRes = compatibility?.highResolutionMode ?? false;

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      CX_GRAPHICS_BACKEND: backend,
      D3DM_ENABLE_METALFX: "1",
      D3DM_SUPPORT_DXR: "1",
      DXMT_ENABLE_NVEXT: "1",
      D3DM_MTL4: "1",
    };

    if (bottleDir) {
      env.WINEPREFIX = bottleDir;
    }

    // Backend specifics
    switch (backend) {
      case "d3dmetal":
        env.WINED3DMETAL = "1";
        env.DXVK = "0";
        break;
      case "dxmt":
        env.DXMT = "1";
        env.WINED3DMETAL = "0";
        env.DXVK = "0";
        break;
      case "dxvk":
        env.DXVK = "1";
        env.WINED3DMETAL = "0";
        break;
      case "wined3d":
        env.WINED3DMETAL = "0";
        env.DXVK = "0";
        break;
    }

    // Sync mode
    switch (syncMode) {
      case "msync":
        env.WINEMSYNC = "1";
        env.WINEESYNC = "0";
        break;
      case "esync":
        env.WINEESYNC = "1";
        env.WINEMSYNC = "0";
        break;
      case "none":
        env.WINEMSYNC = "0";
        env.WINEESYNC = "0";
        break;
    }

    // Metal HUD
    if (metalHud) {
      env.MTL_HUD_ENABLED = "1";
    }

    // Rosetta AVX
    if (rosettaAvx) {
      env.ROSETTA_ADVERTISE_AVX = "1";
    }

    // High resolution Retina
    if (highRes) {
      env.WINE_HIGH_DPI = "1";
    }

    // Custom user environment variables
    if (compatibility?.environmentVariables) {
      Object.assign(env, compatibility.environmentVariables);
    }

    return env;
  }

  public static async resolvePlayerName(): Promise<string> {
    try {
      const prefs = await db
        .get<string, UserPreferences | null>(levelKeys.userPreferences, {
          valueEncoding: "json",
        })
        .catch(() => null);
      const customName = prefs?.playerName?.trim();
      if (customName) return customName;
      const osUser = os.userInfo().username?.trim();
      if (osUser) return osUser;
    } catch {
      // ignore
    }
    return "Jogador";
  }

  private static resolveGameScanRoot(executablePath: string): string {
    let dir = path.dirname(executablePath);
    for (let i = 0; i < 2; i++) {
      const base = path.basename(dir).toLowerCase();
      if (GENERIC_PARENT_DIRS.has(base)) {
        const parent = path.dirname(dir);
        if (parent && parent !== dir) {
          dir = parent;
          continue;
        }
      }
      break;
    }
    return dir;
  }

  public static async applyPlayerNameToEnvironmentAndGame(
    playerName: string,
    bottleDir: string,
    gameExecutablePath: string,
    env: Record<string, string>
  ): Promise<void> {
    const cleanName = playerName.trim() || "Jogador";
    env.USERNAME = cleanName;
    env.USER = cleanName;
    env.LOGNAME = cleanName;
    env.STEAM_PLAYER_NAME = cleanName;

    // 1. Update global Goldberg / GSE settings in the bottle
    const globalSettingsDirs = [
      path.join(
        bottleDir,
        "drive_c",
        "users",
        "crossover",
        "AppData",
        "Roaming",
        "Goldberg SteamEmu Saves",
        "settings"
      ),
      path.join(
        bottleDir,
        "drive_c",
        "users",
        "crossover",
        "AppData",
        "Roaming",
        "GSE Saves",
        "settings"
      ),
    ];

    for (const settingsDir of globalSettingsDirs) {
      try {
        await fs.promises.mkdir(settingsDir, { recursive: true });
        await Promise.all([
          fs.promises.writeFile(
            path.join(settingsDir, "account_name.txt"),
            `${cleanName}\n`,
            "utf8"
          ),
          fs.promises.writeFile(
            path.join(settingsDir, "force_account_name.txt"),
            `${cleanName}\n`,
            "utf8"
          ),
        ]);
      } catch {
        // non-fatal
      }
    }

    // 2. Update Wine user.reg LastGameNameUsed under [Software\\Valve\\Steam]
    try {
      const userRegPath = path.join(bottleDir, "user.reg");
      if (fs.existsSync(userRegPath)) {
        const regContent = await fs.promises.readFile(userRegPath, "utf8");
        const escaped = cleanName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        if (regContent.includes('"LastGameNameUsed"=')) {
          const updated = regContent.replace(
            /"LastGameNameUsed"="[^"]*"/g,
            `"LastGameNameUsed"="${escaped}"`
          );
          if (updated !== regContent) {
            await fs.promises.writeFile(userRegPath, updated, "utf8");
          }
        }
      }
    } catch {
      // non-fatal
    }

    // 3. Scan game directory for local INI files and steam_settings folders
    const scanRoot = this.resolveGameScanRoot(gameExecutablePath);
    const updateDirConfigs = async (dir: string, depth: number) => {
      if (depth > 3) return;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const lower = entry.name.toLowerCase();

        if (entry.isDirectory()) {
          if (lower === "steam_settings" || lower === "settings") {
            try {
              const hasSteamMarker =
                lower === "steam_settings" ||
                fs.existsSync(path.join(fullPath, "account_name.txt")) ||
                fs.existsSync(path.join(fullPath, "force_account_name.txt")) ||
                fs.existsSync(path.join(fullPath, "steam_appid.txt")) ||
                fs.existsSync(path.join(fullPath, "configs.user.ini"));
              if (hasSteamMarker) {
                await Promise.all([
                  fs.promises.writeFile(
                    path.join(fullPath, "account_name.txt"),
                    `${cleanName}\n`,
                    "utf8"
                  ),
                  fs.promises.writeFile(
                    path.join(fullPath, "force_account_name.txt"),
                    `${cleanName}\n`,
                    "utf8"
                  ),
                ]);
              }
            } catch {
              // ignore
            }
          }
          if (
            !lower.startsWith(".") &&
            lower !== "redist" &&
            lower !== "_commonredist"
          ) {
            await updateDirConfigs(fullPath, depth + 1);
          }
        } else if (entry.isFile() && KNOWN_PLAYER_INI_FILES.has(lower)) {
          try {
            const raw = await fs.promises.readFile(fullPath, "utf8");
            const updated = raw.replace(
              /^(\s*(?:UserName|AccountName|PlayerName|PersonaName|account_name)\s*=\s*)(.*)$/gim,
              `$1${cleanName}`
            );
            if (updated !== raw) {
              await fs.promises.writeFile(fullPath, updated, "utf8");
              logger.info(
                `[RedWine] Applied player name '${cleanName}' to ${fullPath}`
              );
            }
          } catch {
            // ignore read-only or locked files
          }
        }
      }
    };

    await updateDirConfigs(scanRoot, 0).catch(() => {});
  }

  public static async ensureExternalVolumeDriveMapping(
    posixPath: string,
    bottleDir: string
  ): Promise<void> {
    const absPath = path.resolve(posixPath);
    const volMatch = absPath.match(/^(\/Volumes\/[^/]+)/);
    if (!volMatch?.[1]) return;

    const volumeRoot = volMatch[1];
    const resolvedVolumeRoot = await fs.promises
      .realpath(volumeRoot)
      .catch(() => volumeRoot);
    const dosdevicesDir = path.join(bottleDir, "dosdevices");

    try {
      await fs.promises.mkdir(dosdevicesDir, { recursive: true });
      const entries = await fs.promises.readdir(dosdevicesDir);
      const existingSet = new Set(entries.map((entry) => entry.toLowerCase()));

      for (const entry of entries) {
        if (!/^[a-z]:$/i.test(entry)) continue;
        const linkPath = path.join(dosdevicesDir, entry);
        try {
          const target = await fs.promises.realpath(linkPath);
          if (target === resolvedVolumeRoot || target === volumeRoot) {
            return;
          }
        } catch {
          // Ignore broken symlinks
        }
      }

      const candidateLetters = [
        "d",
        "e",
        "f",
        "g",
        "h",
        "i",
        "j",
        "k",
        "l",
        "m",
        "n",
        "o",
        "p",
        "q",
        "r",
        "s",
        "t",
        "u",
        "v",
        "w",
        "x",
      ];
      const freeLetter = candidateLetters.find(
        (letter) => !existingSet.has(`${letter}:`)
      );
      if (!freeLetter) return;

      await fs.promises.symlink(
        volumeRoot,
        path.join(dosdevicesDir, `${freeLetter}:`)
      );
      logger.info(
        `[RedWine] Mapped external volume ${volumeRoot} -> ${freeLetter.toUpperCase()}:`
      );
    } catch (error) {
      logger.warn("[RedWine] Failed to map external volume drive", error);
    }
  }

  public static async toWineWindowsPath(
    posixPath: string,
    bottleDir: string
  ): Promise<string> {
    if (/^[a-zA-Z]:[/\\]/.test(posixPath)) {
      return posixPath.replace(/\//g, "\\");
    }

    await this.ensureExternalVolumeDriveMapping(posixPath, bottleDir);

    const absPath = path.resolve(posixPath);
    const driveC = path.join(bottleDir, "drive_c");
    const relDriveC = path.relative(driveC, absPath);

    // 1. Inside bottle's drive_c -> C:\...
    if (!relDriveC.startsWith("..") && !path.isAbsolute(relDriveC)) {
      return relDriveC ? `C:\\${relDriveC.split(path.sep).join("\\")}` : "C:\\";
    }

    // 2. Check dosdevices symlinks (excluding Z:), longest target prefix first
    const dosdevicesDir = path.join(bottleDir, "dosdevices");
    if (fs.existsSync(dosdevicesDir)) {
      try {
        const entries = await fs.promises.readdir(dosdevicesDir);
        const mappedMounts: Array<{ driveLetter: string; target: string }> = [];

        for (const entry of entries) {
          if (entry.length !== 2 || !/^[a-z]:$/i.test(entry)) continue;
          const driveLetter = entry.slice(0, 1).toUpperCase();
          if (driveLetter === "Z") continue;

          const linkPath = path.join(dosdevicesDir, entry);
          try {
            const target = await fs.promises.realpath(linkPath);
            mappedMounts.push({ driveLetter, target });
          } catch {
            // Ignore broken link
          }
        }

        mappedMounts.sort((a, b) => b.target.length - a.target.length);

        for (const { driveLetter, target } of mappedMounts) {
          const relTarget = path.relative(target, absPath);
          if (!relTarget.startsWith("..") && !path.isAbsolute(relTarget)) {
            return relTarget
              ? `${driveLetter}:\\${relTarget.split(path.sep).join("\\")}`
              : `${driveLetter}:\\`;
          }
        }
      } catch {
        // Ignore read error
      }
    }

    // 3. Fallback: Z: drive maps to root / in Wine
    return `Z:\\${absPath.replace(/^\/+/, "").split(path.sep).join("\\")}`;
  }

  public static async launchGame(
    game: Game,
    launchOptionsString?: string | null,
    extra?: {
      args?: string[];
      env?: Record<string, string>;
      onExit?: (code: number | null) => void;
    }
  ): Promise<number | null> {
    if (!game.executablePath) {
      throw new Error(`Game '${game.title}' has no executable path set`);
    }

    const appPath = CrossOverDetector.findCrossOverApp();
    if (!appPath) {
      throw new Error(
        "Red Wine is not installed. Please set it up in Compatibility options."
      );
    }

    // 1. Run automatic Red Reset before launching
    await CrossOverProvisioner.resetTrial().catch((err) => {
      logger.warn("[RedWine] Pre-launch Red Reset notice", err);
    });

    // 2. Unified single bottle: Head Bottle
    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    const bottleName = DEFAULT_BOTTLE_NAME;

    await CrossOverProvisioner.ensureBottle(bottleName).catch((err) => {
      logger.warn(`[RedWine] Bottle ensure warning for '${bottleName}'`, err);
    });

    const bottleDir = path.join(bottlesDir, bottleName);
    const wineBin = CrossOverDetector.getBinaryPath("wine");
    if (!wineBin) {
      throw new Error("Red Wine binary not found");
    }

    const env = await this.prepareLaunchEnvironment(
      game.macOSCompatibility,
      bottleDir
    );
    env.CX_BOTTLE_PATH = bottlesDir;

    // Apply Launcher Player Name to Wine environment, bottle registry, and game Steam emulator configs
    try {
      const playerName = await this.resolvePlayerName();
      await this.applyPlayerNameToEnvironmentAndGame(
        playerName,
        bottleDir,
        game.executablePath,
        env
      );
    } catch {
      // non-fatal
    }

    // Inject active/per-game controller remapping profile for Windows games via Red Wine
    try {
      const controllerEnv =
        await ControllerProfileService.buildCrossOverControllerEnv({
          controllerProfileId: game.controllerProfileId,
          playerProfileIds: game.playerProfileIds,
        });
      Object.assign(env, controllerEnv);
    } catch {
      // non-fatal
    }

    const workingDir = path.dirname(game.executablePath);
    const windowsWorkingDir = await this.toWineWindowsPath(
      workingDir,
      bottleDir
    );
    const windowsPath = await this.toWineWindowsPath(
      game.executablePath,
      bottleDir
    );

    // Custom/extra env (e.g. Epic launch env) without logging secret tokens
    if (extra?.env) {
      Object.assign(env, extra.env);
    }

    const args: string[] = [
      "--bottle",
      bottleName,
      "--workdir",
      windowsWorkingDir,
      "--wait-children",
      "--cx-app",
      windowsPath,
    ];

    // Append extra store args before logging args
    if (extra?.args?.length) {
      args.push(...extra.args);
    }

    // Append launch options
    const rawOptions = (launchOptionsString || game.launchOptions || "").trim();
    if (rawOptions) {
      args.push(...rawOptions.split(/\s+/));
    }

    logger.info(
      `[RedWine] Launching game in bottle '${bottleName}': ${game.executablePath} -> ${windowsPath}`
    );

    const proc = spawn(wineBin, args, {
      cwd: workingDir,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (extra?.onExit) {
      proc.once("close", (code) => extra.onExit?.(code));
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        logger.info(`[RedWine:${bottleName}] ${text}`);
        AppLogHub.info("crossover", `[${bottleName}] ${text}`);
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        logger.warn(`[RedWine:${bottleName}] ${text}`);
        AppLogHub.warn("crossover", `[${bottleName}] ${text}`);
      }
    });

    proc.on("error", (error) => {
      logger.error(`[RedWine] Failed to launch game '${game.title}'`, error);
    });

    proc.unref();

    const pid = proc.pid ?? null;
    return pid;
  }

  public static async launchControlPanelTool(
    tool: "winecfg" | "joy" | "reboot" | "taskmgr" | "inetcpl"
  ): Promise<{ success: boolean; error?: string }> {
    const commands: Record<string, string[]> = {
      winecfg: ["winecfg"],
      joy: ["control", "joy.cpl"],
      reboot: ["wineboot", "-r"],
      taskmgr: ["taskmgr"],
      inetcpl: ["control", "inetcpl.cpl"],
    };
    const command = commands[tool];
    if (!command) return { success: false, error: "Unknown tool" };

    try {
      const wineBin = CrossOverDetector.getBinaryPath("wine");
      if (!wineBin) throw new Error("Red Wine is not installed");

      const bottlesDir = await CrossOverDetector.getBottlesDirectory();
      const bottleName = DEFAULT_BOTTLE_NAME;
      await CrossOverProvisioner.ensureBottle(bottleName);
      const bottleDir = path.join(bottlesDir, bottleName);

      const env = await this.prepareLaunchEnvironment(undefined, bottleDir);
      env.CX_BOTTLE_PATH = bottlesDir;

      const proc = spawn(
        wineBin,
        ["--bottle", bottleName, "--cx-app", ...command],
        { env, stdio: "ignore", detached: true }
      );
      proc.on("error", (err) =>
        logger.warn(`[RedWine] Control panel tool '${tool}' failed`, err)
      );
      proc.unref();
      AppLogHub.step("crossover", `Painel de Controle: ${command.join(" ")}`);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public static async executeInstaller(options: {
    installerPath: string;
    bottleName?: string;
    extraArgs?: string[];
    compatibility?: MacOSCompatibilityOptions;
    onExit?: (code: number | null) => void;
  }): Promise<{ spawned: boolean; pid?: number }> {
    const appPath = CrossOverDetector.findCrossOverApp();
    if (!appPath) {
      throw new Error("Red Wine is not installed");
    }

    await CrossOverProvisioner.resetTrial().catch((err) => {
      logger.warn("[RedWine] Pre-installer Red Reset notice", err);
    });

    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    const bottleName = DEFAULT_BOTTLE_NAME;

    await CrossOverProvisioner.ensureBottle(bottleName).catch((err) => {
      logger.warn(`[RedWine] Bottle ensure warning for '${bottleName}'`, err);
    });

    const bottleDir = path.join(bottlesDir, bottleName);
    const wineBin = CrossOverDetector.getBinaryPath("wine");
    if (!wineBin) {
      throw new Error("Red Wine binary not found");
    }

    const repackInfo = detectRepackInstaller(options.installerPath);
    const isRepack = repackInfo.isRepack;

    if (isRepack) {
      const cleaned = cleanupStaleInnoTempDirs(bottleDir);
      if (cleaned > 0) {
        logger.info(
          `[RedWine] Removed ${cleaned} stale Inno Setup temp folder(s) before repack install`
        );
      }
      await flushIdleBottleWineserver(bottleDir, bottlesDir);
    }

    const envOverrides = buildInstallerEnvOverrides(isRepack);
    const env = await this.prepareLaunchEnvironment(
      options.compatibility,
      bottleDir
    );
    env.CX_BOTTLE_PATH = bottlesDir;
    Object.assign(env, envOverrides);
    if (isRepack) {
      delete env.ROSETTA_ADVERTISE_AVX;
    }

    const workingDir = path.dirname(options.installerPath);
    const installerFileName = path.basename(options.installerPath);

    let windowsWorkingDir = await this.toWineWindowsPath(workingDir, bottleDir);
    let windowsPath = await this.toWineWindowsPath(
      options.installerPath,
      bottleDir
    );
    let shortLinkPath: string | null = null;

    if (isRepack) {
      const shortLink = prepareShortInstallerLink(
        bottleDir,
        workingDir,
        installerFileName
      );
      if (shortLink.linkPath) {
        shortLinkPath = shortLink.linkPath;
        windowsWorkingDir = shortLink.windowsWorkingDir;
        windowsPath = shortLink.windowsPath;
      }
    }

    const ext = path.extname(options.installerPath).toLowerCase();
    const args = buildInstallerWineArgs({
      bottleName,
      windowsWorkingDir,
      windowsPath,
      ext,
      isRepack,
      extraArgs: options.extraArgs,
      envOverrides,
    });

    if (isRepack) {
      const tag = repackInfo.isFitGirl
        ? "FitGirl Safe Mode"
        : "Repack Safe Mode";
      logger.info(
        `[RedWine] ${tag} active (${repackInfo.reason}): MSync/D3DMetal/AVX disabled, --winver win7, 4 CPU threads, short path ${windowsPath}`
      );
      AppLogHub.step(
        "crossover",
        `${tag} ativado: MSync/D3DMetal/AVX desativados, Windows 7 e caminho curto (${windowsPath}). Se o instalador FitGirl oferecer "Limit installer to 2GB RAM", marque essa opção.`
      );
    }

    logger.info(
      `[RedWine] Executing installer in bottle '${bottleName}': ${options.installerPath} -> ${windowsPath} (workdir: ${windowsWorkingDir})`
    );
    AppLogHub.step(
      "crossover",
      `Iniciando instalador na ${bottleName} (Default): ${installerFileName}`
    );

    const proc: ChildProcess = spawn(wineBin, args, {
      cwd: workingDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        logger.info(`[RedWine:${bottleName}] ${text}`);
        AppLogHub.info("crossover", `[${bottleName}] ${text}`);
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        logger.warn(`[RedWine:${bottleName}] ${text}`);
        AppLogHub.warn("crossover", `[${bottleName}] ${text}`);
      }
    });

    let exitFired = false;
    const safeExit = (code: number | null) => {
      if (exitFired) return;
      exitFired = true;
      removeShortInstallerLink(shortLinkPath);
      if (isRepack) {
        void flushIdleBottleWineserver(bottleDir, bottlesDir);
      }
      options.onExit?.(code);
    };
    proc.once("close", safeExit);
    proc.once("exit", safeExit);

    return {
      spawned: true,
      pid: proc.pid,
    };
  }

  public static async runCommandAndWait(
    executablePath: string,
    extraArgs: string[] = [],
    options?: {
      bottleName?: string;
      timeoutMs?: number;
    }
  ): Promise<{ ok: boolean; exitCode: number | null; error?: string }> {
    const appPath = CrossOverDetector.findCrossOverApp();
    if (!appPath) {
      return {
        ok: false,
        exitCode: null,
        error: "Red Wine is not installed",
      };
    }

    const wineBin = CrossOverDetector.getBinaryPath("wine");
    if (!wineBin) {
      return {
        ok: false,
        exitCode: null,
        error: "Red Wine binary not found",
      };
    }

    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    const bottleName = options?.bottleName || DEFAULT_BOTTLE_NAME;
    await CrossOverProvisioner.ensureBottle(bottleName).catch((err) => {
      logger.warn(`[RedWine] Bottle ensure warning for '${bottleName}'`, err);
    });
    const bottleDir = path.join(bottlesDir, bottleName);

    const env = await this.prepareLaunchEnvironment(undefined, bottleDir);
    env.CX_BOTTLE_PATH = bottlesDir;

    const workingDir = path.dirname(executablePath);
    const windowsWorkingDir = await this.toWineWindowsPath(
      workingDir,
      bottleDir
    );
    const windowsPath = await this.toWineWindowsPath(executablePath, bottleDir);

    const args = [
      "--bottle",
      bottleName,
      "--workdir",
      windowsWorkingDir,
      "--wait-children",
      "--cx-app",
      windowsPath,
      ...extraArgs,
    ];

    const timeoutMs = options?.timeoutMs ?? 600_000;
    logger.info(
      `[RedWine] Running command and waiting in '${bottleName}': ${executablePath}`
    );
    AppLogHub.step(
      "crossover",
      `Executando ${path.basename(executablePath)} em ${bottleName}...`
    );

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (res: {
        ok: boolean;
        exitCode: number | null;
        error?: string;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      };

      const proc: ChildProcess = spawn(wineBin, args, {
        cwd: workingDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        try {
          proc.kill("SIGTERM");
        } catch {
          // ignore
        }
        finish({
          ok: false,
          exitCode: null,
          error: `Timeout running ${path.basename(executablePath)}`,
        });
      }, timeoutMs);

      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) AppLogHub.info("crossover", `[${bottleName}] ${text}`);
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) AppLogHub.warn("crossover", `[${bottleName}] ${text}`);
      });

      proc.once("close", (code) => {
        finish({
          ok: code === 0 || code === null,
          exitCode: code,
          ...(code !== null && code !== 0
            ? { error: `Exited with code ${code}` }
            : {}),
        });
      });
      proc.once("error", (err) => {
        finish({
          ok: false,
          exitCode: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }
}
