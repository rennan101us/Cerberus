import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type {
  CrossOverGraphicsBackend,
  CrossOverProvisionProgress,
  CrossOverSyncMode,
  HeadBottleDependenciesStatus,
  RedWineBottleConfig,
} from "@types";
import { gamesSublevel } from "@main/level";
import { CrossOverDetector, DEFAULT_BOTTLE_NAME } from "./crossover-detector";
import { downloadToFile, removeFileQuietly } from "../download-to-file";
import { CerberusPathsService } from "../cerberus-paths";
import { AppLogHub } from "../app-log-hub";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);

const HEAD_BOTTLE_DLL_OVERRIDES: Record<string, string> = {
  "*autorun.exe": "native,builtin",
  "*ctfmon.exe": "builtin",
  "*ddhelp.exe": "builtin",
  "*docbox.api": "",
  "*findfast.exe": "builtin",
  "*ieinfo5.ocx": "builtin",
  "*maildoff.exe": "builtin",
  "*mdm.exe": "builtin",
  "*mosearch.exe": "builtin",
  "*msiexec.exe": "builtin",
  "*pstores.exe": "builtin",
  "*user.exe": "native,builtin",
  amstream: "native, builtin",
  "api-ms-win-core-console-l1-1-0": "native, builtin",
  "api-ms-win-core-datetime-l1-1-0": "native, builtin",
  "api-ms-win-core-debug-l1-1-0": "native, builtin",
  "api-ms-win-core-errorhandling-l1-1-0": "native, builtin",
  "api-ms-win-core-file-l1-1-0": "native, builtin",
  "api-ms-win-core-file-l1-2-0": "native, builtin",
  "api-ms-win-core-file-l2-1-0": "native, builtin",
  "api-ms-win-core-handle-l1-1-0": "native, builtin",
  "api-ms-win-core-heap-l1-1-0": "native, builtin",
  "api-ms-win-core-interlocked-l1-1-0": "native, builtin",
  "api-ms-win-core-libraryloader-l1-1-0": "native, builtin",
  "api-ms-win-core-localization-l1-2-0": "native, builtin",
  "api-ms-win-core-memory-l1-1-0": "native, builtin",
  "api-ms-win-core-namedpipe-l1-1-0": "native, builtin",
  "api-ms-win-core-processenvironment-l1-1-0": "native, builtin",
  "api-ms-win-core-processthreads-l1-1-0": "native, builtin",
  "api-ms-win-core-processthreads-l1-1-1": "native, builtin",
  "api-ms-win-core-profile-l1-1-0": "native, builtin",
  "api-ms-win-core-rtlsupport-l1-1-0": "native, builtin",
  "api-ms-win-core-string-l1-1-0": "native, builtin",
  "api-ms-win-core-synch-l1-1-0": "native, builtin",
  "api-ms-win-core-synch-l1-2-0": "native, builtin",
  "api-ms-win-core-sysinfo-l1-1-0": "native, builtin",
  "api-ms-win-core-timezone-l1-1-0": "native, builtin",
  "api-ms-win-core-util-l1-1-0": "native, builtin",
  "api-ms-win-crt-conio-l1-1-0": "native, builtin",
  "api-ms-win-crt-convert-l1-1-0": "native, builtin",
  "api-ms-win-crt-environment-l1-1-0": "native, builtin",
  "api-ms-win-crt-filesystem-l1-1-0": "native, builtin",
  "api-ms-win-crt-heap-l1-1-0": "native, builtin",
  "api-ms-win-crt-locale-l1-1-0": "native, builtin",
  "api-ms-win-crt-math-l1-1-0": "native, builtin",
  "api-ms-win-crt-multibyte-l1-1-0": "native, builtin",
  "api-ms-win-crt-private-l1-1-0": "native, builtin",
  "api-ms-win-crt-process-l1-1-0": "native, builtin",
  "api-ms-win-crt-runtime-l1-1-0": "native, builtin",
  "api-ms-win-crt-stdio-l1-1-0": "native, builtin",
  "api-ms-win-crt-string-l1-1-0": "native, builtin",
  "api-ms-win-crt-time-l1-1-0": "native, builtin",
  "api-ms-win-crt-utility-l1-1-0": "native, builtin",
  atl: "native, builtin",
  concrt140: "native, builtin",
  crypt32: "native, builtin",
  d3dxof: "native, builtin",
  dciman32: "native",
  devenum: "native, builtin",
  dnet: "native",
  dplay: "native, builtin",
  "dplaysvr.exe": "native, builtin",
  dplayx: "native, builtin",
  dpnaddr: "native, builtin",
  dpnet: "native, builtin",
  dpnhpast: "native, builtin",
  dpnhupnp: "native, builtin",
  dpnlobby: "native, builtin",
  "dpnsvr.exe": "native, builtin",
  dpnwsock: "native, builtin",
  dxdiagn: "native, builtin",
  "eossdk-win64-shipping": "native,builtin",
  "eossdk-win64-shipping.of": "native,builtin",
  "hhctrl.ocx": "native, builtin",
  hlink: "native, builtin",
  iernonce: "native, builtin",
  itss: "native, builtin",
  jscript: "native, builtin",
  mlang: "native, builtin",
  mshtml: "native, builtin",
  msi: "builtin",
  msvcirt: "native, builtin",
  msvcp140: "native, builtin",
  msvcp140_1: "native,builtin",
  msvcp140_2: "native,builtin",
  msvcrt40: "native, builtin",
  msvcrtd: "native, builtin",
  msxml3: "native, builtin",
  nvapi64: "native,builtin",
  odbc32: "native, builtin",
  odbccp32: "native, builtin",
  ole32: "builtin",
  oleaut32: "builtin",
  olepro32: "builtin",
  onlinefix64: "native,builtin",
  quartz: "native, builtin",
  riched20: "native, builtin",
  riched32: "native, builtin",
  rpcrt4: "builtin",
  rsabase: "native, builtin",
  secur32: "native, builtin",
  shdoclc: "native, builtin",
  shdocvw: "native, builtin",
  softpub: "native, builtin",
  steam_api64: "native,builtin",
  steamoverlay64: "native",
  ucrtbase: "native, builtin",
  urlmon: "native, builtin",
  vcamp140: "native, builtin",
  vccorlib140: "native, builtin",
  vcomp140: "native, builtin",
  vcruntime140: "native, builtin",
  vcruntime140_1: "native,builtin",
  wininet: "builtin",
  winm: "native,builtin",
  winmm: "native,builtin",
  wintrust: "native, builtin",
  "wscript.exe": "native, builtin",
};

