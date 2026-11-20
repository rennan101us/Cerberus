import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import type {
  NxBuildEstimate,
  NxBuildJobEvent,
  NxIosDevice,
  NxMetalToolchainInfo,
  NxPortBuildOptions,
  NxSigningTeam,
} from "@types";
import { WindowManager } from "@main/services/window-manager";
import { AppLogHub } from "@main/services/app-log-hub";
import { CerberusPathsService } from "@main/services/cerberus-paths";
import { NxPathsService } from "./nx-paths";
import { NxScannerService } from "./nx-scanner-service";
import { NxKeyCheckService } from "./nx-keycheck-service";
import { NxHubService } from "./nx-hub-service";
import {
  checkAndroidProfileSupport,
  findAndroidNdkDirectory,
  findGeneratedApk,
  formatPortErrorHint,
  isInvalidPortSourcePath,
  prepareStagingWorkspace,
  sanitizeOutputAppName,
} from "./nx-build-helpers";

export {
  checkAndroidProfileSupport,
  isInvalidPortSourcePath,
  prepareStagingWorkspace,
  sanitizeOutputAppName,
};

const KNOWN_SHADER_COUNTS: Record<string, number> = {
  "0400A3A01EE4C000": 131090, // Pokémon Pokopia
  "040074A01BF12000": 22852, // Donkey Kong Bananza
  "0100F2C0115B6000": 25120, // Zelda TotK
  "01007EF00011E000": 22040, // Zelda BotW
  "010074600E9C0000": 18500, // Xenoblade Chronicles 3
  "0100000000010000": 4820, // Super Mario Odyssey
  "010093801237C000": 1240, // Metroid Dread
  "01006BB00C6F0000": 3900, // Luigi's Mansion 3
  "0100A9D01C446000": 3200, // Mario Wonder
};

export class NxBuildService {
  private static activeProcess: ChildProcess | null = null;
  private static activeJob: NxBuildJobEvent | null = null;
  private static isCancelled = false;
  private static metalCache: { at: number; value: NxMetalToolchainInfo } | null =
    null;
  private static estimateCache = new Map<
    string,
    { at: number; value: NxBuildEstimate }
  >();

  public static getActiveJob(): NxBuildJobEvent | null {
    return this.activeJob;
  }

