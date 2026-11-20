import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import type {
  Game,
  NxGameModItem,
  NxGamePreset,
  NxGameRuntimeConfig,
  UserPreferences,
} from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { updateGameRecord } from "@main/services/game-record-updater";
import { AppLogHub } from "@main/services/app-log-hub";
import { ControllerProfileService } from "@main/services/controllers/controller-profile-service";
import { NxPathsService } from "./nx-paths";
import { NxScannerService } from "./nx-scanner-service";

const NXN_MAGIC_HEADER = Buffer.from([
  0x4e, 0x58, 0x4e, 0x5f, 0x50, 0x52, 0x45, 0x53, 0x45, 0x54, 0x01, 0x00,
]); // "NXN_PRESET\x01\x00"

const KNOWN_ROMFS_DIRS = new Set([
  "actor",
  "anim",
  "animation",
  "audio",
  "bg",
  "bootup",
  "camera",
  "common",
  "data",
  "effect",
  "event",
  "font",
  "font2",
  "gamedata",
  "layout",
  "map",
  "message",
  "model",
  "movie",
  "nav",
  "pack",
  "param",
  "particles",
  "physics",
  "player",
  "region",
  "resource",
  "scene",
  "sound",
  "stage",
  "stream",
  "system",
  "terrain",
  "text",
  "texture",
  "ui",
  "voice",
]);

const KNOWN_ASSET_EXTS = new Set([
  ".zs",
  ".blarc",
  ".bntx",
  ".bfotf",
  ".sarc",
  ".bars",
  ".bfres",
  ".bwav",
  ".pack",
  ".szs",
  ".arc",
]);

const BASE_MANAGED_ENV_KEYS = new Set([
  "DM_FPS_TARGET",
  "DM_METAL_HUD",
  "DM_OPMODE",
  "DM_RENDER_SCALE",
  "DM_PRESENT_UPSCALE",
  "DM_FULLSCREEN",
  "DM_ENABLE_GAMEPAD_PROFILE",
  "DM_DISABLE_GAMEPAD_REMAP",
  "DM_LAUNCHER",
  "DM_CONTROLLER_PROFILE_ID",
  "DM_LANG",
  "DM_ROMFS_OVERLAY",
  "DM_FRAMEGEN",
  "DM_FRAMEGEN_MAXK",
  "DM_PRESENT_LINK",
  "DM_SLOWFRAME",
  "DM_SCREEN_MATCH",
]);

const OOT_MANAGED_ENV_KEYS = new Set([
  "DM_UPSCALER",
  "DM_SHARPEN",
  "DM_FIXED_RESOLUTION",
  "DM_DYNAMIC_RESOLUTION",
  "DM_FIXED_SCALE",
  "DM_GFX_SCALE",
  "DM_MIC",
  "DM_OOT_MOTION_BLUR",
  "DM_NVN_COND_CONSERVATIVE",
  "DM_TEX_RELEASE",
  "DM_FPS_HOLD",
  "DM_THERMAL_CAP",
  "DM_RT",
  "DM_NVN_RT_LOSSY",
  "DM_NVN_POOL_SKIP_RETIRED",
  "DM_GUEST_FILE",
  "DM_GUEST_FILE_CHUNK",
  "DM_RES_PRESET",
]);

export function createDefaultRuntimeConfig(isOot = false): NxGameRuntimeConfig {
  const ramGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  const default16GB = ramGB <= 16;
  return {
    enable60FPS: true,
    enableMetalHUD: false,
    isDockedMode: true,
    renderScale: 1.0,
    enableMetalFXUpscale: false,
    enableGameMode: true,
    enableGamepadProfile: true,
    controllerProfileId: null,
    playerProfileIds: null,
    gameLanguage: null,
    ootUpscalerMode: "off",
    ootSharpen: 0.25,
    ootFixedResolution: true,
    ootFixedScale: 1.0,
    ootGfxScaleTier: 0,
    ootMicrophone: true,
    oot16GBRamMode: isOot ? default16GB : false,
    ootResolutionPreset: "normal",
    ootExperimentalFrameGen: false,
    ootFrameGenMaxK: 4,
    ootMotionBlur: true,
  };
}

export class NxRuntimeConfigService {
  public static getCanonicalMacNxNativeDataDir(
    homeDir = os.homedir()
  ): string {
    return path.join(homeDir, "Library", "Application Support", "nxnative");
  }

  public static getCanonicalMacNxNativeLogsDir(
    homeDir = os.homedir()
  ): string {
    return path.join(homeDir, "Library", "Logs", "nxnative");
  }

  public static isOotGame(titleId?: string | null, title?: string): boolean {
    if (titleId?.toUpperCase() === "0400486024DEC000") return true;
    if (title?.toLowerCase().includes("ocarina")) return true;
    return false;
  }

  public static async loadRuntimeConfig(
    shop: "switch1" | "switch2",
    objectId: string
  ): Promise<NxGameRuntimeConfig> {
    const gameKey = levelKeys.game(shop, objectId);
    let game: Game | null = null;
    try {
      game = (await gamesSublevel.get(gameKey)) ?? null;
    } catch {
      game = null;
    }

    const titleId = game?.switchTitleId || objectId;
    const isOot = this.isOotGame(titleId, game?.title);

    if (game?.switchRuntimeConfig) {
      return {
        ...createDefaultRuntimeConfig(isOot),
        ...game.switchRuntimeConfig,
      };
    }

    // Try reading existing env.txt from canonical macOS AppSupport first, then configured AppSupport, then .app bundle
    const canonicalDir = this.getCanonicalMacNxNativeDataDir();
    const appSupport = await NxPathsService.getAppSupportDirectory();
    const candidates = Array.from(
      new Set(
        [
          path.join(canonicalDir, titleId.toUpperCase(), "env.txt"),
          path.join(appSupport, titleId.toUpperCase(), "env.txt"),
          path.join(
            NxPathsService.getDefaultAppSupportDirectory(),
            titleId.toUpperCase(),
            "env.txt"
          ),
          game?.switchPortedAppPath
            ? path.join(
                game.switchPortedAppPath,
                "Contents",
                "Resources",
                "dm",
                "env.txt"
              )
            : "",
        ].filter(Boolean)
      )
    );

    for (const file of candidates) {
      if (fs.existsSync(file)) {
        return this.parseEnvContent(fs.readFileSync(file, "utf8"), isOot);
      }
    }

    const def = createDefaultRuntimeConfig(isOot);
    if (game?.switchPortedAppPath) {
      const langs = NxScannerService.getSupportedLanguages(
        game.switchPortedAppPath
      );
      def.gameLanguage = langs.defaultLanguage;
    }
    return def;
  }