const toSimpleWinPath = (posixPath: string, bottleDir: string): string => {
  const driveC = path.join(bottleDir, "drive_c");
  const absPath = path.resolve(posixPath);
  const rel = path.relative(driveC, absPath);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel ? `C:\\${rel.split(path.sep).join("\\")}` : "C:\\";
  }
  return `Z:\\${absPath.replace(/^\/+/, "").split(path.sep).join("\\")}`;
};

const hasRealGamesInsideBottle = async (
  bottleDir: string
): Promise<boolean> => {
  const gameFolders = [
    path.join(bottleDir, "drive_c", "Games"),
    path.join(bottleDir, "drive_c", "GOG Games"),
    path.join(bottleDir, "drive_c", "Program Files (x86)", "DODI-Repacks"),
    path.join(bottleDir, "drive_c", "Program Files", "DODI-Repacks"),
  ];

  const hasExeRecursive = async (
    dir: string,
    depth: number
  ): Promise<boolean> => {
    if (depth > 3 || !fs.existsSync(dir)) return false;
    const entries = await fs.promises
      .readdir(dir, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".exe")) {
        return true;
      }
      if (entry.isDirectory()) {
        if (await hasExeRecursive(path.join(dir, entry.name), depth + 1)) {
          return true;
        }
      }
    }
    return false;
  };

  for (const root of gameFolders) {
    if (await hasExeRecursive(root, 0)) {
      return true;
    }
  }
  return false;
};

const upsertRegSection = (
  content: string,
  sectionHeaderPrefix: string,
  requiredEntries: Array<{ key: string; formattedValue: string }>
): { nextContent: string; changed: boolean } => {
  const lines = content.split(/\r?\n/);
  const sectionIdx = lines.findIndex((line) =>
    line.toLowerCase().startsWith(sectionHeaderPrefix.toLowerCase())
  );

  if (sectionIdx === -1) {
    const appended = [
      ...lines,
      "",
      `${sectionHeaderPrefix} ${Math.floor(Date.now() / 1000)}`,
      ...requiredEntries.map((item) => `"${item.key}"=${item.formattedValue}`),
      "",
    ];
    return { nextContent: appended.join("\n"), changed: true };
  }

  let sectionEndIdx = lines.length;
  for (let i = sectionIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("[")) {
      sectionEndIdx = i;
      break;
    }
  }

  const existingKeys = new Set<string>();
  for (let i = sectionIdx + 1; i < sectionEndIdx; i++) {
    const m = lines[i].match(/^"([^"]+)"=/);
    if (m && m[1]) {
      existingKeys.add(m[1].toLowerCase());
    }
  }

  const missingLines = requiredEntries
    .filter((item) => !existingKeys.has(item.key.toLowerCase()))
    .map((item) => `"${item.key}"=${item.formattedValue}`);

  if (missingLines.length === 0) {
    return { nextContent: content, changed: false };
  }

  // Insert right before the blank lines / next section header
  let insertAt = sectionEndIdx;
  while (insertAt > sectionIdx + 1 && lines[insertAt - 1].trim() === "") {
    insertAt--;
  }

  const nextLines = [
    ...lines.slice(0, insertAt),
    ...missingLines,
    ...lines.slice(insertAt),
  ];
  return { nextContent: nextLines.join("\n"), changed: true };
};

export class CrossOverProvisioner {
  private static migrationPromise: Promise<void> | null = null;

