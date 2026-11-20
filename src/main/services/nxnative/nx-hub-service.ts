import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type {
  NxHubRegisteredGame,
  NxHubStatus,
  NxIosDevice,
  NxSigningTeam,
} from "@types";
import { AppLogHub } from "@main/services/app-log-hub";
import { CerberusPathsService } from "@main/services/cerberus-paths";
import { NxPathsService } from "./nx-paths";
import { NxKeyCheckService } from "./nx-keycheck-service";
import {
  formatPortErrorHint,
  getCurrentShaderChain,
  isInvalidPortSourcePath,
  prepareStagingWorkspace,
  sanitizeFrameworkArtifacts,
  validateFramework,
} from "./nx-build-helpers";

const execFileAsync = promisify(execFile);

interface ShellLibraryState {
  bundleID: string;
  team: string;
  games: NxHubRegisteredGame[];
}

export class NxHubService {
  private static iosInfoCache: {
    at: number;
    value: { devices: NxIosDevice[]; teams: NxSigningTeam[] };
  } | null = null;

  public static getDefaultHubBundleId(): string {
    const rawUser = os.userInfo().username || "developer";
    const cleanUser =
      rawUser.toLowerCase().replace(/[^a-z0-9]/g, "") || "developer";
    return `com.${cleanUser}.nxnative.hub`;
  }

  public static async getHubDirectories(): Promise<{
    hubRoot: string;
    frameworksDir: string;
    projectDir: string;
    derivedDataDir: string;
    shellJsonPath: string;
  }> {
    const appSupport = await NxPathsService.getAppSupportDirectory();
    const hubRoot = path.join(appSupport, "MobileHub");
    return {
      hubRoot,
      frameworksDir: path.join(hubRoot, "Frameworks"),
      projectDir: path.join(hubRoot, "project"),
      derivedDataDir: path.join(hubRoot, "dd"),
      shellJsonPath: path.join(hubRoot, "shell.json"),
    };
  }

  public static async loadShellLibrary(): Promise<ShellLibraryState> {
    const { frameworksDir, shellJsonPath } = await this.getHubDirectories();
    const defaultBundleId = this.getDefaultHubBundleId();

    if (!fs.existsSync(shellJsonPath)) {
      return { bundleID: defaultBundleId, team: "", games: [] };
    }

    try {
      const raw = JSON.parse(
        await fsp.readFile(shellJsonPath, "utf8")
      ) as Partial<ShellLibraryState>;
      let bundleID = raw.bundleID?.trim() || defaultBundleId;
      if (bundleID === "org.nxnative.shell") {
        bundleID = defaultBundleId;
      }
      const team = raw.team?.trim() || "";
      const games: NxHubRegisteredGame[] = [];
      let mutated = false;

      for (const entry of Array.isArray(raw.games) ? raw.games : []) {
        if (!entry?.titleID || !entry?.framework) continue;
        const fwName = path.basename(entry.framework);
        const expectedFw = path.join(frameworksDir, fwName);
        let fwPath = entry.framework;
        if (fwPath !== expectedFw && fs.existsSync(expectedFw)) {
          fwPath = expectedFw;
          mutated = true;
        }
        if (fs.existsSync(fwPath)) {
          games.push({
            titleID: entry.titleID.toUpperCase(),
            name: entry.name || entry.titleID,
            framework: fwPath,
          });
        } else {
          mutated = true;
        }
      }

      const state: ShellLibraryState = { bundleID, team, games };
      if (mutated) {
        await this.saveShellLibrary(state);
      }
      return state;
    } catch {
      return { bundleID: defaultBundleId, team: "", games: [] };
    }
  }

  public static async saveShellLibrary(
    state: ShellLibraryState
  ): Promise<void> {
    const { hubRoot, shellJsonPath } = await this.getHubDirectories();
    await fsp.mkdir(hubRoot, { recursive: true });
    await fsp.writeFile(shellJsonPath, JSON.stringify(state, null, 2), "utf8");
  }

  public static async registerGameInHub(
    titleId: string,
    name: string,
    frameworkPath: string,
    teamId?: string | null
  ): Promise<ShellLibraryState> {
    const state = await this.loadShellLibrary();
    const cleanId = titleId.trim().toUpperCase();
    const entry: NxHubRegisteredGame = {
      titleID: cleanId,
      name: name.trim() || cleanId,
      framework: frameworkPath,
    };

    const idx = state.games.findIndex((g) => g.titleID === cleanId);
    if (idx >= 0) {
      state.games[idx] = entry;
    } else {
      state.games.push(entry);
    }
    if (teamId?.trim()) {
      state.team = teamId.trim();
    }
    await this.saveShellLibrary(state);
    return state;
  }

  public static async getHubStatus(): Promise<NxHubStatus> {
    const state = await this.loadShellLibrary();
    return {
      bundleId: state.bundleID,
      teamId: state.team,
      games: state.games,
    };
  }