  public static async detectMetalToolchain(
    force = false
  ): Promise<NxMetalToolchainInfo> {
    if (
      !force &&
      this.metalCache &&
      Date.now() - this.metalCache.at < 60_000
    ) {
      return this.metalCache.value;
    }

    const nxRepo = await NxPathsService.resolveNxnativePath();
    let rawVersion = "";
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/xcrun",
        ["-sdk", "macosx", "metal", "--version"],
        { encoding: "utf8", timeout: 4000 }
      );
      rawVersion = stdout.split(/\r?\n/)[0]?.trim() || "";
    } catch {
      const fallback: NxMetalToolchainInfo = {
        rawVersion: "",
        shortVersion: "Metal Not Found",
        isAvailable: false,
        isVerified: false,
      };
      this.metalCache = { at: Date.now(), value: fallback };
      return fallback;
    }

    if (!rawVersion) {
      const fallback: NxMetalToolchainInfo = {
        rawVersion: "",
        shortVersion: "Metal Not Found",
        isAvailable: false,
        isVerified: false,
      };
      this.metalCache = { at: Date.now(), value: fallback };
      return fallback;
    }

    const verMatch = /version\s+([^\s]+)/i.exec(rawVersion);
    const shortVersion = verMatch
      ? `Metal v${verMatch[1]}`
      : "Metal (Detected)";

    let isVerified = false;
    if (nxRepo.isValid) {
      const lockPath = path.join(
        nxRepo.path,
        "dm",
        "gfx",
        "tools",
        "dmsh_chain.lock"
      );
      if (fs.existsSync(lockPath)) {
        const content = fs.readFileSync(lockPath, "utf8");
        for (const line of content.split(/\r?\n/)) {
          if (line.startsWith("metal_macosx")) {
            const parts = line.split("\t");
            const want = parts[1]?.trim();
            if (want && (rawVersion === want || rawVersion.includes(want))) {
              isVerified = true;
            }
          }
        }
      }
    }

    const result: NxMetalToolchainInfo = {
      rawVersion,
      shortVersion,
      isAvailable: true,
      isVerified,
    };
    this.metalCache = { at: Date.now(), value: result };
    return result;
  }

  public static async estimateBuild(params: {
    titleId?: string | null;
    gameName: string;
    totalSizeBytes: number;
    gameDirectory: string;
    isSwitch2: boolean;
  }): Promise<NxBuildEstimate> {
    const cacheKey = `${params.titleId || ""}|${params.totalSizeBytes}|${params.gameDirectory}|${params.isSwitch2}`;
    const cached = this.estimateCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 30_000) {
      return cached.value;
    }

    const hw = NxPathsService.getHardwareInfo();
    const nxRepo = await NxPathsService.resolveNxnativePath();
    const stagingDir = await NxPathsService.getStagingDirectory();

    const tid = params.titleId?.toUpperCase() || null;

    // 1. Check shader cache (both sanitized per-game staging and flat/gameDirectory)
    const safeGameName = sanitizeOutputAppName(params.gameName);
    let isCached = false;
    const candidateBuildDirs: string[] = [];
    const roots = [
      path.join(stagingDir, safeGameName),
      stagingDir,
      params.gameDirectory,
    ].filter(Boolean);
    for (const root of roots) {
      if (tid) {
        candidateBuildDirs.push(path.join(root, `${tid}_build`));
        candidateBuildDirs.push(path.join(root, `${tid.toLowerCase()}_build`));
      }
      candidateBuildDirs.push(root);
    }
    for (const dir of candidateBuildDirs) {
      const cacheDir = path.join(dir, "shader", "cache");
      if (!fs.existsSync(cacheDir)) continue;
      try {
        const subs = fs.readdirSync(cacheDir).filter((s) => s.startsWith("b-"));
        for (const sub of subs) {
          const files = fs.readdirSync(path.join(cacheDir, sub));
          const metallibs = files.filter((f) => f.endsWith(".metallib")).length;
          if (metallibs >= 50) {
            isCached = true;
            break;
          }
        }
      } catch {
        // ignore
      }
      if (isCached) break;
    }

    // 2. Shader count
    let shaderCount = 0;
    if (tid && KNOWN_SHADER_COUNTS[tid]) {
      shaderCount = KNOWN_SHADER_COUNTS[tid];
    } else if (tid && nxRepo.isValid) {
      const mapPath = path.join(
        nxRepo.path,
        "dm",
        "games",
        tid,
        "shader_map.tsv"
      );
      if (fs.existsSync(mapPath)) {
        const lines = fs
          .readFileSync(mapPath, "utf8")
          .split(/\r?\n/)
          .filter((l) => l.length > 0 && !l.startsWith("#"));
        shaderCount = lines.length;
      }
    }

    if (shaderCount === 0) {
      const gb = Math.max(1, params.totalSizeBytes / (1024 * 1024 * 1024));
      shaderCount = params.isSwitch2
        ? Math.max(3000, Math.round(gb * 1600))
        : Math.max(1200, Math.min(25000, Math.round(gb * 550)));
    }

    if (isCached) {
      const res: NxBuildEstimate = {
        formattedRange: "30s – 1 min",
        isCached: true,
        shaderCount,
        speedCategory: "cached",
        chipName: hw.chipName,
        coreCount: hw.coreCount,
        explanation:
          "Cache pré-compilado detectado! Criação de aplicativo quase instantânea.",
      };
      this.estimateCache.set(cacheKey, { at: Date.now(), value: res });
      return res;
    }

    const upperChip = hw.chipName.toUpperCase();
    const chipMult = upperChip.includes("M4")
      ? 1.65
      : upperChip.includes("M3")
        ? 1.4
        : upperChip.includes("M2")
          ? 1.2
          : upperChip.includes("M1")
            ? 1.0
            : 1.1;

    const effectiveRate = 90 * (hw.coreCount / 8) * chipMult;
    const compileMin = shaderCount / Math.max(effectiveRate, 40);
    const extractMin = (params.totalSizeBytes / (1024 * 1024 * 1024)) * 0.12;
    const totalMin = compileMin + extractMin + 0.6;
    const minMinutes = Math.max(1, Math.floor(totalMin * 0.85));
    const maxMinutes = Math.max(minMinutes + 1, Math.ceil(totalMin * 1.2));

    let formattedRange: string;
    let speedCategory: NxBuildEstimate["speedCategory"];
    if (maxMinutes < 5) {
      formattedRange = "~2 – 5 min";
      speedCategory = "fast";
    } else if (maxMinutes <= 20) {
      formattedRange = `~${minMinutes} – ${maxMinutes} min`;
      speedCategory = "moderate";
    } else if (maxMinutes <= 60) {
      formattedRange = `~${minMinutes} – ${maxMinutes} min`;
      speedCategory = "heavy";
    } else {
      const minH = Math.floor(minMinutes / 60);
      const minR = minMinutes % 60;
      const maxH = Math.floor(maxMinutes / 60);
      const maxR = maxMinutes % 60;
      formattedRange = `~${minH}h${minR ? ` ${minR}m` : ""} – ${maxH}h${maxR ? ` ${maxR}m` : ""}`;
      speedCategory = "veryHeavy";
    }

    const res: NxBuildEstimate = {
      formattedRange,
      isCached: false,
      shaderCount,
      speedCategory,
      chipName: hw.chipName,
      coreCount: hw.coreCount,
      explanation: `Estimativa baseada em ${shaderCount.toLocaleString("pt-BR")} shaders compilados via LLVM Metal no seu ${hw.chipName}.`,
    };
    this.estimateCache.set(cacheKey, { at: Date.now(), value: res });
    return res;
  }

  public static async listIosDevicesAndTeams(force = false): Promise<{
    devices: NxIosDevice[];
    teams: NxSigningTeam[];
  }> {
    return NxHubService.listIosDevicesAndTeams(force);
  }

  private static emitEvent(ev: NxBuildJobEvent): void {
    this.activeJob =
      ev.phase === "done" || ev.phase === "error" || ev.phase === "cancelled"
        ? null
        : ev;
    try {
      WindowManager.sendToAppWindows("on-nx-build-progress", ev);
    } catch {
      // ignore
    }
  }

  public static async startBuild(
    options: NxPortBuildOptions
  ): Promise<{ ok: boolean; jobId?: string; error?: string }> {
    if (this.activeProcess) {
      return {
        ok: false,
        error: "Já existe um processo de port em andamento.",
      };
    }

    const nxRepo = await NxPathsService.resolveNxnativePath();
    if (!nxRepo.isValid) {
      return {
        ok: false,
        error:
          "Repositório nxnative não encontrado. Configure em Ajustes > Switch 1 & 2.",
      };
    }

    if (
      isInvalidPortSourcePath(options.gameDirectory, {
        allowIpa: options.platform === "ios",
      })
    ) {
      return {
        ok: false,
        error:
          "A origem selecionada já é um pacote portado (.app/.framework/.apk). Selecione o arquivo ROM original (.nsp, .nsz, .xci, .nup) ou sua pasta.",
      };
    }

    const scriptRel =
      options.platform === "android"
        ? path.join("scripts", "port_android.py")
        : path.join("scripts", "build_ipa_from_nsp.py");
    const scriptPath = path.join(nxRepo.path, scriptRel);
    if (!fs.existsSync(scriptPath)) {
      return {
        ok: false,
        error: `Script de build não encontrado: ${scriptPath}`,
      };
    }

    const python = NxPathsService.findBestPython(nxRepo.path);
    const pythonPath = python.path || "/usr/bin/python3";

    const [
      outputDir,
      stagingDir,
      appSupportDir,
      nx2aHome,
      cacheRoot,
      prodKeys,
      nx2aRepo,
    ] = await Promise.all([
      options.customOutputFolder?.trim()
        ? Promise.resolve(path.resolve(options.customOutputFolder.trim()))
        : NxPathsService.getOutputDirectory(),
      options.stagingWorkDirectory?.trim()
        ? Promise.resolve(path.resolve(options.stagingWorkDirectory.trim()))
        : NxPathsService.getStagingDirectory(),
      NxPathsService.getAppSupportDirectory(),
      NxPathsService.getNx2AndroidHomeDirectory(),
      CerberusPathsService.getCacheRoot(),
      NxKeyCheckService.resolveProdKeys(),
      options.platform === "android"
        ? NxPathsService.resolveNx2AndroidPath(nxRepo.path)
        : Promise.resolve({ path: "", isValid: true }),
    ]);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    const hw = NxPathsService.getHardwareInfo();
    const resolvedNdk =
      options.platform === "android" ? findAndroidNdkDirectory(nx2aHome) : null;

    if (options.platform === "android") {
      if (!nx2aRepo.isValid) {
        return {
          ok: false,
          error:
            "Repositório nx2android não encontrado. Sincronize nas dependências Android antes de portar.",
        };
      }
      if (!python.hasAndroidModules) {
        return {
          ok: false,
          error:
            "Módulos Python 'pillow' (PIL) e 'pyyaml' ausentes para nx2android. Clique em Instalar Dependências Android/Python acima.",
        };
      }
      if (!resolvedNdk) {
        return {
          ok: false,
          error:
            "Android NDK não encontrado. Clique em Instalar Dependências Android para baixar automaticamente no cache do Cerberus.",
        };
      }
    }

    // Apply OoT patches if targeting Zelda OoT (0400486024DEC000)
    const isOot =
      options.titleId?.toUpperCase() === "0400486024DEC000" ||
      options.gameTitle.toLowerCase().includes("ocarina");
    if (options.platform !== "android" && isOot) {
      const ootScript = path.join(
        nxRepo.path,
        "scripts",
        "apply_oot_patches.py"
      );
      if (fs.existsSync(ootScript)) {
        try {
          await execFileAsync(pythonPath, [ootScript, "--apply", "--soft"], {
            cwd: nxRepo.path,
            timeout: 10000,
            encoding: "utf8",
          });
          AppLogHub.success(
            "build",
            "[OoT Patch] Patches isolados do Zelda OoT aplicados."
          );
        } catch (err) {
          AppLogHub.warn(
            "build",
            `[OoT Patch] Aviso ao aplicar patches: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    const jobId = crypto.randomUUID();
    this.isCancelled = false;

    const baseEv: NxBuildJobEvent = {
      jobId,
      objectId: options.objectId,
      shop: options.shop,
      gameTitle: options.gameTitle,
      platform: options.platform,
      phase: "start",
      fraction: 0,
    };
    this.emitEvent(baseEv);

    if (options.platform === "ios") {
      void (async () => {
        try {
          const res = await NxHubService.buildAndDeployToHub({
            titleId: options.titleId || options.objectId,
            gameTitle: options.gameTitle,
            gameDirectory: options.gameDirectory,
            sourceFiles: options.sourceFiles,
            outputDir,
            stagingDir,
            deviceId: options.iosDeviceId,
            teamId: options.iosSigningTeamId,
            autoDeployToIos: options.autoDeployToIos,
            allowOtherMetal: options.allowOtherMetal,
            isSwitch2: options.isSwitch2,
            isNup: options.isNup,
            onProcessSpawned: (proc) => {
              this.activeProcess = proc;
            },
            onProgress: (ev) => {
              this.emitEvent({
                ...baseEv,
                ...ev,
              });
            },
          });

          this.activeProcess = null;
          if (this.isCancelled) {
            this.emitEvent({
              ...baseEv,
              phase: "cancelled",
              error: "Build cancelado pelo usuário.",
            });
            return;
          }

          if (res.ok) {
            await NxScannerService.scanAndSyncToLibrary();
            this.emitEvent({
              ...baseEv,
              phase: "done",
              fraction: 1,
              outputPath: res.outputPath || outputDir,
            });
          } else {
            this.emitEvent({
              ...baseEv,
              phase: "error",
              error: res.error || "Falha ao portar para o NxN Launcher Hub.",
            });
          }
        } catch (err) {
          this.activeProcess = null;
          this.emitEvent({
            ...baseEv,
            phase: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();

      return { ok: true, jobId };
    }

    const workspace = prepareStagingWorkspace({
      stagingDir,
      gameTitle: options.appName?.trim() || options.gameTitle,
      titleId: options.titleId,
      sourcePath: options.gameDirectory,
      sourceFiles: options.sourceFiles,
    });

    const isDump =
      Boolean(options.isSwitch2) ||
      Boolean(options.isNup) ||
      workspace.isDumpOrNup;

    const cleanName = sanitizeOutputAppName(
      options.appName?.trim() || options.gameTitle
    );

    const args: string[] = [
      scriptPath,
      workspace.inputDir,
      "--progress",
      "json",
    ];
    if (!isDump && prodKeys.path) {
      args.push("-k", prodKeys.path);
    }

    let expectedOutPath: string | undefined;
    const androidWorkDirToInspect = workspace.inputDir;

    if (options.platform === "android") {
      args.push("-o", outputDir, "--jobs", String(hw.coreCount || 8));
      if (cleanName) args.push("--app-name", cleanName);
      if (options.language && options.language !== "auto") {
        args.push("-l", options.language);
      }
      if (options.showFps) args.push("--fps60");

      const support = checkAndroidProfileSupport(
        nx2aRepo.path,
        options.titleId
      );
      const useExperimental =
        Boolean(options.androidExperimental) || !support.supported;
      if (useExperimental) {
        args.push("--experimental");
        if (!options.androidExperimental && !support.supported) {
          AppLogHub.info(
            "nx2android",
            `Jogo (${options.titleId || cleanName}) sem perfil oficial no android.tsv — habilitando automaticamente --experimental.`
          );
        }
      }
    } else {
      args.push(
        "--platform",
        "mac-app",
        "--work-dir",
        workspace.workDir
      );
      if (options.titleId?.trim()) {
        args.push("--title-id", options.titleId.trim().toUpperCase());
      }
      expectedOutPath = path.join(outputDir, `${cleanName}.app`);
      args.push("-o", expectedOutPath);

      if (cleanName) args.push("--app-name", cleanName);
      if (options.bundleId?.trim())
        args.push("--bundle-id", options.bundleId.trim());
      if (options.language && options.language !== "auto") {
        args.push("-l", options.language);
      }
      args.push(options.showFps ? "--show-fps" : "--no-show-fps");
      args.push("--keep-extracted");

      if (options.surveyOnly) args.push("--survey-only");
      if (options.allowOtherMetal) args.push("--allow-other-metal");
    }

    AppLogHub.step(
      "build",
      `Iniciando port de "${options.gameTitle}" (${options.platform}): ${pythonPath} ${args.join(" ")}`
    );

    const bundledEnv = NxPathsService.getBundledPythonEnv({
      pythonPath,
      nxnativeDir: nxRepo.path,
      stagingDir,
      nx2aHome,
      cacheRoot,
    });

    const env: NodeJS.ProcessEnv = {
      ...bundledEnv,
      DM_UPDATE_PROFILE_TABLES: "1",
      TMP: workspace.tempDir,
      TEMP: workspace.tempDir,
      NXNATIVE_DATA_DIR: appSupportDir,
      ...(resolvedNdk ? { ANDROID_NDK_HOME: resolvedNdk } : {}),
    };

    const child = spawn(pythonPath, args, {
      cwd: nxRepo.path,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.activeProcess = child;

    let lastError = "";
    let fullErrorTail = "";
    const handleLine = (rawLine: string, isErr: boolean) => {
      const line = rawLine.trim();
      if (!line) return;
      fullErrorTail = `${fullErrorTail}\n${line}`.slice(-4000);

      if (line.startsWith("{") && line.endsWith("}")) {
        try {
          const ev = JSON.parse(line) as {
            ev?: string;
            name?: string;
            k?: number;
            n?: number;
            step?: string;
            frac?: number;
            done?: number;
            total?: number;
            eta?: number;
            ok?: boolean;
            summary?: string;
            msg?: string;
          };

          if (ev.ev === "stage") {
            const stageName = ev.name || "Processando";
            const k = ev.k || 1;
            const n = ev.n || 1;
            AppLogHub.step("build", `[${k}/${n}] ${stageName}`);
            this.emitEvent({
              ...baseEv,
              phase: "stage",
              stageName,
              stageIndex: k,
              stageTotal: n,
            });
            return;
          }
          if (ev.ev === "step" && ev.step) {
            AppLogHub.info("build", `↳ ${ev.step}`);
            this.emitEvent({
              ...baseEv,
              phase: "step",
              step: ev.step,
            });
            return;
          }
          if (ev.ev === "progress") {
            this.emitEvent({
              ...baseEv,
              phase: "progress",
              fraction: ev.frac ?? 0,
              doneBytes: ev.done,
              totalBytes: ev.total,
              etaSeconds: ev.eta,
            });
            return;
          }
          if (ev.ev === "stage_end") {
            const ok = ev.ok ?? true;
            AppLogHub.append(
              ok ? "success" : "error",
              "build",
              `${ok ? "[OK]" : "[FAIL]"} ${ev.name || ""} ${ev.summary || ""}`
            );
            return;
          }
          if (ev.ev === "say" && ev.msg) {
            const isRed = ev.msg.startsWith("[RED]");
            if (isRed) lastError = ev.msg.slice(5).trim();
            AppLogHub.append(isRed ? "error" : "info", "build", ev.msg);
            return;
          }
        } catch {
          // treat as plain log line
        }
      }

      if (isErr) lastError = line;
      AppLogHub.append(isErr ? "error" : "info", "build", line);
    };

    const rlOut = readline.createInterface({ input: child.stdout });
    const rlErr = readline.createInterface({ input: child.stderr });
    rlOut.on("line", (l) => handleLine(l, false));
    rlErr.on("line", (l) => handleLine(l, true));

    child.on("close", async (code) => {
      this.activeProcess = null;
      workspace.cleanup();
      if (this.isCancelled) {
        AppLogHub.warn(
          "build",
          `Port de "${options.gameTitle}" cancelado pelo usuário.`
        );
        this.emitEvent({
          ...baseEv,
          phase: "cancelled",
          error: "Build cancelado pelo usuário.",
        });
        return;
      }

      if (code === 0) {
        let finalPath =
          expectedOutPath && fs.existsSync(expectedOutPath)
            ? expectedOutPath
            : outputDir;

        if (options.platform === "android") {
          const producedApk = findGeneratedApk([
            outputDir,
            androidWorkDirToInspect,
            workspace.workDir,
          ]);
          if (producedApk) {
            finalPath = producedApk;
          }
        }

        AppLogHub.success(
          "build",
          `Port de "${options.gameTitle}" concluído com sucesso em ${finalPath}`
        );
        await NxScannerService.scanAndSyncToLibrary();
        this.emitEvent({
          ...baseEv,
          phase: "done",
          fraction: 1,
          outputPath: finalPath,
        });
      } else {
        const keyHint = formatPortErrorHint(fullErrorTail);
        const errMsg =
          keyHint ||
          lastError ||
          `O processo de port terminou com código ${code}. Verifique a aba Logs.`;
        AppLogHub.error("build", errMsg);
        this.emitEvent({
          ...baseEv,
          phase: "error",
          error: errMsg,
        });
      }
    });

    child.on("error", (err) => {
      this.activeProcess = null;
      workspace.cleanup();
      AppLogHub.error(
        "build",
        `Erro ao iniciar processo de port: ${err.message}`
      );
      this.emitEvent({
        ...baseEv,
        phase: "error",
        error: err.message,
      });
    });

    return { ok: true, jobId };
  }

  public static cancelBuild(): boolean {
    if (!this.activeProcess) return false;
    this.isCancelled = true;
    AppLogHub.warn("build", "Cancelando processo de port em andamento...");
    this.activeProcess.kill("SIGTERM");
    return true;
  }
}