  public static parseEnvContent(
    text: string,
    isOot = false
  ): NxGameRuntimeConfig {
    const cfg = createDefaultRuntimeConfig(isOot);
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();

      switch (key) {
        case "DM_FPS_TARGET":
          cfg.enable60FPS = val === "60";
          break;
        case "DM_METAL_HUD":
          cfg.enableMetalHUD = val === "1";
          break;
        case "DM_OPMODE":
          cfg.isDockedMode = val !== "0";
          break;
        case "DM_RENDER_SCALE": {
          const n = Number.parseFloat(val);
          if (Number.isFinite(n) && n >= 0.5 && n <= 1.0) cfg.renderScale = n;
          break;
        }
        case "DM_PRESENT_UPSCALE":
          cfg.enableMetalFXUpscale =
            val.toLowerCase() === "metalfx" || val === "1";
          break;
        case "DM_FULLSCREEN":
          cfg.enableGameMode = val !== "0";
          break;
        case "DM_ENABLE_GAMEPAD_PROFILE":
          cfg.enableGamepadProfile = val !== "0";
          break;
        case "DM_DISABLE_GAMEPAD_REMAP":
          cfg.enableGamepadProfile = val !== "1";
          break;
        case "DM_CONTROLLER_PROFILE_ID":
          cfg.controllerProfileId = val || null;
          break;
        case "DM_LANG":
          cfg.gameLanguage = val || null;
          break;
        case "DM_FRAMEGEN":
          cfg.ootExperimentalFrameGen = val === "1";
          break;
        case "DM_FRAMEGEN_MAXK": {
          const k = Number.parseInt(val, 10);
          if (k === 2 || k === 4) cfg.ootFrameGenMaxK = k;
          break;
        }
        case "DM_UPSCALER":
          if (val === "off" || val === "metalfx" || val === "game") {
            cfg.ootUpscalerMode = val;
          }
          break;
        case "DM_SHARPEN": {
          const s = Number.parseFloat(val);
          if (Number.isFinite(s) && s >= 0 && s <= 1) cfg.ootSharpen = s;
          break;
        }
        case "DM_FIXED_RESOLUTION":
          cfg.ootFixedResolution = val === "1";
          break;
        case "DM_GFX_SCALE": {
          const t = Number.parseInt(val, 10);
          if (t === 0 || t === 1 || t === 2) cfg.ootGfxScaleTier = t;
          break;
        }
        case "DM_MIC":
          cfg.ootMicrophone = val === "1";
          break;
        case "DM_OOT_MOTION_BLUR":
          cfg.ootMotionBlur = val !== "0";
          break;
        case "DM_RES_PRESET":
          cfg.ootResolutionPreset = val === "1" ? "potato" : "normal";
          break;
        case "DM_GUEST_FILE":
          if (val === "1") cfg.oot16GBRamMode = true;
          break;
      }
    }
    return cfg;
  }

  public static buildEnvEntries(
    config: NxGameRuntimeConfig,
    options: {
      titleId?: string | null;
      appPath?: string | null;
      isOot: boolean;
      supports120Hz: boolean;
      overlayString?: string | null;
      savePath?: string | null;
      saveSyncPath?: string | null;
    }
  ): Record<string, string> {
    const use120HzLink = config.enable60FPS && options.supports120Hz;
    const clampedMaxK = config.ootFrameGenMaxK === 2 ? 2 : 4;

    const dict: Record<string, string> = {
      DM_FPS_TARGET: config.enable60FPS ? "60" : "30",
      DM_METAL_HUD: config.enableMetalHUD ? "1" : "0",
      DM_OPMODE: config.isDockedMode ? "1" : "0",
      DM_RENDER_SCALE: config.renderScale.toFixed(2),
      DM_PRESENT_UPSCALE: config.enableMetalFXUpscale ? "metalfx" : "off",
      DM_FULLSCREEN: config.enableGameMode ? "1" : "0",
      DM_ENABLE_GAMEPAD_PROFILE: config.enableGamepadProfile ? "1" : "0",
      DM_DISABLE_GAMEPAD_REMAP: config.enableGamepadProfile ? "0" : "1",
      DM_LAUNCHER: "0",
    };

    if (config.controllerProfileId) {
      dict.DM_CONTROLLER_PROFILE_ID = config.controllerProfileId;
    }
    if (config.gameLanguage?.trim()) {
      dict.DM_LANG = config.gameLanguage.trim();
    }

    if (options.isOot) {
      if (config.ootExperimentalFrameGen) {
        dict.DM_FRAMEGEN = "1";
        dict.DM_SLOWFRAME = "1";
        if (use120HzLink) {
          dict.DM_FRAMEGEN_MAXK = String(clampedMaxK);
          dict.DM_PRESENT_LINK = "2";
          dict.DM_SCREEN_MATCH = "0";
        } else {
          dict.DM_FRAMEGEN_MAXK = "2";
          dict.DM_PRESENT_LINK = "1";
          dict.DM_SCREEN_MATCH = "1";
        }
      } else {
        dict.DM_FRAMEGEN = "0";
        dict.DM_SLOWFRAME = "0";
        dict.DM_SCREEN_MATCH = "1";
      }
    }

    if (options.overlayString) {
      dict.DM_ROMFS_OVERLAY = options.overlayString;
    }
    if (options.savePath) {
      dict.DM_SAVE = options.savePath;
    }
    if (options.saveSyncPath) {
      dict.DM_SAVE_SYNC = options.saveSyncPath;
    }

    if (options.isOot) {
      dict.DM_UPSCALER = config.ootUpscalerMode;
      dict.DM_SHARPEN = config.ootSharpen.toFixed(2);
      dict.DM_FIXED_RESOLUTION = config.ootFixedResolution ? "1" : "0";
      dict.DM_DYNAMIC_RESOLUTION = config.ootFixedResolution ? "0" : "1";
      dict.DM_FIXED_SCALE = config.ootFixedScale.toFixed(2);
      dict.DM_GFX_SCALE = String(config.ootGfxScaleTier);
      dict.DM_MIC = config.ootMicrophone ? "1" : "0";
      dict.DM_OOT_MOTION_BLUR = config.ootMotionBlur ? "1" : "0";
      dict.DM_NVN_COND_CONSERVATIVE = "1";
      dict.DM_FPS_HOLD = "off";
      dict.DM_THERMAL_CAP = "0";
      dict.DM_RT = "0";
      dict.DM_NVN_RT_LOSSY = "1";
      dict.DM_NVN_POOL_SKIP_RETIRED = "1";
      dict.DM_TEX_RELEASE = "0";
      dict.DM_RES_PRESET = config.ootResolutionPreset === "potato" ? "1" : "0";

      const freeTmp = NxPathsService.getDiskFreeBytes(os.tmpdir());
      const useGuestFile =
        config.oot16GBRamMode && freeTmp >= 12 * 1024 * 1024 * 1024;
      dict.DM_GUEST_FILE = useGuestFile ? "1" : "0";
      if (useGuestFile) dict.DM_GUEST_FILE_CHUNK = "1G";
    }

    return dict;
  }

  private static isCloudDocsPath(value: string): boolean {
    const normalized = value.toLowerCase();
    return (
      normalized.includes("clouddocs") ||
      normalized.includes("mobile documents")
    );
  }

  public static mergeEnvFileText(
    existing: string | null,
    entries: Record<string, string>,
    isOot: boolean
  ): string {
    const frameGenEnabled = entries.DM_FRAMEGEN === "1";
    const preserved: string[] = [];
    if (existing) {
      for (const rawLine of existing.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        const key = (eqIdx >= 0 ? trimmed.slice(0, eqIdx) : trimmed).trim();
        const val = eqIdx >= 0 ? trimmed.slice(eqIdx + 1).trim() : "";

        // Never allow CloudDocs / iCloud paths in DM_SAVE, DM_PSO_ARCHIVE or DM_PSO_USER
        // because dmhost mmaps Metal PSO archives relative to dirname(DM_SAVE).
        if (
          (key === "DM_SAVE" ||
            key === "DM_PSO_ARCHIVE" ||
            key === "DM_PSO_USER") &&
          this.isCloudDocsPath(val)
        ) {
          continue;
        }

        // Prevent stale framegen/present-link overrides when framegen is off or not OoT
        if (
          (!isOot || !frameGenEnabled) &&
          (key === "DM_FRAMEGEN_MAXK" || key === "DM_PRESENT_LINK")
        ) {
          continue;
        }

        const isManaged =
          BASE_MANAGED_ENV_KEYS.has(key) ||
          (isOot && OOT_MANAGED_ENV_KEYS.has(key)) ||
          (!isOot &&
            (key === "DM_RES_PRESET" || key === "DM_UPSCALER")) ||
          key in entries;
        if (isManaged) continue;

        if (key === "DM_TEX_RELEASE" && (val === "1" || val === "2")) {
          preserved.push("DM_TEX_RELEASE=0");
          continue;
        }

        preserved.push(trimmed);
      }
    }

    const lines = ["# nxnative runtime configuration (Cerberus.app)"];
    for (const [k, v] of Object.entries(entries)) {
      lines.push(`${k}=${v}`);
    }
    for (const p of preserved) lines.push(p);
    return `${lines.join("\n")}\n`;
  }

  public static async saveRuntimeConfig(
    shop: "switch1" | "switch2",
    objectId: string,
    config: NxGameRuntimeConfig
  ): Promise<NxGameRuntimeConfig> {
    const gameKey = levelKeys.game(shop, objectId);
    let game: Game | null = null;
    try {
      game = (await gamesSublevel.get(gameKey)) ?? null;
    } catch {
      game = null;
    }

    if (game) {
      await updateGameRecord(gameKey, (curr) => ({
        ...curr,
        switchRuntimeConfig: config,
        controllerProfileId: config.controllerProfileId,
        playerProfileIds: config.playerProfileIds,
      }));
    }

    const titleId = (game?.switchTitleId || objectId).toUpperCase();
    const appPath = game?.switchPortedAppPath || game?.executablePath || null;
    const isOot = this.isOotGame(titleId, game?.title);
    const hw = NxPathsService.getHardwareInfo();
    const overlayString = await this.buildRomfsOverlayString(titleId, appPath);

    const envEntries = this.buildEnvEntries(config, {
      titleId,
      appPath,
      isOot,
      supports120Hz: hw.supports120Hz,
      overlayString,
    });

    // 1. Write env.txt to AppSupport/<TID> (canonical macOS AppSupport, configured, and default AppSupport)
    const appSupportDirs = Array.from(
      new Set([
        this.getCanonicalMacNxNativeDataDir(),
        await NxPathsService.getAppSupportDirectory(),
        NxPathsService.getDefaultAppSupportDirectory(),
      ])
    );

    for (const baseDir of appSupportDirs) {
      for (const tidVariant of new Set([titleId, titleId.toLowerCase()])) {
        const dir = path.join(baseDir, tidVariant);
        fs.mkdirSync(dir, { recursive: true });
        const envFile = path.join(dir, "env.txt");
        const existing = fs.existsSync(envFile)
          ? fs.readFileSync(envFile, "utf8")
          : null;
        fs.writeFileSync(
          envFile,
          this.mergeEnvFileText(existing, envEntries, isOot),
          "utf8"
        );
      }
    }

    // 2. Write env.txt & input_mapping.json & Info.plist into .app bundle if ported
    if (appPath && fs.existsSync(appPath)) {
      const dmDir = path.join(appPath, "Contents", "Resources", "dm");
      if (fs.existsSync(dmDir)) {
        const bundleEnv = path.join(dmDir, "env.txt");
        const existing = fs.existsSync(bundleEnv)
          ? fs.readFileSync(bundleEnv, "utf8")
          : null;
        fs.writeFileSync(
          bundleEnv,
          this.mergeEnvFileText(existing, envEntries, isOot),
          "utf8"
        );
      }

      await ControllerProfileService.exportMappingForApp(appPath, {
        enableGamepadProfile: config.enableGamepadProfile,
        controllerProfileId: config.controllerProfileId,
        playerProfileIds: config.playerProfileIds,
      });

      this.syncAppInfoPlist(
        appPath,
        config.enableGameMode,
        config.gameLanguage
      );
    }

    return config;
  }

  private static syncAppInfoPlist(
    appPath: string,
    enableGameMode: boolean,
    gameLanguage: string | null
  ): void {
    const plistPath = path.join(appPath, "Contents", "Info.plist");
    if (!fs.existsSync(plistPath)) return;
    try {
      let currentGameMode: boolean | undefined;
      try {
        const raw = execFileSync(
          "/usr/bin/plutil",
          ["-convert", "json", "-o", "-", plistPath],
          { encoding: "utf8", timeout: 3000 }
        );
        const parsedBefore = JSON.parse(raw) as {
          LSSupportsGameMode?: boolean;
        };
        currentGameMode = parsedBefore.LSSupportsGameMode;
      } catch {
        currentGameMode = undefined;
      }

      const gameModeChanged = currentGameMode !== enableGameMode;
      if (gameModeChanged) {
        execFileSync(
          "/usr/bin/plutil",
          [
            "-replace",
            "LSSupportsGameMode",
            "-bool",
            enableGameMode ? "YES" : "NO",
            plistPath,
          ],
          { timeout: 3000 }
        );

        const lsregisterCandidates = [
          "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
          "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister",
        ];
        const lsregister = lsregisterCandidates.find((p) => fs.existsSync(p));
        if (lsregister) {
          try {
            execFileSync(lsregister, ["-f", appPath], { timeout: 3000 });
          } catch {
            // non-fatal
          }
        }
      }

      if (gameLanguage?.trim()) {
        execFileSync(
          "/usr/bin/plutil",
          ["-replace", "DMLanguage", "-string", gameLanguage.trim(), plistPath],
          { timeout: 3000 }
        );
        const rawJson = execFileSync(
          "/usr/bin/plutil",
          ["-convert", "json", "-o", "-", plistPath],
          { encoding: "utf8", timeout: 3000 }
        );
        const parsed = JSON.parse(rawJson) as { CFBundleIdentifier?: string };
        if (parsed.CFBundleIdentifier) {
          execFileSync(
            "/usr/bin/defaults",
            [
              "write",
              parsed.CFBundleIdentifier,
              "launcher.DM_LANG",
              gameLanguage.trim(),
            ],
            { timeout: 3000 }
          );
        }
      }
    } catch {
      // non-fatal
    }
  }

  private static prepareAppBundleForLaunch(appPath: string): void {
    try {
      execFileSync("/usr/bin/xattr", ["-d", "com.apple.quarantine", appPath], {
        timeout: 2000,
      });
    } catch {
      // attribute may not exist
    }

    const macosDir = path.join(appPath, "Contents", "MacOS");
    if (fs.existsSync(macosDir)) {
      try {
        execFileSync("/usr/bin/xattr", ["-cr", macosDir], { timeout: 2000 });
      } catch {
        // non-fatal
      }

      try {
        for (const entry of fs.readdirSync(macosDir)) {
          const binPath = path.join(macosDir, entry);
          const stat = fs.statSync(binPath);
          if (!stat.isFile()) continue;
          try {
            fs.chmodSync(binPath, 0o755);
          } catch {
            // ignore
          }
          try {
            execFileSync(
              "/usr/bin/codesign",
              ["--force", "--sign", "-", binPath],
              { timeout: 2000 }
            );
          } catch {
            // non-fatal
          }
        }
      } catch {
        // non-fatal
      }
    }

    // Remove stale bundle-level _CodeSignature after updating Info.plist/env.txt/input_mapping.json
    const codeSigDir = path.join(appPath, "Contents", "_CodeSignature");
    if (fs.existsSync(codeSigDir)) {
      try {
        fs.rmSync(codeSigDir, { recursive: true, force: true });
      } catch {
        // non-fatal
      }
    }
  }

  private static async probeRunningAppPid(
    appPath: string
  ): Promise<number | null> {
    const pattern = path.join(appPath, "Contents", "MacOS") + "/";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { stdout } = await execFileAsync(
          "/usr/bin/pgrep",
          ["-f", pattern],
          { timeout: 1500 }
        );
        const firstPid = stdout
          .split(/\r?\n/)
          .map((line) => Number.parseInt(line.trim(), 10))
          .find((pid) => Number.isFinite(pid) && pid > 0);
        if (firstPid) return firstPid;
      } catch {
        // process may still be spawning
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return null;
  }

  // --- Launch Native Switch Port (.app) ---

  public static buildSwitchLaunchEnv(options: {
    titleId: string;
    appPath: string;
    isSwitch2: boolean;
    isOot: boolean;
    supports120Hz: boolean;
    config: NxGameRuntimeConfig;
    profile: {
      enableRumble: boolean;
      rumbleStrength: number;
      rumbleFloorBoost: boolean;
      mouseSensitivity: number;
      mouseInvertX: boolean;
      mouseInvertY: boolean;
      mouseRightStickMode: string;
      mouseSwitch2Enabled: boolean;
      mouseSwitch2PointerSpeed: number;
      mouseSwitch2LockCursor: boolean;
      mouseSwitch2PrimaryButton: string;
      mouseSwitch2Side: string;
      mouseSwitch2InvertY: boolean;
      mouseAsRightStick: boolean;
    };
    canonicalDataDir: string;
    appSupportDir: string;
    logsDir: string;
    tmpDir?: string;
    overlayString?: string | null;
    bundleMappingPath?: string | null;
    icloudSyncRoot?: string | null;
    hostEnv?: {
      HOME?: string;
      USER?: string;
      PATH?: string;
    };
  }): Record<string, string> {
    const upTitleId = options.titleId.toUpperCase();
    const canonicalGameDir = path.join(options.canonicalDataDir, upTitleId);
    const localSaveDir = path.join(canonicalGameDir, "save");
    const psoArchiveDir = path.join(canonicalGameDir, "pso_archive");
    const psoUserFile = path.join(canonicalGameDir, "pso_user.tsv");

    const systemTmp = os.tmpdir();
    const requestedTmp = options.tmpDir?.trim() || "";
    const safeTmpDir =
      !requestedTmp || requestedTmp.startsWith("/Volumes/")
        ? systemTmp.startsWith("/Volumes/")
          ? "/tmp"
          : systemTmp
        : requestedTmp;

    const envVars = this.buildEnvEntries(options.config, {
      titleId: upTitleId,
      appPath: options.appPath,
      isOot: options.isOot,
      supports120Hz: options.supports120Hz,
      overlayString: options.overlayString,
      savePath: localSaveDir,
      saveSyncPath: options.icloudSyncRoot || undefined,
    });

    const prof = options.profile;
    const launchEnv: Record<string, string> = {
      ...envVars,
      HOME:
        options.hostEnv?.HOME || process.env.HOME || os.homedir(),
      USER:
        options.hostEnv?.USER ||
        process.env.USER ||
        (() => {
          try {
            return os.userInfo().username;
          } catch {
            return "user";
          }
        })(),
      PATH:
        options.hostEnv?.PATH ||
        process.env.PATH ||
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      NXNATIVE_DATA_DIR: options.appSupportDir,
      NXNATIVE_LOGS_DIR: options.logsDir,
      DM_SAVE: localSaveDir,
      DM_PSO_ARCHIVE: psoArchiveDir,
      DM_PSO_USER: psoUserFile,
      TMPDIR: safeTmpDir,
      DM_LAUNCHER: "0",
      DM_RUMBLE: prof.enableRumble ? "1" : "0",
      DM_RUMBLE_GAIN: prof.rumbleStrength.toFixed(2),
      DM_RUMBLE_FLOOR: prof.rumbleFloorBoost ? "0.22" : "0.0",
      DM_MOUSE_SENSITIVITY: prof.mouseSensitivity.toFixed(2),
      DM_MOUSE_INVERT_X: prof.mouseInvertX ? "1" : "0",
      DM_MOUSE_INVERT_Y: prof.mouseInvertY ? "1" : "0",
      DM_MOUSE_MODE: prof.mouseRightStickMode,
    };

    if (options.bundleMappingPath) {
      launchEnv.DM_INPUT_MAPPING = options.bundleMappingPath;
    }
    if (!options.config.enableGamepadProfile) {
      launchEnv.DM_DISABLE_GAMEPAD_REMAP = "1";
    }

    if (options.isSwitch2) {
      launchEnv.DM_SWITCH2_MOUSE = prof.mouseSwitch2Enabled ? "1" : "0";
      launchEnv.DM_SWITCH2_MOUSE_SPEED =
        prof.mouseSwitch2PointerSpeed.toFixed(2);
      launchEnv.DM_SWITCH2_LOCK_CURSOR = prof.mouseSwitch2LockCursor
        ? "1"
        : "0";
      launchEnv.DM_SWITCH2_SWAP_BTNS =
        prof.mouseSwitch2PrimaryButton === "right" ? "1" : "0";
      launchEnv.DM_SWITCH2_SIDE = prof.mouseSwitch2Side;
      launchEnv.DM_SWITCH2_INVERT_Y = prof.mouseSwitch2InvertY ? "1" : "0";
      launchEnv.DM_MOUSE_RIGHT_STICK =
        !prof.mouseSwitch2Enabled && prof.mouseAsRightStick ? "1" : "0";
    } else {
      launchEnv.DM_SWITCH2_MOUSE = "0";
      launchEnv.DM_MOUSE_RIGHT_STICK = prof.mouseAsRightStick ? "1" : "0";
    }

    return launchEnv;
  }

  public static async launchSwitchGame(
    shop: "switch1" | "switch2",
    objectId: string
  ): Promise<{ ok: boolean; pid?: number | null; error?: string }> {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    const appPath = game?.switchPortedAppPath || game?.executablePath;
    if (
      !appPath ||
      !appPath.toLowerCase().endsWith(".app") ||
      !fs.existsSync(appPath)
    ) {
      return {
        ok: false,
        error: "Jogo ainda não portado. Clique em 'Portar Jogo' primeiro.",
      };
    }

    const config = await this.loadRuntimeConfig(shop, objectId);
    await this.saveRuntimeConfig(shop, objectId, config);

    this.prepareAppBundleForLaunch(appPath);

    const titleId = (game?.switchTitleId || objectId).toUpperCase();
    const isSwitch2 =
      shop === "switch2" ||
      game?.switchGeneration === "switch2" ||
      titleId.startsWith("0400");
    const isOot = this.isOotGame(titleId, game?.title);
    const hw = NxPathsService.getHardwareInfo();
    const overlayString = await this.buildRomfsOverlayString(titleId, appPath);
    const icloudActive = await this.isGameICloudSyncEnabled(titleId);

    const canonicalDataDir = this.getCanonicalMacNxNativeDataDir();
    const canonicalGameDir = path.join(canonicalDataDir, titleId);
    const localSaveDir = path.join(canonicalGameDir, "save");
    const psoArchiveDir = path.join(canonicalGameDir, "pso_archive");
    const tempDir = path.join(canonicalGameDir, "temp");
    fs.mkdirSync(localSaveDir, { recursive: true });
    fs.mkdirSync(psoArchiveDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });

    const appSupportDir = await NxPathsService.getAppSupportDirectory();
    if (appSupportDir !== canonicalDataDir) {
      const legacySaveDir = path.join(appSupportDir, titleId, "save");
      try {
        if (
          fs.existsSync(legacySaveDir) &&
          fs.readdirSync(localSaveDir).length === 0
        ) {
          fs.cpSync(legacySaveDir, localSaveDir, {
            recursive: true,
            force: false,
          });
        }
      } catch {
        // non-fatal
      }
    }

    if (icloudActive) {
      const cloudSaveDir = path.join(
        NxPathsService.getICloudRootDirectory(),
        titleId,
        "save"
      );
      try {
        if (
          fs.existsSync(cloudSaveDir) &&
          fs.readdirSync(localSaveDir).length === 0
        ) {
          fs.cpSync(cloudSaveDir, localSaveDir, {
            recursive: true,
            force: false,
          });
        }
      } catch {
        // non-fatal
      }
    }

    const logsDir = this.getCanonicalMacNxNativeLogsDir();
    fs.mkdirSync(logsDir, { recursive: true });

    const controllerState = await ControllerProfileService.getState();
    const prof = ControllerProfileService.resolveProfileForSlot(
      controllerState,
      0,
      {
        controllerProfileId: config.controllerProfileId,
        playerProfileIds: config.playerProfileIds,
      }
    );

    const bundleMappingPath = path.join(
      appPath,
      "Contents",
      "Resources",
      "dm",
      "input_mapping.json"
    );

    const launchEnv = this.buildSwitchLaunchEnv({
      titleId,
      appPath,
      isSwitch2,
      isOot,
      supports120Hz: hw.supports120Hz,
      config,
      profile: prof,
      canonicalDataDir,
      appSupportDir,
      logsDir,
      tmpDir: os.tmpdir(),
      overlayString,
      bundleMappingPath: fs.existsSync(bundleMappingPath)
        ? bundleMappingPath
        : null,
      icloudSyncRoot: icloudActive
        ? NxPathsService.getICloudRootDirectory()
        : null,
    });

    const gameLogPath = path.join(logsDir, `${titleId}.log`);
    AppLogHub.info(
      "nxnative",
      `Env de inicialização (${titleId}): DM_SAVE="${launchEnv.DM_SAVE}", DM_PSO_ARCHIVE="${launchEnv.DM_PSO_ARCHIVE}", TMPDIR="${launchEnv.TMPDIR}", DM_OPMODE=${launchEnv.DM_OPMODE}, DM_FPS_TARGET=${launchEnv.DM_FPS_TARGET}${launchEnv.DM_SAVE_SYNC ? `, DM_SAVE_SYNC="${launchEnv.DM_SAVE_SYNC}"` : ""}, log="${gameLogPath}"`
    );

    AppLogHub.step(
      "nxnative",
      `Iniciando jogo Switch "${game?.title || objectId}" via LaunchServices (${appPath})`
    );

    const openArgs = [
      "-a",
      appPath,
      ...Object.entries(launchEnv).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
    ];

    try {
      await execFileAsync("/usr/bin/open", openArgs, { timeout: 10_000 });
    } catch (error) {
      const errObj = error as { stderr?: string; message?: string };
      const message =
        errObj?.stderr?.trim() ||
        errObj?.message ||
        "Falha ao abrir o aplicativo via LaunchServices.";
      AppLogHub.error(
        "nxnative",
        `Falha ao iniciar "${game?.title || objectId}": ${message}`
      );
      return { ok: false, error: message };
    }

    const trackingExecutablePaths = [
      path.join(appPath, "Contents", "MacOS", "nxnative"),
      path.join(appPath, "Contents", "MacOS", "dmhost"),
    ].filter((bin) => fs.existsSync(bin));

    const pid = await this.probeRunningAppPid(appPath);

    await updateGameRecord(gameKey, (curr) => ({
      ...curr,
      lastTimePlayed: new Date(),
      ...(trackingExecutablePaths.length > 0
        ? { trackingExecutablePaths }
        : {}),
    }));

    AppLogHub.success(
      "nxnative",
      `Jogo Switch "${game?.title || objectId}" iniciado${pid ? ` (PID ${pid})` : ""}.`
    );

    return { ok: true, pid };
  }

  // --- Encrypted .nxn Presets (100% compatible with NxNative_Launcher GamePresetService.swift) ---

  private static derivePresetKey(): Buffer {
    const ikm = Buffer.from("NxNative_NxN_Preset_Secret_Key_2026", "utf8");
    const salt = Buffer.from("NxNative_Preset_v1_Salt", "utf8");
    const info = Buffer.from("NxNative_Preset_Payload_AES256GCM", "utf8");
    return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, 32));
  }

  public static encryptNxnPreset(
    preset: NxGamePreset,
    gameName?: string
  ): Buffer {
    const meta = {
      presetName: preset.name,
      titleId: preset.titleId || undefined,
      gameName: gameName || undefined,
      appVersion: "2.3.0",
      createdAt: Date.now() / 1000,
      notes: preset.notes || undefined,
    };
    const metaBuf = Buffer.from(JSON.stringify(meta), "utf8");
    const metaLenBuf = Buffer.alloc(4);
    metaLenBuf.writeUInt32BE(metaBuf.length, 0);

    const payloadBuf = Buffer.from(JSON.stringify(preset.config), "utf8");
    const key = this.derivePresetKey();
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    const encrypted = Buffer.concat([
      cipher.update(payloadBuf),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    // CryptoKit AES.GCM.SealedBox.combined = nonce (12) + ciphertext + tag (16)
    return Buffer.concat([
      NXN_MAGIC_HEADER,
      metaLenBuf,
      metaBuf,
      nonce,
      encrypted,
      tag,
    ]);
  }

  public static decryptNxnPreset(data: Buffer): {
    name: string;
    titleId: string | null;
    notes?: string;
    config: NxGameRuntimeConfig;
  } {
    if (data.length < NXN_MAGIC_HEADER.length + 4 + 29) {
      throw new Error("Cabeçalho .nxn inválido ou corrompido.");
    }
    if (!data.subarray(0, NXN_MAGIC_HEADER.length).equals(NXN_MAGIC_HEADER)) {
      throw new Error("Assinatura mágica .nxn inválida.");
    }
    const metaLen = data.readUInt32BE(NXN_MAGIC_HEADER.length);
    const metaStart = NXN_MAGIC_HEADER.length + 4;
    const metaEnd = metaStart + metaLen;
    if (metaEnd >= data.length) {
      throw new Error("Metadados .nxn inválidos.");
    }

    const meta = JSON.parse(
      data.subarray(metaStart, metaEnd).toString("utf8")
    ) as {
      presetName?: string;
      titleId?: string;
      notes?: string;
    };

    const combined = data.subarray(metaEnd);
    const nonce = combined.subarray(0, 12);
    const tag = combined.subarray(combined.length - 16);
    const ciphertext = combined.subarray(12, combined.length - 16);

    const key = this.derivePresetKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const parsedConfig = JSON.parse(
      decrypted.toString("utf8")
    ) as Partial<NxGameRuntimeConfig>;

    const isOot = this.isOotGame(meta.titleId, undefined);
    return {
      name: meta.presetName || "Preset Importado",
      titleId: meta.titleId || null,
      notes: meta.notes,
      config: { ...createDefaultRuntimeConfig(isOot), ...parsedConfig },
    };
  }

  public static getBuiltInPresets(
    titleId: string,
    gameTitle?: string
  ): NxGamePreset[] {
    const isOot = this.isOotGame(titleId, gameTitle);
    const now = new Date().toISOString();

    if (isOot) {
      return [
        {
          id: "builtin_oot_720p60",
          name: "720p/60fps (Smooth 60)",
          titleId,
          isBuiltIn: true,
          createdAt: now,
          notes:
            "Portátil 720p + MetalFX (Sharpen 1.0) + 2x FrameGen (base 30 FPS), Tier 2 GFX Scale, Modo 16GB RAM.",
          config: {
            ...createDefaultRuntimeConfig(true),
            enable60FPS: false,
            isDockedMode: false,
            ootUpscalerMode: "metalfx",
            ootSharpen: 1.0,
            ootGfxScaleTier: 2,
            oot16GBRamMode: true,
            ootExperimentalFrameGen: true,
            ootFrameGenMaxK: 2,
          },
        },
        {
          id: "builtin_oot_1080p60",
          name: "1080p/60fps (Smooth 60)",
          titleId,
          isBuiltIn: true,
          createdAt: now,
          notes:
            "Dock 1080p + MetalFX (Sharpen 1.0) + 2x FrameGen (base 30 FPS), Tier 2 GFX Scale.",
          config: {
            ...createDefaultRuntimeConfig(true),
            enable60FPS: false,
            isDockedMode: true,
            ootUpscalerMode: "metalfx",
            ootSharpen: 1.0,
            ootGfxScaleTier: 2,
            oot16GBRamMode: true,
            ootExperimentalFrameGen: true,
            ootFrameGenMaxK: 2,
          },
        },
        {
          id: "builtin_oot_default",
          name: "Padrão Recomendado",
          titleId,
          isBuiltIn: true,
          createdAt: now,
          notes: "Perfil nativo 1:1 aprimorado para Zelda OoT.",
          config: createDefaultRuntimeConfig(true),
        },
      ];
    }

    return [
      {
        id: "builtin_default_60",
        name: "Padrão Recomendado (60 FPS)",
        titleId,
        isBuiltIn: true,
        createdAt: now,
        notes: "Perfil balanceado 1080p Dock a 60 FPS.",
        config: createDefaultRuntimeConfig(false),
      },
      {
        id: "builtin_perf_720",
        name: "Alto Desempenho (720p / 60 FPS)",
        titleId,
        isBuiltIn: true,
        createdAt: now,
        notes: "Modo Portátil 720p para máxima estabilidade de quadros.",
        config: { ...createDefaultRuntimeConfig(false), isDockedMode: false },
      },
      {
        id: "builtin_battery_30",
        name: "Economia de Bateria (30 FPS)",
        titleId,
        isBuiltIn: true,
        createdAt: now,
        notes: "30 FPS travados em modo Portátil com escala 85%.",
        config: {
          ...createDefaultRuntimeConfig(false),
          enable60FPS: false,
          isDockedMode: false,
          renderScale: 0.85,
        },
      },
      {
        id: "builtin_promotion_120",
        name: "Smooth ProMotion (Framegen 120 FPS)",
        titleId,
        isBuiltIn: true,
        createdAt: now,
        notes:
          "60 FPS dobrados para 120 FPS via Metal Framegen em telas ProMotion.",
        config: {
          ...createDefaultRuntimeConfig(false),
          ootExperimentalFrameGen: true,
          ootFrameGenMaxK: 4,
        },
      },
    ];
  }

  public static async listPresets(
    titleId: string,
    gameTitle?: string
  ): Promise<NxGamePreset[]> {
    const builtIn = this.getBuiltInPresets(titleId, gameTitle);
    const appSupport = await NxPathsService.getAppSupportDirectory();
    const dir = path.join(appSupport, "presets", titleId.toUpperCase());
    if (!fs.existsSync(dir)) return builtIn;

    const userPresets: NxGamePreset[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.toLowerCase().endsWith(".nxn")) continue;
      try {
        const data = fs.readFileSync(path.join(dir, file));
        const decoded = this.decryptNxnPreset(data);
        userPresets.push({
          id: `user_${file}`,
          name: decoded.name,
          titleId: decoded.titleId || titleId,
          isBuiltIn: false,
          config: decoded.config,
          createdAt: new Date().toISOString(),
          notes: decoded.notes,
        });
      } catch {
        // skip unreadable preset
      }
    }

    return [
      ...builtIn,
      ...userPresets.sort((a, b) => a.name.localeCompare(b.name)),
    ];
  }

  public static async saveCustomPreset(
    titleId: string,
    name: string,
    config: NxGameRuntimeConfig,
    gameTitle?: string
  ): Promise<NxGamePreset> {
    const cleanName = name.replace(/\.nxn$/i, "").trim();
    const appSupport = await NxPathsService.getAppSupportDirectory();
    const dir = path.join(appSupport, "presets", titleId.toUpperCase());
    fs.mkdirSync(dir, { recursive: true });

    const safeFile = `${cleanName.replace(/[/\\?%*:|"<>]/g, "_")}.nxn`;
    const preset: NxGamePreset = {
      id: `user_${safeFile}`,
      name: cleanName,
      titleId: titleId.toUpperCase(),
      isBuiltIn: false,
      config,
      createdAt: new Date().toISOString(),
    };
    const encrypted = this.encryptNxnPreset(preset, gameTitle);
    fs.writeFileSync(path.join(dir, safeFile), encrypted);
    return preset;
  }

  public static async deleteCustomPreset(
    titleId: string,
    presetName: string
  ): Promise<boolean> {
    const appSupport = await NxPathsService.getAppSupportDirectory();
    const cleanName = presetName.replace(/\.nxn$/i, "").trim();
    const safeFile = `${cleanName.replace(/[/\\?%*:|"<>]/g, "_")}.nxn`;
    const target = path.join(
      appSupport,
      "presets",
      titleId.toUpperCase(),
      safeFile
    );
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
      return true;
    }
    return false;
  }

  public static async exportPresetToFile(
    preset: NxGamePreset,
    destPath: string,
    gameTitle?: string
  ): Promise<string> {
    const finalPath = destPath.toLowerCase().endsWith(".nxn")
      ? destPath
      : `${destPath}.nxn`;
    fs.writeFileSync(finalPath, this.encryptNxnPreset(preset, gameTitle));
    return finalPath;
  }

  public static async importPresetFromFile(
    titleId: string,
    filePath: string,
    gameTitle?: string
  ): Promise<NxGamePreset> {
    const decoded = this.decryptNxnPreset(fs.readFileSync(filePath));
    return this.saveCustomPreset(
      titleId,
      decoded.name,
      decoded.config,
      gameTitle
    );
  }

  // --- LayeredFS Mods ---

  public static async getModsDirectory(titleId: string): Promise<string> {
    const appSupport = await NxPathsService.getAppSupportDirectory();
    const dir = path.join(appSupport, titleId.toUpperCase(), "mods");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private static findRomfsFolder(
    dir: string,
    titleId: string,
    depth = 0
  ): string | null {
    if (depth > 2 || !fs.existsSync(dir)) return null;
    const up = titleId.toUpperCase();
    const lo = titleId.toLowerCase();

    const directCandidates = [
      path.join(dir, "romfs"),
      path.join(dir, "atmosphere", "contents", up, "romfs"),
      path.join(dir, "atmosphere", "contents", lo, "romfs"),
      path.join(dir, "contents", up, "romfs"),
      path.join(dir, "contents", lo, "romfs"),
    ];
    for (const c of directCandidates) {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(dir).filter((e) => !e.startsWith("."));
    } catch {
      return null;
    }

    const hasKnownDir = entries.some((e) =>
      KNOWN_ROMFS_DIRS.has(e.toLowerCase())
    );
    const hasAssetExt = entries.some((e) =>
      KNOWN_ASSET_EXTS.has(path.extname(e).toLowerCase())
    );
    const codeOnly =
      entries.length > 0 &&
      entries.every((e) =>
        ["exefs", "patches", "main.npdm", "subsdk"].includes(e.toLowerCase())
      );
    if ((hasKnownDir || hasAssetExt) && !codeOnly) return dir;

    for (const entry of entries) {
      const child = path.join(dir, entry);
      if (fs.existsSync(child) && fs.statSync(child).isDirectory()) {
        const found = this.findRomfsFolder(child, titleId, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  private static hasExefsFolder(dir: string, titleId: string): boolean {
    const up = titleId.toUpperCase();
    const lo = titleId.toLowerCase();
    const candidates = [
      path.join(dir, "exefs"),
      path.join(dir, "atmosphere", "contents", up, "exefs"),
      path.join(dir, "atmosphere", "contents", lo, "exefs"),
      path.join(dir, "contents", up, "exefs"),
      path.join(dir, "contents", lo, "exefs"),
      path.join(dir, "patches"),
    ];
    return candidates.some(
      (c) => fs.existsSync(c) && fs.statSync(c).isDirectory()
    );
  }

  public static async discoverMods(
    titleId: string,
    appPath?: string | null
  ): Promise<NxGameModItem[]> {
    const up = titleId.toUpperCase();
    const lo = titleId.toLowerCase();
    const primary = await this.getModsDirectory(up);
    const home = os.homedir();
    const searchDirs = Array.from(
      new Set(
        [
          primary,
          path.join(home, "Documents", "games", up, "mods"),
          path.join(home, "Documents", "games", lo, "mods"),
          path.join(
            home,
            "Library",
            "Application Support",
            "nxnative",
            up,
            "mods"
          ),
          appPath ? path.join(appPath, "Contents", "Resources", "mods") : "",
        ].filter(Boolean)
      )
    );

    const results: NxGameModItem[] = [];
    const seen = new Set<string>();

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const rawName of fs.readdirSync(dir)) {
        if (rawName.startsWith(".")) continue;
        const full = path.join(dir, rawName);
        if (!fs.statSync(full).isDirectory()) continue;

        const isDisabled = rawName.endsWith(".disabled");
        const cleanId = isDisabled ? rawName.slice(0, -9) : rawName;
        if (seen.has(cleanId)) continue;
        seen.add(cleanId);

        const resolvedRomfsPath = this.findRomfsFolder(full, up);
        const hasCodePatches = this.hasExefsFolder(full, up);
        results.push({
          id: cleanId,
          name: cleanId.replace(/_/g, " "),
          folderPath: full,
          isEnabled: !isDisabled,
          hasCodePatches,
          hasAssetPatches: Boolean(resolvedRomfsPath),
          resolvedRomfsPath,
        });
      }
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  public static async buildRomfsOverlayString(
    titleId: string,
    appPath?: string | null
  ): Promise<string | null> {
    const mods = await this.discoverMods(titleId, appPath);
    const paths: string[] = [];
    for (const mod of mods) {
      if (mod.isEnabled && mod.resolvedRomfsPath) {
        const p = path.resolve(mod.resolvedRomfsPath);
        if (!paths.includes(p)) paths.push(p);
      }
    }
    if (appPath) {
      const bundleOverlay = path.join(
        appPath,
        "Contents",
        "Resources",
        "romfs_overlay"
      );
      if (
        fs.existsSync(bundleOverlay) &&
        fs.statSync(bundleOverlay).isDirectory()
      ) {
        const p = path.resolve(bundleOverlay);
        if (!paths.includes(p)) paths.push(p);
      }
    }
    return paths.length > 0 ? paths.join(":") : null;
  }

  public static async installMod(
    titleId: string,
    sourcePath: string
  ): Promise<NxGameModItem[]> {
    const targetParent = await this.getModsDirectory(titleId);
    const ext = path.extname(sourcePath).toLowerCase();
    const baseName = path.basename(sourcePath, ext).trim().replace(/\//g, "-");
    const destDir = path.join(targetParent, baseName);

    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }

    if (ext === ".zip") {
      fs.mkdirSync(destDir, { recursive: true });
      execFileSync("/usr/bin/unzip", ["-q", "-o", sourcePath, "-d", destDir], {
        timeout: 15000,
      });
    } else if (fs.statSync(sourcePath).isDirectory()) {
      fs.cpSync(sourcePath, destDir, { recursive: true });
    } else {
      throw new Error("Selecione um arquivo .zip ou uma pasta de mod válida.");
    }

    AppLogHub.success(
      "nxnative",
      `Mod "${baseName}" instalado para ${titleId}.`
    );
    return this.discoverMods(titleId);
  }

  public static async toggleMod(
    titleId: string,
    folderPath: string
  ): Promise<NxGameModItem[]> {
    const parent = path.dirname(folderPath);
    const name = path.basename(folderPath);
    const isDisabled = name.endsWith(".disabled");
    const nextName = isDisabled ? name.slice(0, -9) : `${name}.disabled`;
    fs.renameSync(folderPath, path.join(parent, nextName));
    return this.discoverMods(titleId);
  }

  public static async deleteMod(
    titleId: string,
    folderPath: string
  ): Promise<NxGameModItem[]> {
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
    }
    return this.discoverMods(titleId);
  }

  // --- iCloud Save Sync ---

  public static async getSaveDirectory(titleId: string): Promise<string> {
    const appSupport = await NxPathsService.getAppSupportDirectory();
    const dir = path.join(appSupport, titleId.toUpperCase(), "save");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  public static async isGameICloudSyncEnabled(
    titleId: string
  ): Promise<boolean> {
    if (!NxPathsService.isICloudDriveAvailable()) return false;
    const up = titleId.toUpperCase();
    const cloudSaveDir = path.join(
      NxPathsService.getICloudRootDirectory(),
      up,
      "save"
    );
    const appSupport = await NxPathsService.getAppSupportDirectory();
    const candidateEnvFiles = Array.from(
      new Set([
        path.join(this.getCanonicalMacNxNativeDataDir(), up, "env.txt"),
        path.join(appSupport, up, "env.txt"),
        path.join(NxPathsService.getDefaultAppSupportDirectory(), up, "env.txt"),
      ])
    );

    let sawAnyEnv = false;
    for (const envFile of candidateEnvFiles) {
      if (!fs.existsSync(envFile)) continue;
      sawAnyEnv = true;
      const content = fs.readFileSync(envFile, "utf8");
      if (content.includes("DM_SAVE_SYNC=") && content.includes("CloudDocs")) {
        return true;
      }
    }
    if (sawAnyEnv) return false;
    return fs.existsSync(cloudSaveDir);
  }

  private static rewriteEnvSaveEntries(
    envFile: string,
    localSave: string,
    cloudRoot: string | null
  ): void {
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    const existing = fs.existsSync(envFile)
      ? fs.readFileSync(envFile, "utf8")
      : "";
    const filtered = existing
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((trimmed) => {
        if (!trimmed) return false;
        const eqIdx = trimmed.indexOf("=");
        const key = (eqIdx >= 0 ? trimmed.slice(0, eqIdx) : trimmed).trim();
        const val = eqIdx >= 0 ? trimmed.slice(eqIdx + 1).trim() : "";
        if (
          (key === "DM_SAVE" ||
            key === "DM_PSO_ARCHIVE" ||
            key === "DM_PSO_USER") &&
          this.isCloudDocsPath(val)
        ) {
          return false;
        }
        if (key === "DM_SAVE" || key === "DM_SAVE_SYNC") return false;
        return true;
      });
    // DM_SAVE must always stay local APFS so dmhost Metal PSO archives never land on CloudDocs.
    filtered.push(`DM_SAVE=${localSave}`);
    if (cloudRoot) {
      filtered.push(`DM_SAVE_SYNC=${cloudRoot}`);
    }
    fs.writeFileSync(envFile, `${filtered.join("\n")}\n`, "utf8");
  }

  public static async setGameICloudSync(
    titleId: string,
    enabled: boolean
  ): Promise<{ ok: boolean; enabled: boolean; error?: string }> {
    const up = titleId.toUpperCase();
    const canonicalDir = this.getCanonicalMacNxNativeDataDir();
    const appSupport = await NxPathsService.getAppSupportDirectory();
    const localSave = path.join(canonicalDir, up, "save");
    const cloudRoot = NxPathsService.getICloudRootDirectory();
    const cloudSave = path.join(cloudRoot, up, "save");

    const envFiles = Array.from(
      new Set([
        path.join(canonicalDir, up, "env.txt"),
        path.join(appSupport, up, "env.txt"),
        path.join(NxPathsService.getDefaultAppSupportDirectory(), up, "env.txt"),
      ])
    );

    if (enabled) {
      if (!NxPathsService.isICloudDriveAvailable()) {
        return {
          ok: false,
          enabled: false,
          error: "iCloud Drive não está disponível neste Mac.",
        };
      }
      try {
        fs.mkdirSync(localSave, { recursive: true });
        fs.mkdirSync(cloudSave, { recursive: true });
        if (fs.existsSync(localSave) && !fs.lstatSync(localSave).isSymbolicLink()) {
          if (fs.readdirSync(localSave).length > 0) {
            fs.cpSync(localSave, cloudSave, { recursive: true, force: true });
          } else if (fs.existsSync(cloudSave)) {
            fs.cpSync(cloudSave, localSave, { recursive: true, force: false });
          }
        }

        for (const envFile of envFiles) {
          this.rewriteEnvSaveEntries(envFile, localSave, cloudRoot);
        }

        // Ensure global preference reflects enabled
        try {
          const prefs = (await db.get<string, UserPreferences>(
            levelKeys.userPreferences,
            { valueEncoding: "json" }
          )) as UserPreferences;
          if (!prefs?.nxICloudSyncEnabled) {
            await db.put(
              levelKeys.userPreferences,
              { ...(prefs || {}), nxICloudSyncEnabled: true },
              { valueEncoding: "json" }
            );
          }
        } catch {
          // ignore
        }

        AppLogHub.success(
          "nxnative",
          `Sincronização iCloud ativada para ${up} (save local em APFS + sync CloudDocs).`
        );
        return { ok: true, enabled: true };
      } catch (err) {
        return {
          ok: false,
          enabled: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      try {
        fs.mkdirSync(localSave, { recursive: true });
        if (fs.existsSync(cloudSave)) {
          fs.cpSync(cloudSave, localSave, { recursive: true, force: true });
        }
        for (const envFile of envFiles) {
          if (fs.existsSync(envFile)) {
            this.rewriteEnvSaveEntries(envFile, localSave, null);
          }
        }
        AppLogHub.info(
          "nxnative",
          `Sincronização iCloud desativada para ${up} (saves revertidos localmente).`
        );
        return { ok: true, enabled: false };
      } catch (err) {
        return {
          ok: false,
          enabled: true,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }
}