  public static async migrateLegacyBottlesToHeadBottle(): Promise<void> {
    if (process.platform !== "darwin") return;
    if (this.migrationPromise) {
      return this.migrationPromise;
    }

    this.migrationPromise = (async () => {
      try {
        const bottlesDir = await CrossOverDetector.getBottlesDirectory();
        if (!fs.existsSync(bottlesDir)) {
          await fs.promises.mkdir(bottlesDir, { recursive: true });
        }

        const steamDir = path.join(bottlesDir, "Steam");
        const headDir = path.join(bottlesDir, DEFAULT_BOTTLE_NAME);
        const hydraDir = path.join(bottlesDir, "HydraGames");

        if (fs.existsSync(steamDir) && !fs.existsSync(headDir)) {
          await fs.promises.rename(steamDir, headDir);
          logger.info(
            `[RedWine] Migrated Steam bottle -> '${DEFAULT_BOTTLE_NAME}'`
          );
        }

        if (fs.existsSync(hydraDir) && hydraDir !== headDir) {
          const hasGames = await hasRealGamesInsideBottle(hydraDir);
          if (!hasGames) {
            await fs.promises.rm(hydraDir, { recursive: true, force: true });
            logger.info("[RedWine] Removed empty legacy 'HydraGames' bottle");
          }
        }

        // Update saved library entries referencing legacy /Bottles/Steam or /Bottles/HydraGames
        const entries = await gamesSublevel
          .iterator()
          .all()
          .catch(() => []);
        for (const [key, game] of entries) {
          if (!game || game.isDeleted) continue;

          let updated = false;
          const next = { ...game };

          const rewriteLegacyPath = (
            val?: string | null
          ): string | null | undefined => {
            if (!val) return val;
            let result = val;
            if (result.includes("/Bottles/Steam")) {
              result = result.replace(
                /\/Bottles\/Steam(?=\/|$)/g,
                `/Bottles/${DEFAULT_BOTTLE_NAME}`
              );
            }
            if (result.includes("/Bottles/HydraGames")) {
              result = result.replace(
                /\/Bottles\/HydraGames(?=\/|$)/g,
                `/Bottles/${DEFAULT_BOTTLE_NAME}`
              );
            }
            return result;
          };

          const newExec = rewriteLegacyPath(next.executablePath);
          if (newExec !== next.executablePath) {
            next.executablePath = newExec;
            updated = true;
          }

          const newPrefix = rewriteLegacyPath(next.winePrefixPath);
          if (newPrefix !== next.winePrefixPath) {
            next.winePrefixPath = newPrefix;
            updated = true;
          }

          if (
            next.macOSCompatibility?.bottleName === "Steam" ||
            next.macOSCompatibility?.bottleName === "HydraGames"
          ) {
            next.macOSCompatibility = {
              ...next.macOSCompatibility,
              bottleName: DEFAULT_BOTTLE_NAME,
            };
            updated = true;
          }

          if (updated) {
            await gamesSublevel.put(key, next);
          }
        }

        if (fs.existsSync(path.join(headDir, "cxbottle.conf"))) {
          await this.configureBottleOptimalDefaults(headDir);
        }
      } catch (error) {
        logger.warn("[RedWine] Legacy bottle migration notice", error);
      }
    })();

    try {
      await this.migrationPromise;
    } finally {
      this.migrationPromise = null;
    }
  }
  public static async resetTrial(): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const nowIso = new Date().toISOString();
      const homeDir = os.homedir();
      const plistPath = path.join(
        homeDir,
        "Library",
        "Preferences",
        "com.codeweavers.CrossOver.plist"
      );

      // 1. Update plist if it exists or create directory if needed
      const plistDir = path.dirname(plistPath);
      if (!fs.existsSync(plistDir)) {
        await fs.promises.mkdir(plistDir, { recursive: true });
      }

      await execFileAsync("/usr/bin/defaults", [
        "write",
        plistPath,
        "FirstRunDate",
        "-date",
        nowIso,
      ]).catch(() => null);

      await execFileAsync("/usr/bin/defaults", [
        "write",
        plistPath,
        "SULastCheckTime",
        "-date",
        nowIso,
      ]).catch(() => null);

      // Flush preference caching daemon
      await execFileAsync("/usr/bin/killall", ["cfprefsd"]).catch(() => null);

      // 2. Clean system.reg across all bottles
      const bottlesDir = await CrossOverDetector.getBottlesDirectory();
      let cleanedCount = 0;

      if (fs.existsSync(bottlesDir)) {
        const bottleFolders = await fs.promises.readdir(bottlesDir, {
          withFileTypes: true,
        });

        for (const entry of bottleFolders) {
          if (!entry.isDirectory()) continue;
          const regPath = path.join(bottlesDir, entry.name, "system.reg");
          if (!fs.existsSync(regPath)) continue;

          try {
            const content = await fs.promises.readFile(regPath, "utf-8");
            if (content.includes("CodeWeavers\\CrossOver\\cxoffice")) {
              const lines = content.split("\n");
              const newLines: string[] = [];
              let skip = false;

              for (const line of lines) {
                if (
                  line.startsWith(
                    "[Software\\CodeWeavers\\CrossOver\\cxoffice]"
                  )
                ) {
                  skip = true;
                  continue;
                }
                if (skip) {
                  // End of section on empty line or next section header
                  if (line.startsWith("[") || line.trim() === "") {
                    skip = false;
                    if (line.startsWith("[")) {
                      newLines.push(line);
                    }
                  }
                  continue;
                }
                newLines.push(line);
              }

              // Create backup if not present
              const bakPath = `${regPath}.bak`;
              if (!fs.existsSync(bakPath)) {
                await fs.promises.copyFile(regPath, bakPath);
              }

              await fs.promises.writeFile(
                regPath,
                newLines.join("\n"),
                "utf-8"
              );
              cleanedCount++;
            }
          } catch (regError) {
            logger.warn(
              `[RedWine] Failed to clean registry in ${entry.name}`,
              regError
            );
          }
        }
      }