  private static async resolveBundledOrSystemTool(
    toolName: string
  ): Promise<string | null> {
    const nxRepo = await NxPathsService.resolveNxnativePath();
    const candidates = [
      `/opt/homebrew/bin/${toolName}`,
      `/usr/local/bin/${toolName}`,
      nxRepo.isValid
        ? path.join(nxRepo.path, "gui", "Resources", "tools", "bin", toolName)
        : "",
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        return c;
      }
    }
    return null;
  }

  /**
   * Multi-layer iOS & iPadOS device and signing team discovery with 1:1 parity
   * with NxNative_Launcher (devicectl JSON + devicectl table + libimobiledevice USB + xctrace + Xcode Preferences + Keychain).
   */
  public static async listIosDevicesAndTeams(force = false): Promise<{
    devices: NxIosDevice[];
    teams: NxSigningTeam[];
  }> {
    if (
      !force &&
      this.iosInfoCache &&
      Date.now() - this.iosInfoCache.at < 15_000
    ) {
      return this.iosInfoCache.value;
    }

    const [devices, teams] = await Promise.all([
      this.discoverConnectedIosDevices(),
      this.discoverSigningTeams(),
    ]);

    const value = { devices, teams };
    this.iosInfoCache = { at: Date.now(), value };
    return value;
  }

  public static async discoverConnectedIosDevices(): Promise<NxIosDevice[]> {
    const byId = new Map<string, NxIosDevice>();

    // Layer 1: xcrun devicectl list devices --json-output
    const tmpJson = path.join(
      os.tmpdir(),
      `cerberus_devicectl_${process.pid}_${Date.now()}.json`
    );
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/xcrun",
        [
          "devicectl",
          "list",
          "devices",
          "--timeout",
          "5",
          "--json-output",
          tmpJson,
        ],
        { encoding: "utf8", timeout: 6500 }
      ).catch((err: { stdout?: string }) => ({
        stdout: err?.stdout || "",
      }));

      if (fs.existsSync(tmpJson)) {
        const parsed = JSON.parse(await fsp.readFile(tmpJson, "utf8")) as {
          result?: { devices?: Array<Record<string, any>> };
        };
        const list = parsed?.result?.devices ?? [];
        for (const d of list) {
          const devProps =
            d.deviceProperties ?? d.properties?.state ?? ({} as Record<string, any>);
          const hwProps =
            d.hardwareProperties ??
            d.properties?.hardware ??
            ({} as Record<string, any>);
          const platformStr = String(
            hwProps.platform || hwProps.deviceType || ""
          ).toLowerCase();
          if (
            platformStr.includes("macos") ||
            platformStr.includes("watchos") ||
            platformStr.includes("tvos")
          ) {
            continue;
          }

          const name = String(devProps.name || "iPhone").trim();
          const hwUdid = String(hwProps.udid || "").trim();
          const coreId = String(d.identifier || hwUdid).trim();
          const udid = hwUdid || coreId;
          if (!udid) continue;

          const marketingName = String(
            hwProps.marketingName ||
              (name.toLowerCase().includes("ipad") ? "iPad" : "iPhone")
          ).trim();
          let osVersion = "iOS";
          if (typeof devProps.osVersionNumber === "string") {
            osVersion = devProps.osVersionNumber;
          } else if (
            devProps.osVersionNumber &&
            typeof devProps.osVersionNumber.stringValue === "string"
          ) {
            osVersion = devProps.osVersionNumber.stringValue;
          }

          const connState = String(
            d.connectionProperties?.tunnelState ||
              d.connectionProperties?.pairingState ||
              d.state ||
              ""
          ).toLowerCase();
          const transportType = String(
            d.connectionProperties?.transportType || ""
          ).toLowerCase();
          const isAvailable =
            !connState.includes("unavailable") &&
            !connState.includes("offline") &&
            !connState.includes("disconnected");

          byId.set(udid.toUpperCase(), {
            id: udid,
            name,
            model: marketingName,
            osVersion,
            isAvailable,
            isUsb: transportType === "wired",
          });
        }
      } else if (stdout) {
        for (const rawLine of stdout.split(/\r?\n/)) {
          const trimmed = rawLine.trim();
          if (
            !trimmed ||
            trimmed.startsWith("Name") ||
            trimmed.startsWith("---")
          ) {
            continue;
          }
          const parts = trimmed.split(/\s+/);
          if (parts.length < 3) continue;
          const idPart = parts.find(
            (p) => p.length >= 16 && (/^[0-9A-Fa-f-]+$/.test(p))
          );
          if (!idPart) continue;
          const isAvailable =
            !trimmed.toLowerCase().includes("unavailable") &&
            !trimmed.toLowerCase().includes("offline");
          if (!byId.has(idPart.toUpperCase())) {
            byId.set(idPart.toUpperCase(), {
              id: idPart,
              name: parts[0],
              model: parts[0].toLowerCase().includes("ipad")
                ? "iPad"
                : "iPhone",
              osVersion: "iOS",
              isAvailable,
            });
          }
        }
      }
    } catch {
      // ignore devicectl error
    } finally {
      await fsp.rm(tmpJson, { force: true }).catch(() => {});
    }

    // Layer 2: libimobiledevice (idevice_id -l & ideviceinfo) for direct USB devices
    try {
      const ideviceIdBin = await this.resolveBundledOrSystemTool("idevice_id");
      const ideviceInfoBin =
        await this.resolveBundledOrSystemTool("ideviceinfo");
      if (ideviceIdBin) {
        const { stdout } = await execFileAsync(ideviceIdBin, ["-l"], {
          encoding: "utf8",
          timeout: 3000,
        });
        const usbUdids = stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);

        for (const usbUdid of usbUdids) {
          const key = usbUdid.toUpperCase();
          const existing = byId.get(key);
          if (existing) {
            existing.isAvailable = true;
            existing.isUsb = true;
            continue;
          }

          let devName = "iPhone / iPad (USB)";
          let devModel = "iOS Device";
          let devOs = "iOS";

          if (ideviceInfoBin) {
            const infoOut = await execFileAsync(
              ideviceInfoBin,
              ["-u", usbUdid],
              { encoding: "utf8", timeout: 3000 }
            )
              .then((r) => r.stdout)
              .catch(() => "");
            for (const line of infoOut.split(/\r?\n/)) {
              if (line.startsWith("DeviceName:")) {
                devName = line.slice("DeviceName:".length).trim() || devName;
              } else if (line.startsWith("ProductType:")) {
                const pt = line.slice("ProductType:".length).trim();
                devModel = pt.toLowerCase().includes("ipad")
                  ? `iPad (${pt})`
                  : `iPhone (${pt})`;
              } else if (line.startsWith("ProductVersion:")) {
                devOs = line.slice("ProductVersion:".length).trim() || devOs;
              }
            }
          }

          byId.set(key, {
            id: usbUdid,
            name: devName,
            model: devModel,
            osVersion: devOs,
            isAvailable: true,
            isUsb: true,
          });
        }
      }
    } catch {
      // ignore libimobiledevice absence
    }

    // Layer 3: xcrun xctrace list devices fallback
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/xcrun",
        ["xctrace", "list", "devices"],
        { encoding: "utf8", timeout: 4500 }
      );
      let section: "none" | "devices" | "offline" = "none";
      for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line === "== Devices ==") {
          section = "devices";
          continue;
        }
        if (line === "== Devices Offline ==") {
          section = "offline";
          continue;
        }
        if (line.startsWith("== ")) {
          section = "none";
          continue;
        }
        if (section === "none" || !line) continue;

        const m = /^(.+?)\s+\(([^)]+)\)\s+\(([0-9A-Fa-f-]{16,})\)/.exec(line);
        if (!m) continue;
        const name = m[1].trim();
        const osVer = m[2].trim();
        const id = m[3].trim();
        if (
          name.toLowerCase().includes("mac") ||
          name.toLowerCase().includes("apple tv") ||
          name.toLowerCase().includes("apple watch")
        ) {
          continue;
        }
        const key = id.toUpperCase();
        const existing = byId.get(key);
        if (existing) {
          if (section === "devices") {
            existing.isAvailable = true;
          }
          if (existing.osVersion === "iOS" && osVer) {
            existing.osVersion = osVer;
          }
        } else {
          byId.set(key, {
            id,
            name,
            model: name.toLowerCase().includes("ipad") ? "iPad" : "iPhone",
            osVersion: osVer,
            isAvailable: section === "devices",
          });
        }
      }
    } catch {
      // ignore xctrace error
    }

    return Array.from(byId.values()).sort((a, b) => {
      const aScore = (a.isAvailable ? 2 : 0) + (a.isUsb ? 1 : 0);
      const bScore = (b.isAvailable ? 2 : 0) + (b.isUsb ? 1 : 0);
      return bScore - aScore;
    });
  }

  public static async discoverSigningTeams(): Promise<NxSigningTeam[]> {
    const teams: NxSigningTeam[] = [];
    const seenIds = new Set<string>();

    const [keychainStdout, xcodeJsonStdout] = await Promise.all([
      execFileAsync(
        "/usr/bin/security",
        ["find-identity", "-v", "-p", "codesigning"],
        { encoding: "utf8", timeout: 3500 }
      )
        .then((r) => r.stdout)
        .catch(() => ""),
      execFileAsync(
        "/bin/sh",
        [
          "-c",
          "/usr/bin/defaults export com.apple.dt.Xcode - 2>/dev/null | /usr/bin/plutil -convert json -o - - 2>/dev/null",
        ],
        { encoding: "utf8", timeout: 3500 }
      )
        .then((r) => r.stdout)
        .catch(() => ""),
    ]);

    // 1. Parse Xcode Accounts (IDEProvisioningTeamByIdentifier)
    if (xcodeJsonStdout.trim().startsWith("{")) {
      try {
        const plist = JSON.parse(xcodeJsonStdout) as {
          IDEProvisioningTeamByIdentifier?: Record<
            string,
            Array<{
              teamID?: string;
              teamName?: string;
              teamType?: string;
              isFreeProvisioningTeam?: boolean | number;
            }>
          >;
        };
        const map = plist.IDEProvisioningTeamByIdentifier ?? {};
        for (const arr of Object.values(map)) {
          if (!Array.isArray(arr)) continue;
          for (const item of arr) {
            const tid = item.teamID?.trim();
            if (!tid || seenIds.has(tid)) continue;
            seenIds.add(tid);
            const tname = item.teamName?.trim() || tid;
            const isFree =
              item.isFreeProvisioningTeam === true ||
              item.isFreeProvisioningTeam === 1;
            const hasCert =
              keychainStdout.includes(tid) || keychainStdout.includes(tname);
            const suffix = isFree ? " (Personal Team)" : "";
            teams.push({
              id: tid,
              name: tname,
              displayName: `${tname}${suffix} [${tid}]`,
              isFreeProvisioningTeam: isFree,
              hasCertificateInKeychain: hasCert,
            });
          }
        }
      } catch {
        // ignore JSON parse errors
      }
    }

    // 2. Parse Keychain Signing Identities
    const certMatches = keychainStdout.split(/\r?\n/);
    for (const line of certMatches) {
      const m =
        /"((?:Apple Development|iPhone Developer|Apple Distribution|iPhone Distribution|iOS Development):\s*([^"]+))"/.exec(
          line
        );
      if (!m) continue;
      const fullCert = m[1].trim();
      const subject = m[2].trim();
      const teamIdMatch = /\(([A-Z0-9]{10})\)/.exec(subject);
      const tid = teamIdMatch?.[1] || subject;
      if (seenIds.has(tid)) continue;
      seenIds.add(tid);
      teams.push({
        id: tid,
        name: subject,
        displayName: teamIdMatch ? `${subject}` : fullCert,
        isFreeProvisioningTeam: false,
        hasCertificateInKeychain: true,
      });
    }

    return teams;
  }

  /**
   * Builds or fast-converts DmGame<TitleID>.framework into MobileHub/Frameworks,
   * registers the game in MobileHub/shell.json (keeping all previous games),
   * and either installs/updates the unified single NxN Launcher app on the connected iOS/iPadOS device
   * or packages the unified multi-game NxN Launcher.ipa on disk.
   */
  public static async buildAndDeployToHub(options: {
    titleId: string;
    gameTitle: string;
    gameDirectory: string;
    sourceFiles?: string[];
    outputDir: string;
    stagingDir: string;
    deviceId?: string | null;
    teamId?: string | null;
    autoDeployToIos?: boolean;
    allowOtherMetal?: boolean;
    isSwitch2?: boolean;
    isNup?: boolean;
    onProgress?: (ev: {
      phase: "stage" | "step" | "progress";
      stageName?: string;
      stageIndex?: number;
      stageTotal?: number;
      step?: string;
      fraction?: number;
    }) => void;
    onProcessSpawned?: (proc: ChildProcess | null) => void;
  }): Promise<{ ok: boolean; outputPath?: string; error?: string }> {
    const nxRepo = await NxPathsService.resolveNxnativePath();
    if (!nxRepo.isValid) {
      return {
        ok: false,
        error: "Repositório nxnative não encontrado.",
      };
    }

    if (isInvalidPortSourcePath(options.gameDirectory, { allowIpa: true })) {
      return {
        ok: false,
        error:
          "A origem selecionada (.app/.framework/.apk) não pode ser usada para gerar build iOS. Selecione a ROM (.nsp/.xci/.nup) ou o .ipa original.",
      };
    }

    const cleanTid = (options.titleId || "0100000000000000")
      .trim()
      .toUpperCase();
    const { frameworksDir, projectDir, derivedDataDir } =
      await this.getHubDirectories();
    await fsp.mkdir(frameworksDir, { recursive: true });
    await fsp.mkdir(projectDir, { recursive: true });
    await fsp.mkdir(derivedDataDir, { recursive: true });

    const expectedChain = getCurrentShaderChain(nxRepo.path);
    const targetFwPath = path.join(frameworksDir, `DmGame${cleanTid}.framework`);
    const python = NxPathsService.findBestPython(nxRepo.path);
    const pythonPath = python.path || "/usr/bin/python3";
    const [appSupportDir, nx2aHome, cacheRoot, prodKeys] = await Promise.all([
      NxPathsService.getAppSupportDirectory(),
      NxPathsService.getNx2AndroidHomeDirectory(),
      CerberusPathsService.getCacheRoot(),
      NxKeyCheckService.resolveProdKeys(),
    ]);
    const tempDir = await NxPathsService.getTempDirectory(options.stagingDir);

    const bundledEnv = NxPathsService.getBundledPythonEnv({
      pythonPath,
      nxnativeDir: nxRepo.path,
      stagingDir: options.stagingDir,
      nx2aHome,
      cacheRoot,
    });

    const baseEnv: NodeJS.ProcessEnv = {
      ...bundledEnv,
      DM_UPDATE_PROFILE_TABLES: "1",
      TMP: tempDir,
      TEMP: tempDir,
      NXNATIVE_DATA_DIR: appSupportDir,
    };

    // Step 1: Build, convert from .ipa, or reuse DmGame<TitleID>.framework in MobileHub/Frameworks
    options.onProgress?.({
      phase: "stage",
      stageName: `Preparando framework DmGame${cleanTid}.framework para NxN Launcher Hub`,
      stageIndex: 1,
      stageTotal: options.autoDeployToIos && options.deviceId ? 3 : 2,
    });

    if (fs.existsSync(targetFwPath)) {
      sanitizeFrameworkArtifacts(targetFwPath);
    }
    const cachedFwValidation = validateFramework(targetFwPath, expectedChain);
    const hasValidCachedFramework = cachedFwValidation.valid;
    if (fs.existsSync(targetFwPath) && !hasValidCachedFramework) {
      AppLogHub.warn(
        "build",
        `[NxN Hub] Framework em cache ${path.basename(targetFwPath)} inválido/desatualizado (${cachedFwValidation.reason}); recompilando...`
      );
    }

    // Locate candidate .ipa if gameDirectory points to an .ipa or one exists in outputDir
    const ipaToFwScript = path.join(
      nxRepo.path,
      "dm",
      "ios",
      "tools",
      "ipa_to_framework.py"
    );
    let candidateIpaPath: string | null = null;
    if (
      options.gameDirectory &&
      options.gameDirectory.toLowerCase().endsWith(".ipa") &&
      fs.existsSync(options.gameDirectory)
    ) {
      candidateIpaPath = options.gameDirectory;
    } else if (fs.existsSync(options.outputDir)) {
      const cleanTitle = options.gameTitle.replace(/\[[^\]]+\]/g, "").trim();
      const normTitle = cleanTitle
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      for (const entry of fs.readdirSync(options.outputDir)) {
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
          entry.toUpperCase().includes(cleanTid) ||
          (normTitle.length >= 4 &&
            (normEntry === normTitle ||
              normEntry.includes(normTitle) ||
              normTitle.includes(normEntry)))
        ) {
          candidateIpaPath = path.join(options.outputDir, entry);
          break;
        }
      }
    }

    let fwReady = hasValidCachedFramework;

    if (!fwReady && candidateIpaPath && fs.existsSync(ipaToFwScript)) {
      AppLogHub.step(
        "build",
        `[NxN Hub] Convertendo ${path.basename(candidateIpaPath)} para DmGame${cleanTid}.framework via ipa_to_framework.py...`
      );
      try {
        await execFileAsync(
          pythonPath,
          [
            ipaToFwScript,
            candidateIpaPath,
            "--out",
            frameworksDir,
            "--name",
            options.gameTitle,
            "--title-id",
            cleanTid,
          ],
          {
            cwd: nxRepo.path,
            env: baseEnv,
            timeout: 120_000,
          }
        );
        sanitizeFrameworkArtifacts(targetFwPath);
        const convCheck = validateFramework(targetFwPath, expectedChain);
        fwReady = convCheck.valid;
        if (!convCheck.valid) {
          AppLogHub.warn(
            "build",
            `[NxN Hub] Framework convertido do IPA tem chain incompatível (${convCheck.reason}); recompilando pela ROM...`
          );
        }
      } catch (err) {
        AppLogHub.warn(
          "build",
          `[NxN Hub] Conversão rápida ipa_to_framework.py falhou (${err instanceof Error ? err.message : String(err)}); tentando build por origem...`
        );
      }
    }

    let effectiveSourceDir = options.gameDirectory;
    if (
      effectiveSourceDir &&
      path.basename(effectiveSourceDir).toUpperCase() === `${cleanTid}_BUILD`
    ) {
      effectiveSourceDir = path.dirname(effectiveSourceDir);
    }

    const buildScript = path.join(
      nxRepo.path,
      "scripts",
      "build_ipa_from_nsp.py"
    );

    const workspace = !fwReady
      ? prepareStagingWorkspace({
          stagingDir: options.stagingDir,
          gameTitle: options.gameTitle,
          titleId: cleanTid,
          sourcePath: effectiveSourceDir,
          sourceFiles: options.sourceFiles,
        })
      : null;

    const isDump =
      Boolean(options.isSwitch2) ||
      Boolean(options.isNup) ||
      Boolean(workspace?.isDumpOrNup);

    const fwArgs = workspace
      ? [
          buildScript,
          workspace.inputDir,
          "--shell-framework",
          frameworksDir,
          "--work-dir",
          workspace.workDir,
          "--title-id",
          cleanTid,
          "--progress",
          "json",
        ]
      : [];
    if (options.allowOtherMetal !== false && fwArgs.length > 0) {
      fwArgs.push("--allow-other-metal");
    }
    if (!isDump && prodKeys.path && fwArgs.length > 0) {
      fwArgs.push("-k", prodKeys.path);
    }

    let fwLogTail = "";
    const fwBuildResult = fwReady
      ? { ok: true }
      : await new Promise<{ ok: boolean; error?: string }>(
      (resolve) => {
        const child = spawn(pythonPath, fwArgs, {
          cwd: nxRepo.path,
          env: baseEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
        options.onProcessSpawned?.(child);

        let lastErr = "";
        const handleLine = (rawLine: string, isErr: boolean) => {
          const line = rawLine.trim();
          if (!line) return;
          fwLogTail = `${fwLogTail}\n${line}`.slice(-4000);
          if (line.startsWith("{") && line.endsWith("}")) {
            try {
              const ev = JSON.parse(line) as {
                ev?: string;
                name?: string;
                k?: number;
                n?: number;
                step?: string;
                frac?: number;
                msg?: string;
              };
              if (ev.ev === "stage") {
                AppLogHub.step(
                  "build",
                  `[${ev.k || 1}/${ev.n || 1}] ${ev.name || "Processando"}`
                );
                options.onProgress?.({
                  phase: "stage",
                  stageName: ev.name || "Compilando Framework",
                  stageIndex: ev.k || 1,
                  stageTotal: ev.n || 1,
                });
                return;
              }
              if (ev.ev === "step" && ev.step) {
                AppLogHub.info("build", `↳ ${ev.step}`);
                options.onProgress?.({ phase: "step", step: ev.step });
                return;
              }
              if (ev.ev === "progress") {
                options.onProgress?.({
                  phase: "progress",
                  fraction: (ev.frac ?? 0) * 0.65,
                });
                return;
              }
              if (ev.ev === "say" && ev.msg) {
                if (ev.msg.startsWith("[RED]")) {
                  lastErr = ev.msg.slice(5).trim();
                }
                AppLogHub.info("build", ev.msg);
                return;
              }
            } catch {
              // plain line
            }
          }
          if (isErr) lastErr = line;
          AppLogHub.append(isErr ? "error" : "info", "build", line);
        };

        readline
          .createInterface({ input: child.stdout })
          .on("line", (l) => handleLine(l, false));
        readline
          .createInterface({ input: child.stderr })
          .on("line", (l) => handleLine(l, true));

        child.on("close", (code) => {
          options.onProcessSpawned?.(null);
          workspace?.cleanup();
          if (code === 0 && fs.existsSync(targetFwPath)) {
            sanitizeFrameworkArtifacts(targetFwPath);
            resolve({ ok: true });
          } else {
            const keyHint = formatPortErrorHint(fwLogTail);
            resolve({
              ok: false,
              error:
                keyHint ||
                lastErr ||
                `Falha ao gerar DmGame${cleanTid}.framework (código ${code})`,
            });
          }
        });
        child.on("error", (err) => {
          options.onProcessSpawned?.(null);
          workspace?.cleanup();
          resolve({ ok: false, error: err.message });
        });
      }
    );

    if (!fwBuildResult.ok) {
      return fwBuildResult;
    }

    // Step 2: Register game in MobileHub/shell.json (keeping all previously ported games!)
    const teamId = options.teamId?.trim() || "0000000000";
    const library = await this.registerGameInHub(
      cleanTid,
      options.gameTitle,
      targetFwPath,
      teamId
    );

    AppLogHub.success(
      "build",
      `[NxN Hub] Jogo "${options.gameTitle}" registrado no NxN Launcher Hub (${library.games.length} jogo(s) no App Único).`
    );

    const buildShellScript = path.join(
      nxRepo.path,
      "dm",
      "ios",
      "tools",
      "build_shell.sh"
    );
    const frontendIosPath = path.join(nxRepo.path, "frontend-ios");

    const validFwPaths: string[] = [];
    for (const g of library.games) {
      if (!fs.existsSync(g.framework)) continue;
      sanitizeFrameworkArtifacts(g.framework);
      const fwCheck = validateFramework(g.framework, expectedChain);
      if (fwCheck.valid) {
        validFwPaths.push(g.framework);
      } else {
        AppLogHub.warn(
          "build",
          `[NxN Hub] Excluindo framework legado/incompatível "${g.name}" (${path.basename(g.framework)}): ${fwCheck.reason}`
        );
      }
    }

    if (validFwPaths.length === 0) {
      return {
        ok: false,
        error: `Nenhum framework compatível com o chain atual (${expectedChain || "atual"}) disponível em ${frameworksDir}.`,
      };
    }

    const hubOutputIpa = path.join(options.outputDir, "NxN Launcher.ipa");

    const shellEnv: NodeJS.ProcessEnv = {
      ...baseEnv,
      SHELL_DIR: projectDir,
      DM_SHELL_FRAMEWORKS: validFwPaths.join("\n"),
      DM_BUNDLE_ID: library.bundleID,
      DM_TEAM_ID: teamId,
      DM_SHELL_NAME: "NxN Launcher",
      DM_SHELL_PACKAGE: frontendIosPath,
      DM_XCODE_DERIVED_DATA: derivedDataDir,
      DM_PACK_IPA: hubOutputIpa,
      FONT_PY: pythonPath,
    };

    // If autoDeployToIos with a target device is requested, compile & install DmShell.app + transfer RomFS
    if (options.autoDeployToIos && options.deviceId) {
      return await this.deployRegisteredGameToDevice({
        titleId: cleanTid,
        gameTitle: options.gameTitle,
        gameDirectory: options.gameDirectory,
        stagingDir: options.stagingDir,
        outputDir: options.outputDir,
        deviceId: options.deviceId,
        teamId,
        onProgress: options.onProgress,
        onProcessSpawned: options.onProcessSpawned,
      });
    }

    // Otherwise, package the multi-game NxN Launcher.ipa on disk
    options.onProgress?.({
      phase: "stage",
      stageName: `Empacotando NxN Launcher.ipa com ${validFwPaths.length} jogo(s)`,
      stageIndex: 2,
      stageTotal: 2,
    });

    if (fs.existsSync(buildShellScript)) {
      const packRes = await new Promise<{ ok: boolean; error?: string }>(
        (resolve) => {
          const proc = spawn("/bin/bash", [buildShellScript, "--build"], {
            cwd: nxRepo.path,
            env: shellEnv,
            stdio: ["ignore", "pipe", "pipe"],
          });
          options.onProcessSpawned?.(proc);
          let outText = "";
          const streamChunk = (d: Buffer, isErr: boolean) => {
            const txt = d.toString();
            outText += txt;
            for (const line of txt.split(/\r?\n/)) {
              const trimmed = line.trim();
              if (trimmed) {
                AppLogHub.append(isErr ? "warning" : "info", "build", `[build_shell] ${trimmed}`);
              }
            }
          };
          proc.stdout?.on("data", (d: Buffer) => streamChunk(d, false));
          proc.stderr?.on("data", (d: Buffer) => streamChunk(d, true));
          proc.on("close", (code) => {
            options.onProcessSpawned?.(null);
            if (code === 0 && fs.existsSync(hubOutputIpa)) {
              resolve({ ok: true });
            } else {
              resolve({
                ok: false,
                error: `Falha ao empacotar NxN Launcher.ipa: ${outText.slice(-400)}`,
              });
            }
          });
          proc.on("error", (err) => {
            options.onProcessSpawned?.(null);
            resolve({ ok: false, error: err.message });
          });
        }
      );

      if (!packRes.ok) {
        return packRes;
      }
    }

    return { ok: true, outputPath: hubOutputIpa };
  }

  /**
   * Deploys the unified NxN Launcher container (with all registered games in MobileHub/shell.json)
   * to the connected iPhone/iPad and transfers the game's RomFS, manifest.json, env.txt, and saves.
   */
  public static async deployRegisteredGameToDevice(options: {
    titleId: string;
    gameTitle: string;
    gameDirectory?: string | null;
    stagingDir?: string | null;
    outputDir?: string | null;
    deviceId: string;
    teamId?: string | null;
    onProgress?: (ev: {
      phase: "stage" | "step" | "progress";
      stageName?: string;
      stageIndex?: number;
      stageTotal?: number;
      step?: string;
      fraction?: number;
    }) => void;
    onProcessSpawned?: (proc: ChildProcess | null) => void;
  }): Promise<{ ok: boolean; outputPath?: string; error?: string }> {
    const nxRepo = await NxPathsService.resolveNxnativePath();
    if (!nxRepo.isValid) {
      return { ok: false, error: "Repositório nxnative não encontrado." };
    }

    const cleanTid = options.titleId.trim().toUpperCase();
    const { frameworksDir, projectDir, derivedDataDir } =
      await this.getHubDirectories();
    const expectedChain = getCurrentShaderChain(nxRepo.path);
    const library = await this.loadShellLibrary();
    const validFwPaths: string[] = [];
    for (const g of library.games) {
      if (!fs.existsSync(g.framework)) continue;
      sanitizeFrameworkArtifacts(g.framework);
      const fwCheck = validateFramework(g.framework, expectedChain);
      if (fwCheck.valid) {
        validFwPaths.push(g.framework);
      } else {
        AppLogHub.warn(
          "build",
          `[NxN Hub] Excluindo framework incompatível "${g.name}" (${path.basename(g.framework)}): ${fwCheck.reason}`
        );
      }
    }

    if (validFwPaths.length === 0) {
      return {
        ok: false,
        error: `Nenhum framework DmGame compatível encontrado em ${frameworksDir}. Porte o jogo para iOS primeiro.`,
      };
    }

    const teamId =
      options.teamId?.trim() || library.team?.trim() || "0000000000";
    const python = NxPathsService.findBestPython(nxRepo.path);
    const pythonPath = python.path || "/usr/bin/python3";
    const stagingDir =
      options.stagingDir || (await NxPathsService.getStagingDirectory());
    const tempDir = await NxPathsService.getTempDirectory(stagingDir);
    const [appSupportDir, nx2aHome, cacheRoot] = await Promise.all([
      NxPathsService.getAppSupportDirectory(),
      NxPathsService.getNx2AndroidHomeDirectory(),
      CerberusPathsService.getCacheRoot(),
    ]);
    const bundledEnv = NxPathsService.getBundledPythonEnv({
      pythonPath,
      nxnativeDir: nxRepo.path,
      stagingDir,
      nx2aHome,
      cacheRoot,
    });
    const buildShellScript = path.join(
      nxRepo.path,
      "dm",
      "ios",
      "tools",
      "build_shell.sh"
    );
    const frontendIosPath = path.join(nxRepo.path, "frontend-ios");

    const shellEnv: NodeJS.ProcessEnv = {
      ...bundledEnv,
      SHELL_DIR: projectDir,
      DM_SHELL_FRAMEWORKS: validFwPaths.join("\n"),
      DM_BUNDLE_ID: library.bundleID,
      DM_TEAM_ID: teamId,
      DM_SHELL_NAME: "NxN Launcher",
      DM_SHELL_PACKAGE: frontendIosPath,
      DM_XCODE_DERIVED_DATA: derivedDataDir,
      FONT_PY: pythonPath,
      TMPDIR: tempDir,
      TEMP: tempDir,
      TMP: tempDir,
      NXNATIVE_DATA_DIR: appSupportDir,
    };

    // 1. Prepare DmShell.xcodeproj with all registered game frameworks
    options.onProgress?.({
      phase: "stage",
      stageName: `Compilando e instalando NxN Launcher (${validFwPaths.length} jogos) no dispositivo`,
      stageIndex: 2,
      stageTotal: 3,
    });
    AppLogHub.step(
      "build",
      `[NxN Hub] Preparando DmShell.xcodeproj com ${validFwPaths.length} jogo(s)...`
    );

    try {
      await execFileAsync("/bin/bash", [buildShellScript, "--prepare-xcode"], {
        cwd: nxRepo.path,
        env: shellEnv,
        timeout: 45_000,
      });
    } catch (err) {
      return {
        ok: false,
        error: `Falha ao preparar projeto DmShell.xcodeproj: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const xcodeProjPath = path.join(projectDir, "DmShell.xcodeproj");
    AppLogHub.step(
      "build",
      `[NxN Hub] Compilando DmShell.app via xcodebuild para o dispositivo ${options.deviceId}...`
    );

    try {
      await execFileAsync(
        "/usr/bin/xcrun",
        [
          "xcodebuild",
          "-project",
          xcodeProjPath,
          "-scheme",
          "DmShell",
          "-configuration",
          "Release",
          "-destination",
          `id=${options.deviceId}`,
          "-derivedDataPath",
          derivedDataDir,
          "-allowProvisioningUpdates",
          `DEVELOPMENT_TEAM=${teamId}`,
          "build",
        ],
        {
          cwd: projectDir,
          env: shellEnv,
          timeout: 300_000,
          maxBuffer: 16 * 1024 * 1024,
        }
      );
    } catch (err) {
      return {
        ok: false,
        error: `Falha no xcodebuild do NxN Launcher (verifique seu Signing Team e certificado Apple Development): ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const builtAppPath = path.join(
      derivedDataDir,
      "Build",
      "Products",
      "Release-iphoneos",
      "DmShell.app"
    );
    if (!fs.existsSync(builtAppPath)) {
      return {
        ok: false,
        error: `DmShell.app não encontrado após compilação em ${builtAppPath}`,
      };
    }

    // 2. Install DmShell.app onto the device via devicectl
    AppLogHub.step(
      "build",
      `[NxN Hub] Instalando aplicativo único NxN Launcher no iPhone/iPad via devicectl...`
    );
    try {
      await execFileAsync(
        "/usr/bin/xcrun",
        [
          "devicectl",
          "device",
          "install",
          "app",
          "--device",
          options.deviceId,
          builtAppPath,
        ],
        {
          env: shellEnv,
          timeout: 240_000,
        }
      );
    } catch (err) {
      return {
        ok: false,
        error: `Falha ao instalar NxN Launcher no dispositivo (desbloqueie a tela do aparelho): ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 3. Locate RomFS.img and transfer Documents/games/<TitleID> into the NxN Launcher container
    options.onProgress?.({
      phase: "stage",
      stageName: `Enviando dados de "${options.gameTitle}" para o NxN Launcher`,
      stageIndex: 3,
      stageTotal: 3,
    });

    const outputDir =
      options.outputDir || (await NxPathsService.getOutputDirectory());
    const romfsPath = await this.locateRomfsImage({
      titleId: cleanTid,
      gameTitle: options.gameTitle,
      stagingDir,
      outputDir,
      gameDirectory: options.gameDirectory || "",
    });

    if (!romfsPath || !fs.existsSync(romfsPath)) {
      return {
        ok: false,
        error: `NxN Launcher instalado, mas a imagem romfs.img não foi encontrada para ${options.gameTitle} (${cleanTid}).`,
      };
    }

    const romfsStat = await fsp.stat(romfsPath);
    const stageContainerDir = await fsp.mkdtemp(
      path.join(tempDir, "cerberus_hub_stage_")
    );

    try {
      const gameStageDir = path.join(stageContainerDir, "games", cleanTid);
      await fsp.mkdir(gameStageDir, { recursive: true });

      const manifest = {
        id: cleanTid,
        titleId: cleanTid,
        name: options.gameTitle,
        displayVersion: "1.0.0",
        romfsSize: romfsStat.size,
        hasPatch: false,
        hasDLC: false,
        isSwitch2: cleanTid.startsWith("0400"),
        storageLocation: { internalContainer: {} },
        launchSettings: {
          enable60FPS: false,
          renderScale: 1.0,
          enableMetalFX: false,
          enableMetalHUD: false,
        },
        lastPlayedDate: null,
        hasSave: false,
      };
      await fsp.writeFile(
        path.join(gameStageDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8"
      );
      await fsp.writeFile(
        path.join(gameStageDir, "env.txt"),
        `# NxN Launcher Runtime Config\nDM_SYNC_TOKEN=${Date.now()}\n`,
        "utf8"
      );

      const afcBin = await this.resolveBundledOrSystemTool("afcclient");
      const ideviceIdBin = await this.resolveBundledOrSystemTool("idevice_id");
      let usbUdid: string | null = null;
      if (afcBin && ideviceIdBin) {
        const usbOut = await execFileAsync(ideviceIdBin, ["-l"], {
          encoding: "utf8",
          timeout: 3000,
        })
          .then((r) => r.stdout)
          .catch(() => "");
        const list = usbOut
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (list.includes(options.deviceId)) {
          usbUdid = options.deviceId;
        } else if (list.length === 1) {
          usbUdid = list[0];
        }
      }

      if (afcBin && usbUdid) {
        AppLogHub.step(
          "build",
          `[NxN Hub] Transferindo manifest.json e romfs.img (${(romfsStat.size / 1024 ** 3).toFixed(2)} GB) via USB AFC...`
        );
        for (const dirPath of [
          "/Documents",
          "/Documents/games",
          `/Documents/games/${cleanTid}`,
        ]) {
          await execFileAsync(
            afcBin,
            [
              "-u",
              usbUdid,
              "--container",
              library.bundleID,
              "--",
              "mkdir",
              dirPath,
            ],
            { timeout: 5000 }
          ).catch(() => {});
        }

        await execFileAsync(
          afcBin,
          [
            "-u",
            usbUdid,
            "--container",
            library.bundleID,
            "--",
            "put",
            "-f",
            path.join(gameStageDir, "manifest.json"),
            `/Documents/games/${cleanTid}/manifest.json`,
          ],
          { timeout: 15_000 }
        );
        await execFileAsync(
          afcBin,
          [
            "-u",
            usbUdid,
            "--container",
            library.bundleID,
            "--",
            "put",
            "-f",
            path.join(gameStageDir, "env.txt"),
            `/Documents/games/${cleanTid}/env.txt`,
          ],
          { timeout: 15_000 }
        );

        const remotePart = `/Documents/games/${cleanTid}/romfs.img.part`;
        const remoteFinal = `/Documents/games/${cleanTid}/romfs.img`;
        await execFileAsync(
          afcBin,
          [
            "-u",
            usbUdid,
            "--container",
            library.bundleID,
            "--",
            "rm",
            remotePart,
          ],
          { timeout: 5000 }
        ).catch(() => {});

        await execFileAsync(
          afcBin,
          [
            "-u",
            usbUdid,
            "--container",
            library.bundleID,
            "--",
            "put",
            "-f",
            romfsPath,
            remotePart,
          ],
          { timeout: 1800_000 }
        );

        await execFileAsync(
          afcBin,
          [
            "-u",
            usbUdid,
            "--container",
            library.bundleID,
            "--",
            "rm",
            remoteFinal,
          ],
          { timeout: 5000 }
        ).catch(() => {});

        await execFileAsync(
          afcBin,
          [
            "-u",
            usbUdid,
            "--container",
            library.bundleID,
            "--",
            "mv",
            remotePart,
            remoteFinal,
          ],
          { timeout: 10_000 }
        );
      } else {
        AppLogHub.step(
          "build",
          `[NxN Hub] Transferindo estrutura e romfs.img via xcrun devicectl...`
        );
        await execFileAsync(
          "/usr/bin/xcrun",
          [
            "devicectl",
            "device",
            "copy",
            "to",
            "--device",
            options.deviceId,
            "--domain-type",
            "appDataContainer",
            "--domain-identifier",
            library.bundleID,
            "--source",
            path.join(stageContainerDir, "games"),
            "--destination",
            "Documents",
          ],
          { timeout: 60_000 }
        );

        await execFileAsync(
          "/usr/bin/xcrun",
          [
            "devicectl",
            "device",
            "copy",
            "to",
            "--device",
            options.deviceId,
            "--domain-type",
            "appDataContainer",
            "--domain-identifier",
            library.bundleID,
            "--source",
            romfsPath,
            "--destination",
            `Documents/games/${cleanTid}/romfs.img`,
          ],
          { timeout: 1800_000 }
        );
      }

      AppLogHub.success(
        "build",
        `[NxN Hub] "${options.gameTitle}" enviado e pronto no aplicativo único NxN Launcher!`
      );
      return { ok: true, outputPath: builtAppPath };
    } catch (err) {
      return {
        ok: false,
        error: `Falha na transferência do RomFS para o NxN Launcher: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      await fsp
        .rm(stageContainerDir, { recursive: true, force: true })
        .catch(() => {});
    }
  }

  private static async locateRomfsImage(params: {
    titleId: string;
    gameTitle: string;
    stagingDir: string;
    outputDir: string;
    gameDirectory: string;
  }): Promise<string | null> {
    const tid = params.titleId.toUpperCase();
    const cleanName = params.gameTitle.replace(/\[[^\]]+\]/g, "").trim();
    const normTitle = cleanName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const candidates: string[] = [];

    const sourceParent =
      params.gameDirectory &&
      /\.(ipa|app|nsp|nsz|xci|nup)$/i.test(params.gameDirectory)
        ? path.dirname(params.gameDirectory)
        : params.gameDirectory;

    const searchRoots = Array.from(
      new Set(
        [
          params.stagingDir,
          sourceParent,
          params.outputDir,
          "/Volumes/Nintendo/Games",
          "/Volumes/Nintendo/Games/Switch 1",
        ].filter(Boolean)
      )
    );

    for (const root of searchRoots) {
      if (!root || !fs.existsSync(root)) continue;
      const buildDir = root.toUpperCase().endsWith(`${tid}_BUILD`)
        ? root
        : path.join(root, `${tid}_build`);
      const extractDir = path.join(buildDir, "extract");
      if (fs.existsSync(extractDir)) {
        try {
          const vers = fs
            .readdirSync(extractDir)
            .filter((v) => !v.startsWith("."));
          for (const v of vers) {
            candidates.push(path.join(extractDir, v, "RomFS.img"));
            candidates.push(path.join(extractDir, v, "romfs.img"));
          }
        } catch {
          // ignore
        }
      }
      candidates.push(path.join(buildDir, "RomFS.img"));
      candidates.push(path.join(buildDir, "romfs.img"));
      if (cleanName) {
        candidates.push(path.join(root, `${cleanName}.romfs.img`));
        candidates.push(
          path.join(
            root,
            `${cleanName}.app`,
            "Contents",
            "Resources",
            "romfs.img"
          )
        );
      }
      candidates.push(path.join(root, `${tid}.romfs.img`));

      // Fuzzy match *.romfs.img in root
      try {
        for (const entry of fs.readdirSync(root)) {
          if (entry.startsWith("._") || !entry.toLowerCase().endsWith(".romfs.img")) {
            continue;
          }
          const stemNorm = entry
            .slice(0, -".romfs.img".length)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
          if (
            entry.toUpperCase().includes(tid) ||
            (normTitle.length >= 4 &&
              (stemNorm === normTitle ||
                stemNorm.includes(normTitle) ||
                normTitle.includes(stemNorm)))
          ) {
            candidates.push(path.join(root, entry));
          }
        }
      } catch {
        // ignore
      }
    }

    if (
      params.gameDirectory &&
      params.gameDirectory.toLowerCase().endsWith(".app")
    ) {
      candidates.push(
        path.join(params.gameDirectory, "Contents", "Resources", "romfs.img")
      );
    }

    for (const c of candidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).size > 0) {
          return c;
        }
      } catch {
        // ignore
      }
    }

    // Fallback: if an .ipa exists, unpack Payload/*.app/romfs.img directly
    let ipaCandidate: string | null = null;
    if (
      params.gameDirectory &&
      params.gameDirectory.toLowerCase().endsWith(".ipa") &&
      fs.existsSync(params.gameDirectory)
    ) {
      ipaCandidate = params.gameDirectory;
    } else if (fs.existsSync(params.outputDir)) {
      for (const entry of fs.readdirSync(params.outputDir)) {
        if (entry.startsWith("._") || !entry.toLowerCase().endsWith(".ipa")) {
          continue;
        }
        const stemNorm = entry
          .slice(0, -4)
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        if (
          entry.toUpperCase().includes(tid) ||
          (normTitle.length >= 4 &&
            (stemNorm === normTitle ||
              stemNorm.includes(normTitle) ||
              normTitle.includes(stemNorm)))
        ) {
          ipaCandidate = path.join(params.outputDir, entry);
          break;
        }
      }
    }

    if (ipaCandidate && fs.existsSync(ipaCandidate)) {
      const targetRomfs = path.join(
        params.outputDir,
        `${cleanName || tid}.romfs.img`
      );
      const unpackTmpBase = await NxPathsService.getTempDirectory(params.stagingDir);
      const tmpUnpack = await fsp.mkdtemp(
        path.join(unpackTmpBase, "cerberus_romfs_unpack_")
      );
      try {
        await execFileAsync(
          "/usr/bin/unzip",
          ["-j", "-o", ipaCandidate, "Payload/*.app/romfs.img", "-d", tmpUnpack],
          { timeout: 180_000 }
        );
        const unpacked = path.join(tmpUnpack, "romfs.img");
        if (fs.existsSync(unpacked) && fs.statSync(unpacked).size > 0) {
          await fsp.rename(unpacked, targetRomfs);
          return targetRomfs;
        }
      } catch {
        // ignore unpack failure
      } finally {
        await fsp
          .rm(tmpUnpack, { recursive: true, force: true })
          .catch(() => {});
      }
    }

    return null;
  }
}