      logger.info(
        `[RedWine] Environment refresh completed successfully (${cleanedCount} environments).`
      );
      return {
        success: true,
        message: `Ambiente Red Wine atualizado (${cleanedCount} ambientes)`,
      };
    } catch (error) {
      logger.error("[RedWine] Environment refresh failed", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private static async ensureUserRegSettings(bottleDir: string): Promise<void> {
    const userRegPath = path.join(bottleDir, "user.reg");
    if (!fs.existsSync(userRegPath)) return;

    try {
      let content = await fs.promises.readFile(userRegPath, "utf-8");
      let changed = false;

      const cpuResult = upsertRegSection(content, "[Software\\\\Wine\\\\CPU]", [
        { key: "ProcessorCount", formattedValue: "dword:0000000a" },
      ]);
      content = cpuResult.nextContent;
      if (cpuResult.changed) changed = true;

      const dllEntries = Object.entries(HEAD_BOTTLE_DLL_OVERRIDES).map(
        ([key, val]) => ({
          key,
          formattedValue: `"${val}"`,
        })
      );
      const dllResult = upsertRegSection(
        content,
        "[Software\\\\Wine\\\\DllOverrides]",
        dllEntries
      );
      content = dllResult.nextContent;
      if (dllResult.changed) changed = true;

      const audioResult = upsertRegSection(
        content,
        "[Software\\\\Wine\\\\Drivers]",
        [{ key: "Audio", formattedValue: '"coreaudio"' }]
      );
      content = audioResult.nextContent;
      if (audioResult.changed) changed = true;

      const controllerResult = upsertRegSection(
        content,
        "[System\\\\CurrentControlSet\\\\Services\\\\winebus]",
        [
          { key: "Enable SDL", formattedValue: "dword:00000001" },
          { key: "Map Controllers", formattedValue: "dword:00000001" },
        ]
      );
      content = controllerResult.nextContent;
      if (controllerResult.changed) changed = true;

      const inetResult = upsertRegSection(
        content,
        "[Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Internet Settings]",
        [{ key: "SecureProtocols", formattedValue: "dword:00000a80" }]
      );
      content = inetResult.nextContent;
      if (inetResult.changed) changed = true;

      if (changed) {
        await fs.promises.writeFile(userRegPath, content, "utf-8");
        logger.info(
          `[RedWine] Applied CPU, DllOverrides, CoreAudio, SDL Controllers and TLS settings to ${userRegPath}`
        );
      }
    } catch (error) {
      logger.warn("[RedWine] Failed to update user.reg overrides", error);
    }
  }

  public static async configureBottleOptimalDefaults(
    bottleDir: string,
    forceOverwrite = false
  ): Promise<void> {
    const confPath = path.join(bottleDir, "cxbottle.conf");
    if (!fs.existsSync(confPath)) return;

    try {
      let content = await fs.promises.readFile(confPath, "utf-8");

      const bottleSettings: Record<string, string> = {
        WindowsVersion: "win11",
        MenuMode: "install",
        AssocMode: "install",
      };

      if (!content.includes("[Bottle]")) {
        content = `[Bottle]\n${content}`;
      }

      for (const [key, val] of Object.entries(bottleSettings)) {
        const regex = new RegExp(`^"${key}"\\s*=.*$`, "m");
        const entry = `"${key}" = "${val}"`;
        if (regex.test(content)) {
          if (forceOverwrite) {
            content = content.replace(regex, entry);
          }
        } else {
          content = content.replace("[Bottle]", `[Bottle]\n${entry}`);
        }
      }

      if (!content.includes("[EnvironmentVariables]")) {
        content += "\n[EnvironmentVariables]\n";
      }

      const optimalSettings: Record<string, string> = {
        CX_GRAPHICS_BACKEND: "d3dmetal",
        WINEMSYNC: "1",
        D3DM_ENABLE_METALFX: "1",
        D3DM_SUPPORT_DXR: "1",
        ROSETTA_ADVERTISE_AVX: "1",
        DXMT_ENABLE_NVEXT: "1",
        D3DM_MTL4: "1",
      };

      for (const [key, val] of Object.entries(optimalSettings)) {
        const regex = new RegExp(`^"${key}"\\s*=.*$`, "m");
        const entry = `"${key}" = "${val}"`;
        if (regex.test(content)) {
          if (forceOverwrite) {
            content = content.replace(regex, entry);
          }
        } else {
          content = content.replace(
            "[EnvironmentVariables]",
            `[EnvironmentVariables]\n${entry}`
          );
        }
      }

      await fs.promises.writeFile(confPath, content, "utf-8");
      await this.ensureUserRegSettings(bottleDir);
      logger.info(
        `[RedWine] Configured optimal settings for bottle at ${bottleDir}`
      );
    } catch (error) {
      logger.warn(
        "[RedWine] Failed to write optimal settings to cxbottle.conf",
        error
      );
    }
  }

  public static async getBottleConfig(
    _bottleName = DEFAULT_BOTTLE_NAME
  ): Promise<RedWineBottleConfig> {
    const defaults: RedWineBottleConfig = {
      graphicsBackend: "d3dmetal",
      syncMode: "msync",
      windowsVersion: "win11",
      rosettaAvx: true,
      metalHud: false,
      highResolutionMode: false,
      audioDriver: "coreaudio",
      sdlGamepadEnabled: true,
      tlsModernEnabled: true,
    };

    try {
      const bottlesDir = await CrossOverDetector.getBottlesDirectory();
      const bottleDir = path.join(bottlesDir, DEFAULT_BOTTLE_NAME);
      const confPath = path.join(bottleDir, "cxbottle.conf");
      if (!fs.existsSync(confPath)) return defaults;

      const content = await fs.promises.readFile(confPath, "utf-8");
      const readConfKey = (key: string): string | null => {
        const match = content.match(
          new RegExp(`^"${key}"\\s*=\\s*"([^"]*)"`, "m")
        );
        return match?.[1] ?? null;
      };

      const rawBackend = readConfKey("CX_GRAPHICS_BACKEND");
      if (
        rawBackend === "d3dmetal" ||
        rawBackend === "dxmt" ||
        rawBackend === "dxvk" ||
        rawBackend === "wined3d"
      ) {
        defaults.graphicsBackend = rawBackend;
      }

      const rawMsync = readConfKey("WINEMSYNC");
      const rawEsync = readConfKey("WINEESYNC");
      if (rawMsync === "1") defaults.syncMode = "msync";
      else if (rawEsync === "1") defaults.syncMode = "esync";
      else if (rawMsync === "0" && rawEsync === "0") defaults.syncMode = "none";

      const rawWin = readConfKey("WindowsVersion");
      if (rawWin === "win10" || rawWin === "win11" || rawWin === "win7") {
        defaults.windowsVersion = rawWin;
      }

      const rawAvx = readConfKey("ROSETTA_ADVERTISE_AVX");
      if (rawAvx !== null) defaults.rosettaAvx = rawAvx === "1";

      const rawHud = readConfKey("MTL_HUD_ENABLED");
      if (rawHud !== null) defaults.metalHud = rawHud === "1";

      const rawRetina = readConfKey("RETINA_MODE");
      if (rawRetina !== null) defaults.highResolutionMode = rawRetina === "1";

      const userRegPath = path.join(bottleDir, "user.reg");
      if (fs.existsSync(userRegPath)) {
        const reg = await fs.promises.readFile(userRegPath, "utf-8");
        defaults.sdlGamepadEnabled =
          reg.includes('"Enable SDL"=dword:00000001') ||
          !reg.includes('"Enable SDL"=dword:00000000');
        defaults.tlsModernEnabled = reg.includes(
          '"SecureProtocols"=dword:00000a80'
        );
      }
    } catch {
      // return defaults
    }

    return defaults;
  }

  public static async saveBottleConfig(
    partial: Partial<RedWineBottleConfig>,
    _bottleName = DEFAULT_BOTTLE_NAME
  ): Promise<RedWineBottleConfig> {
    const bottleDir = await this.ensureBottle(DEFAULT_BOTTLE_NAME);
    const current = await this.getBottleConfig(DEFAULT_BOTTLE_NAME);
    const merged: RedWineBottleConfig = {
      ...current,
      ...partial,
      audioDriver: "coreaudio",
    };

    const confPath = path.join(bottleDir, "cxbottle.conf");
    if (fs.existsSync(confPath)) {
      let content = await fs.promises.readFile(confPath, "utf-8");
      if (!content.includes("[Bottle]")) {
        content = `[Bottle]\n${content}`;
      }
      if (!content.includes("[EnvironmentVariables]")) {
        content += "\n[EnvironmentVariables]\n";
      }

      const setConfKey = (
        section: "[Bottle]" | "[EnvironmentVariables]",
        key: string,
        val: string
      ) => {
        const regex = new RegExp(`^"${key}"\\s*=.*$`, "m");
        const entry = `"${key}" = "${val}"`;
        if (regex.test(content)) {
          content = content.replace(regex, entry);
        } else {
          content = content.replace(section, `${section}\n${entry}`);
        }
      };

      setConfKey("[Bottle]", "WindowsVersion", merged.windowsVersion);

      const backend: CrossOverGraphicsBackend = merged.graphicsBackend;
      const sync: CrossOverSyncMode = merged.syncMode;

      setConfKey("[EnvironmentVariables]", "CX_GRAPHICS_BACKEND", backend);
      setConfKey(
        "[EnvironmentVariables]",
        "WINED3DMETAL",
        backend === "d3dmetal" ? "1" : "0"
      );
      setConfKey(
        "[EnvironmentVariables]",
        "DXVK",
        backend === "dxvk" ? "1" : "0"
      );
      setConfKey(
        "[EnvironmentVariables]",
        "WINEMSYNC",
        sync === "msync" ? "1" : "0"
      );
      setConfKey(
        "[EnvironmentVariables]",
        "WINEESYNC",
        sync === "esync" ? "1" : "0"
      );
      setConfKey(
        "[EnvironmentVariables]",
        "ROSETTA_ADVERTISE_AVX",
        merged.rosettaAvx ? "1" : "0"
      );
      setConfKey(
        "[EnvironmentVariables]",
        "MTL_HUD_ENABLED",
        merged.metalHud ? "1" : "0"
      );
      setConfKey(
        "[EnvironmentVariables]",
        "RETINA_MODE",
        merged.highResolutionMode ? "1" : "0"
      );

      await fs.promises.writeFile(confPath, content, "utf-8");
    }

    const userRegPath = path.join(bottleDir, "user.reg");
    if (fs.existsSync(userRegPath)) {
      let reg = await fs.promises.readFile(userRegPath, "utf-8");
      const ctrlRes = upsertRegSection(
        reg,
        "[System\\\\CurrentControlSet\\\\Services\\\\winebus]",
        [
          {
            key: "Enable SDL",
            formattedValue: merged.sdlGamepadEnabled
              ? "dword:00000001"
              : "dword:00000000",
          },
          {
            key: "Map Controllers",
            formattedValue: merged.sdlGamepadEnabled
              ? "dword:00000001"
              : "dword:00000000",
          },
        ]
      );
      reg = ctrlRes.nextContent;
      const tlsRes = upsertRegSection(
        reg,
        "[Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Internet Settings]",
        [
          {
            key: "SecureProtocols",
            formattedValue: merged.tlsModernEnabled
              ? "dword:00000a80"
              : "dword:00000000",
          },
        ]
      );
      reg = tlsRes.nextContent;
      await fs.promises.writeFile(userRegPath, reg, "utf-8");
    }

    await this.ensureUserRegSettings(bottleDir);
    return await this.getBottleConfig(DEFAULT_BOTTLE_NAME);
  }

  public static async ensureBottle(
    _bottleName = DEFAULT_BOTTLE_NAME
  ): Promise<string> {
    await this.migrateLegacyBottlesToHeadBottle();

    const bottleName = DEFAULT_BOTTLE_NAME;
    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    if (!fs.existsSync(bottlesDir)) {
      await fs.promises.mkdir(bottlesDir, { recursive: true });
    }

    const bottleDir = path.join(bottlesDir, bottleName);
    const confPath = path.join(bottleDir, "cxbottle.conf");

    if (fs.existsSync(confPath)) {
      await this.configureBottleOptimalDefaults(bottleDir);
      return bottleDir;
    }

    const cxbottleBin = CrossOverDetector.getBinaryPath("cxbottle");
    if (!cxbottleBin) {
      throw new Error("Red Wine command-line tool 'cxbottle' not found");
    }

    logger.info(
      `[RedWine] Creating unified bottle '${bottleName}' with win10_64 template...`
    );

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        cxbottleBin,
        ["--bottle", bottleName, "--create", "--template", "win10_64"],
        {
          env: {
            ...process.env,
            CX_BOTTLE_PATH: bottlesDir,
          },
          stdio: "ignore",
        }
      );

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`cxbottle exited with code ${code}`));
        }
      });

      proc.on("error", reject);
    });

    await this.configureBottleOptimalDefaults(bottleDir);
    return bottleDir;
  }

  public static async getHeadBottleDependenciesStatus(): Promise<HeadBottleDependenciesStatus> {
    if (process.platform !== "darwin") {
      return {
        bottleReady: false,
        bottleDir: null,
        vcredist: false,
        directx: false,
        steam: false,
        epic: false,
      };
    }

    await this.migrateLegacyBottlesToHeadBottle().catch(() => {});
    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    const bottleDir = path.join(bottlesDir, DEFAULT_BOTTLE_NAME);
    const bottleReady = fs.existsSync(path.join(bottleDir, "cxbottle.conf"));

    if (!bottleReady) {
      return {
        bottleReady: false,
        bottleDir,
        vcredist: false,
        directx: false,
        steam: false,
        epic: false,
      };
    }

    const vcredist =
      fs.existsSync(
        path.join(bottleDir, "drive_c/windows/system32/vcruntime140_1.dll")
      ) &&
      fs.existsSync(
        path.join(bottleDir, "drive_c/windows/syswow64/vcruntime140.dll")
      );

    const directx =
      fs.existsSync(
        path.join(bottleDir, "drive_c/windows/system32/d3dx9_43.dll")
      ) ||
      fs.existsSync(
        path.join(bottleDir, "drive_c/windows/system32/d3dcompiler_47.dll")
      );

    const steam =
      fs.existsSync(
        path.join(bottleDir, "drive_c/Program Files (x86)/Steam/steam.exe")
      ) ||
      fs.existsSync(
        path.join(bottleDir, "drive_c/Program Files/Steam/steam.exe")
      );

    const epic =
      fs.existsSync(
        path.join(
          bottleDir,
          "drive_c/Program Files (x86)/Epic Games/Launcher/Portal/Binaries/Win64/EpicGamesLauncher.exe"
        )
      ) ||
      fs.existsSync(
        path.join(
          bottleDir,
          "drive_c/Program Files (x86)/Epic Games/Launcher/Portal/Binaries/Win32/EpicGamesLauncher.exe"
        )
      ) ||
      fs.existsSync(
        path.join(
          bottleDir,
          "drive_c/Program Files/Epic Games/Launcher/Portal/Binaries/Win64/EpicGamesLauncher.exe"
        )
      );

    return {
      bottleReady,
      bottleDir,
      vcredist,
      directx,
      steam,
      epic,
    };
  }

  private static async runBottleCommandWait(
    bottlesDir: string,
    bottleDir: string,
    installerPath: string,
    extraArgs: string[] = [],
    timeoutMs = 300_000
  ): Promise<number | null> {
    const wineBin = CrossOverDetector.getBinaryPath("wine");
    if (!wineBin) {
      throw new Error("Red Wine binary not found");
    }

    const winPath = toSimpleWinPath(installerPath, bottleDir);
    const winWorkDir = toSimpleWinPath(path.dirname(installerPath), bottleDir);
    const ext = path.extname(installerPath).toLowerCase();

    const args =
      ext === ".msi"
        ? [
            "--bottle",
            DEFAULT_BOTTLE_NAME,
            "--workdir",
            winWorkDir,
            "--wait-children",
            "--cx-app",
            "msiexec",
            "/i",
            winPath,
            ...extraArgs,
          ]
        : [
            "--bottle",
            DEFAULT_BOTTLE_NAME,
            "--workdir",
            winWorkDir,
            "--wait-children",
            "--cx-app",
            winPath,
            ...extraArgs,
          ];

    return await new Promise<number | null>((resolve, reject) => {
      const child = spawn(wineBin, args, {
        cwd: path.dirname(installerPath),
        env: {
          ...(process.env as Record<string, string>),
          CX_BOTTLE_PATH: bottlesDir,
          WINEPREFIX: bottleDir,
          CX_GRAPHICS_BACKEND: "d3dmetal",
          WINED3DMETAL: "1",
          DXVK: "0",
          WINEMSYNC: "1",
          WINEESYNC: "0",
          D3DM_ENABLE_METALFX: "1",
          D3DM_SUPPORT_DXR: "1",
          ROSETTA_ADVERTISE_AVX: "1",
          DXMT_ENABLE_NVEXT: "1",
          D3DM_MTL4: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Timeout running ${path.basename(installerPath)}`));
      }, timeoutMs);

      child.stdout?.on("data", (buf: Buffer) => {
        const txt = buf.toString().trim();
        if (txt) AppLogHub.info("crossover", `[${DEFAULT_BOTTLE_NAME}] ${txt}`);
      });
      child.stderr?.on("data", (buf: Buffer) => {
        const txt = buf.toString().trim();
        if (txt) AppLogHub.warn("crossover", `[${DEFAULT_BOTTLE_NAME}] ${txt}`);
      });

      child.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      child.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  public static async provisionHeadBottleDependencies(
    onProgress?: (progress: CrossOverProvisionProgress) => void
  ): Promise<HeadBottleDependenciesStatus> {
    const emit = (
      phase: CrossOverProvisionProgress["phase"],
      progress: number,
      message: string
    ) => {
      onProgress?.({ phase, progress, message });
      AppLogHub.info("crossover", `[Head Bottle] ${message}`);
    };

    emit("configuring", 5, "Preparando Head Bottle (Default)...");
    const bottleDir = await this.ensureBottle(DEFAULT_BOTTLE_NAME);
    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    const statusBefore = await this.getHeadBottleDependenciesStatus();

    const cacheDir = await CerberusPathsService.getCrossOverToolsCacheDir();
    await fs.promises.mkdir(cacheDir, { recursive: true });

    const tasks: Array<{
      needed: boolean;
      label: string;
      filename: string;
      url: string;
      args: string[];
      basePct: number;
    }> = [
      {
        needed: !statusBefore.vcredist,
        label: "Visual C++ Redistributable 2015–2022 (x64)",
        filename: "vc_redist.x64.exe",
        url: "https://aka.ms/vs/17/release/vc_redist.x64.exe",
        args: ["/install", "/quiet", "/norestart"],
        basePct: 15,
      },
      {
        needed: !statusBefore.vcredist,
        label: "Visual C++ Redistributable 2015–2022 (x86)",
        filename: "vc_redist.x86.exe",
        url: "https://aka.ms/vs/17/release/vc_redist.x86.exe",
        args: ["/install", "/quiet", "/norestart"],
        basePct: 35,
      },
      {
        needed: !statusBefore.directx,
        label: "DirectX Runtime (End-User)",
        filename: "dxwebsetup.exe",
        url: "https://download.microsoft.com/download/1/7/1/1718CCC4-6315-4D8E-9543-8E28A4E18C4C/dxwebsetup.exe",
        args: ["/Q"],
        basePct: 55,
      },
      {
        needed: !statusBefore.steam,
        label: "Steam (Windows)",
        filename: "SteamSetup.exe",
        url: "https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe",
        args: ["/S"],
        basePct: 72,
      },
      {
        needed: !statusBefore.epic,
        label: "Epic Games Launcher",
        filename: "EpicGamesLauncherInstaller.msi",
        url: "https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/EpicGamesLauncherInstaller.msi",
        args: ["/qn", "/norestart"],
        basePct: 88,
      },
    ];

    for (const task of tasks) {
      if (!task.needed) continue;
      const dest = path.join(cacheDir, task.filename);
      try {
        emit("downloading", task.basePct, `Baixando ${task.label}...`);
        await downloadToFile(task.url, dest, () => {});
        emit(
          "configuring",
          task.basePct + 6,
          `Instalando ${task.label} na Head Bottle...`
        );
        await this.runBottleCommandWait(bottlesDir, bottleDir, dest, task.args);
      } catch (err) {
        await removeFileQuietly(dest);
        logger.warn(
          `[RedWine] Optional/dependency step warning for ${task.label}`,
          err
        );
        AppLogHub.warn(
          "crossover",
          `[Head Bottle] Aviso em ${task.label}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    await this.configureBottleOptimalDefaults(bottleDir);
    const finalStatus = await this.getHeadBottleDependenciesStatus();
    emit("done", 100, "Head Bottle (Default) configurada!");
    return finalStatus;
  }

  public static async downloadAndInstallCrossOver(
    onProgress?: (progress: CrossOverProvisionProgress) => void
  ): Promise<string> {
    const updateProgress = (
      phase: CrossOverProvisionProgress["phase"],
      progress: number,
      message?: string,
      error?: string
    ) => {
      onProgress?.({ phase, progress, message, error });
    };

    updateProgress("checking", 0, "Checking Red Wine release...");
    const release = await CrossOverDetector.checkLatestRelease();
    const downloadUrl =
      release.downloadUrl ||
      "https://media.codeweavers.com/pub/crossover/cxmac/demo/crossover-26.3.0.zip";

    const tmpDir = path.join(os.tmpdir(), "hydra-crossover-install");
    if (!fs.existsSync(tmpDir)) {
      await fs.promises.mkdir(tmpDir, { recursive: true });
    }
    const zipPath = path.join(tmpDir, "crossover.zip");

    updateProgress("downloading", 5, "Downloading Red Wine Engine...");

    // Download stream with progress
    const response = await fetch(downloadUrl, {
      headers: {
        "User-Agent": "CrossOver/26.3.0 Sparkle/1.26.0",
      },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download Red Wine: HTTP ${response.status}`);
    }

    const contentLength =
      Number(response.headers.get("content-length")) || 380_000_000;
    let downloadedBytes = 0;

    const fileStream = fs.createWriteStream(zipPath);
    const reader = response.body.getReader();

    let isReading = true;
    while (isReading) {
      const { done, value } = await reader.read();
      if (done) {
        isReading = false;
        break;
      }
      if (value) {
        fileStream.write(Buffer.from(value));
        downloadedBytes += value.length;
        const pct = Math.min(
          85,
          5 + Math.round((downloadedBytes / contentLength) * 80)
        );
        updateProgress(
          "downloading",
          pct,
          `Downloading Red Wine (${Math.round(downloadedBytes / 1024 / 1024)} MB)...`
        );
      }
    }
    fileStream.end();

    await new Promise<void>((resolve, reject) => {
      fileStream.on("finish", resolve);
      fileStream.on("error", reject);
    });

    updateProgress(
      "extracting",
      88,
      "Setting up Red Wine runtime in Applications..."
    );

    // Target installation directory: prefer /Applications, fallback to ~/Applications
    let targetAppsDir = "/Applications";
    try {
      await fs.promises.access(targetAppsDir, fs.constants.W_OK);
    } catch {
      targetAppsDir = path.join(os.homedir(), "Applications");
      if (!fs.existsSync(targetAppsDir)) {
        await fs.promises.mkdir(targetAppsDir, { recursive: true });
      }
    }

    // Extract using ditto for full macOS bundle preservation
    await execFileAsync("/usr/bin/ditto", ["-xk", zipPath, targetAppsDir], {
      timeout: 120_000,
    });

    const targetAppPath = path.join(targetAppsDir, "CrossOver.app");

    // Remove quarantine flag
    await execFileAsync("/usr/bin/xattr", [
      "-dr",
      "com.apple.quarantine",
      targetAppPath,
    ]).catch(() => null);

    // Clean up zip
    await fs.promises
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => null);

    updateProgress(
      "configuring",
      95,
      "Aplicando configurações padrão do ambiente Red Wine..."
    );

    // Silent environment initialization
    await this.resetTrial();

    // Ensure default bottle
    await this.ensureBottle(DEFAULT_BOTTLE_NAME).catch((err) => {
      logger.warn("[RedWine] Initial bottle setup warning", err);
    });

    updateProgress("done", 100, "Red Wine setup completed!");
    return targetAppPath;
  }
}
