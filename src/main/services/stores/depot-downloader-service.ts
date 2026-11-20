import { app } from "electron";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import QRCode from "qrcode";
import { Downloader } from "@shared";
import type { Download, DownloadProgress, StoreDownloadProgress } from "@types";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import {
  CrossOverDetector,
  CrossOverDiscovery,
  DEFAULT_BOTTLE_NAME,
} from "@main/services/crossover";
import { LocalNotificationManager } from "@main/services/notifications/local-notifications";
import { WindowManager } from "@main/services/window-manager";
import { logger } from "@main/services/logger";
import { parseDepotDownloaderLine } from "./depot-downloader-parser";
import { StoreAccountStorage } from "./store-account-storage";

const execFileAsync = promisify(execFile);

const DEPOT_DOWNLOADER_VERSION = "DepotDownloader_3.4.0";

const sanitizeFolderName = (title: string, appId: string) => {
  const safe = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${safe || `SteamApp`}_${appId}`;
};

interface ActiveDepotDownload {
  appId: string;
  title: string;
  targetDir: string;
  child?: ChildProcess;
  cancelled: boolean;
  progress: StoreDownloadProgress;
}

class DepotDownloaderServiceImpl {
  private readonly storage = new StoreAccountStorage();
  private readonly activeDownloads = new Map<string, ActiveDepotDownload>();

  private getToolDir(): string {
    const dir = path.join(app.getPath("userData"), "stores", "depotdownloader");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  public getBinaryPath(): string {
    return path.join(this.getToolDir(), "DepotDownloader");
  }

  private getDownloadUrl(): string {
    const archAsset =
      process.arch === "arm64"
        ? "DepotDownloader-macos-arm64.zip"
        : "DepotDownloader-macos-x64.zip";
    return `https://github.com/SteamRE/DepotDownloader/releases/download/${DEPOT_DOWNLOADER_VERSION}/${archAsset}`;
  }

  private hasCachedCredentials(): boolean {
    const configPath = path.join(this.getToolDir(), "DepotDownloader.config");
    if (!fs.existsSync(configPath)) return false;
    try {
      return fs.statSync(configPath).size > 20;
    } catch {
      return false;
    }
  }

  public getActiveDownloads(): StoreDownloadProgress[] {
    return Array.from(this.activeDownloads.values()).map((d) => d.progress);
  }

  private async emitProgress(
    entry: ActiveDepotDownload,
    downloadRecord?: Download | null
  ): Promise<void> {
    WindowManager.sendToAppWindows(
      "on-store-download-progress",
      entry.progress
    );

    if (!downloadRecord) return;
    const gameId = levelKeys.game("steam", entry.appId);
    const packet: DownloadProgress = {
      downloadSpeed: entry.progress.speedBytesPerSecond ?? 0,
      timeRemaining: -1,
      numPeers: 0,
      numSeeds: 0,
      isDownloadingMetadata: entry.progress.status === "preparing",
      isCheckingFiles: false,
      progress: entry.progress.progress,
      gameId,
      download: downloadRecord,
    };
    WindowManager.sendToAppWindows("on-download-progress", packet);
  }

  public async ensureBinary(
    onStatus?: (message: string) => void
  ): Promise<string> {
    const binPath = this.getBinaryPath();
    if (fs.existsSync(binPath)) return binPath;

    const toolDir = this.getToolDir();
    const zipPath = path.join(toolDir, "DepotDownloader.zip");
    const url = this.getDownloadUrl();

    onStatus?.("Baixando DepotDownloader oficial (macOS)...");
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(
        `Falha ao baixar DepotDownloader (${response.status} ${response.statusText})`
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(zipPath, buffer);

    onStatus?.("Extraindo DepotDownloader...");
    await execFileAsync("/usr/bin/unzip", ["-o", zipPath, "-d", toolDir]);
    await fs.promises.rm(zipPath, { force: true }).catch(() => {});

    if (!fs.existsSync(binPath)) {
      throw new Error("DepotDownloader não encontrado após extração");
    }

    await fs.promises.chmod(binPath, 0o755);
    await execFileAsync("/usr/bin/xattr", [
      "-d",
      "com.apple.quarantine",
      binPath,
    ]).catch(() => {});

    return binPath;
  }

  public async startSteamDownload(params: {
    appId: string;
    title: string;
    username?: string;
    password?: string;
    useQr?: boolean;
    installBaseDir?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const { appId, title } = params;
    if (this.activeDownloads.has(appId)) {
      return { ok: true };
    }

    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    const baseDir =
      params.installBaseDir?.trim() ||
      path.join(bottlesDir, DEFAULT_BOTTLE_NAME, "drive_c", "Games", "Steam");
    const folderName = sanitizeFolderName(title, appId);
    const targetDir = path.join(baseDir, folderName);
    await fs.promises.mkdir(targetDir, { recursive: true });

    const gameKey = levelKeys.game("steam", appId);
    let downloadRecord: Download = {
      shop: "steam",
      objectId: appId,
      uri: `steam://depot/${appId}`,
      folderName,
      downloadPath: baseDir,
      progress: 0,
      downloader: Downloader.Steam,
      bytesDownloaded: 0,
      fileSize: null,
      shouldSeed: false,
      status: "active",
      queued: false,
      timestamp: Date.now(),
      extracting: false,
      automaticallyExtract: false,
      automaticallyDeleteArchiveFiles: false,
    };
    await downloadsSublevel.put(gameKey, downloadRecord);

    const entry: ActiveDepotDownload = {
      appId,
      title,
      targetDir,
      cancelled: false,
      progress: {
        provider: "steam",
        storeId: appId,
        title,
        status: "preparing",
        progress: 0,
        message: "Preparando DepotDownloader...",
        installPath: targetDir,
      },
    };
    this.activeDownloads.set(appId, entry);
    void this.emitProgress(entry, downloadRecord);

    try {
      const binPath = await this.ensureBinary((message) => {
        entry.progress = { ...entry.progress, message };
        void this.emitProgress(entry, downloadRecord);
      });

      if (entry.cancelled) {
        return { ok: false, error: "cancelled" };
      }

      const storedAccount = this.storage.getSteam();
      const username = params.username?.trim() || storedAccount?.accountName;
      const useQr =
        Boolean(params.useQr) ||
        (!params.password && (!username || !this.hasCachedCredentials()));

      const args = [
        "-app",
        appId,
        "-os",
        "windows",
        "-dir",
        targetDir,
        "-remember-password",
        "-max-downloads",
        "8",
      ];

      if (useQr) {
        args.push("-qr");
      } else if (username) {
        args.push("-username", username);
        if (params.password) {
          args.push("-password", params.password);
        }
      }

      entry.progress = {
        ...entry.progress,
        status: "downloading",
        message: "Conectando aos servidores Steam...",
      };
      void this.emitProgress(entry, downloadRecord);

      const child = spawn(binPath, args, {
        cwd: this.getToolDir(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      entry.child = child;

      const lineBuffers = { stdout: "", stderr: "" };
      let lastPersistTime = 0;
      let totalDownloadedBytes = 0;

      const handleLine = async (rawLine: string) => {
        const parsed = parseDepotDownloaderLine(rawLine);

        if (parsed.qrUrl) {
          const qrDataUrl = await QRCode.toDataURL(parsed.qrUrl, {
            width: 240,
            margin: 1,
          }).catch(() => undefined);
          entry.progress = {
            ...entry.progress,
            status: "needs-input",
            prompt: "steam-guard",
            qrDataUrl,
            message:
              "Escaneie este QR Code com o app Steam Mobile para autorizar o download.",
          };
          void this.emitProgress(entry, downloadRecord);
          return;
        }

        if (parsed.prompt) {
          entry.progress = {
            ...entry.progress,
            status: "needs-input",
            prompt: parsed.prompt,
            message: parsed.message,
          };
          void this.emitProgress(entry, downloadRecord);
          return;
        }

        if (typeof parsed.totalBytes === "number") {
          totalDownloadedBytes = parsed.totalBytes;
        }

        if (typeof parsed.progress === "number" || parsed.message) {
          const nextProgress =
            typeof parsed.progress === "number"
              ? Math.max(entry.progress.progress, parsed.progress)
              : entry.progress.progress;
          entry.progress = {
            ...entry.progress,
            status: "downloading",
            progress: nextProgress,
            bytesDownloaded:
              totalDownloadedBytes || entry.progress.bytesDownloaded,
            qrDataUrl: undefined,
            prompt: undefined,
            message: parsed.message ?? entry.progress.message,
          };

          downloadRecord = {
            ...downloadRecord,
            progress: nextProgress,
            bytesDownloaded:
              totalDownloadedBytes || downloadRecord.bytesDownloaded,
            status: "active",
          };
          const now = Date.now();
          if (now - lastPersistTime > 1_000) {
            lastPersistTime = now;
            void downloadsSublevel.put(gameKey, downloadRecord).catch(() => {});
          }
          void this.emitProgress(entry, downloadRecord);
        }
      };

      const feedChunk = (stream: "stdout" | "stderr", chunk: Buffer) => {
        lineBuffers[stream] += chunk.toString("utf8");
        const parts = lineBuffers[stream].split(/[\r\n]+/);
        lineBuffers[stream] = parts.pop() ?? "";
        for (const line of parts) {
          if (line.trim()) void handleLine(line);
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => feedChunk("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => feedChunk("stderr", chunk));

      void new Promise<void>((resolveExit) => {
        child.on("close", async (code) => {
          this.activeDownloads.delete(appId);
          if (entry.cancelled) {
            downloadRecord = {
              ...downloadRecord,
              status: "removed",
            };
            await downloadsSublevel.del(gameKey).catch(() => {});
            entry.progress = {
              ...entry.progress,
              status: "cancelled",
            };
            await this.emitProgress(entry);
            resolveExit();
            return;
          }

          if (code === 0) {
            const exes = await CrossOverDiscovery.findExecutablesInDir(
              targetDir,
              0,
              4
            );
            const mainExe =
              exes.length > 0
                ? CrossOverDiscovery.pickPrimaryExecutable(title, exes)
                : null;

            downloadRecord = {
              ...downloadRecord,
              progress: 1,
              bytesDownloaded:
                totalDownloadedBytes || downloadRecord.bytesDownloaded,
              fileSize: totalDownloadedBytes || downloadRecord.fileSize,
              status: "complete",
            };
            await downloadsSublevel
              .put(gameKey, downloadRecord)
              .catch(() => {});

            const existingGame = await gamesSublevel
              .get(gameKey)
              .catch(() => null);
            if (existingGame) {
              await gamesSublevel.put(gameKey, {
                ...existingGame,
                executablePath: mainExe ?? existingGame.executablePath ?? null,
                executablePathUpdatedAt: mainExe
                  ? new Date()
                  : (existingGame.executablePathUpdatedAt ?? null),
                installedSizeInBytes:
                  totalDownloadedBytes || existingGame.installedSizeInBytes,
                macOSCompatibility: existingGame.macOSCompatibility ?? {
                  bottleName: DEFAULT_BOTTLE_NAME,
                  graphicsBackend: "d3dmetal",
                  syncMode: "msync",
                },
              });
            }

            entry.progress = {
              ...entry.progress,
              status: "completed",
              progress: 1,
              installPath: targetDir,
              message: "Download concluído!",
            };
            await this.emitProgress(entry, downloadRecord);
            await LocalNotificationManager.createNotification(
              "DOWNLOAD_COMPLETE",
              `${title} baixado da Steam`,
              mainExe
                ? "Jogo instalado e pronto para jogar no Red Wine."
                : "Download concluído. Selecione o executável nas opções se necessário."
            ).catch(() => {});
            WindowManager.sendToAppWindows("on-library-batch-complete");
          } else {
            const errMsg = `DepotDownloader encerrou com código ${code}`;
            downloadRecord = {
              ...downloadRecord,
              status: "error",
            };
            await downloadsSublevel
              .put(gameKey, downloadRecord)
              .catch(() => {});
            entry.progress = {
              ...entry.progress,
              status: "error",
              error: errMsg,
              message: errMsg,
            };
            await this.emitProgress(entry, downloadRecord);
          }

          resolveExit();
        });
      });

      return { ok: true };
    } catch (err) {
      this.activeDownloads.delete(appId);
      const message =
        err instanceof Error ? err.message : "Erro ao iniciar DepotDownloader";
      logger.error("[DepotDownloader] Start failed", err);
      entry.progress = {
        ...entry.progress,
        status: "error",
        error: message,
        message,
      };
      downloadRecord = { ...downloadRecord, status: "error" };
      await downloadsSublevel.put(gameKey, downloadRecord).catch(() => {});
      void this.emitProgress(entry, downloadRecord);
      return { ok: false, error: message };
    }
  }

  public submitInput(appId: string, value: string): boolean {
    const entry = this.activeDownloads.get(appId);
    if (!entry?.child?.stdin?.writable) return false;
    entry.child.stdin.write(`${value}\n`);
    entry.progress = {
      ...entry.progress,
      status: "downloading",
      prompt: undefined,
      qrDataUrl: undefined,
      message: "Código enviado...",
    };
    void this.emitProgress(entry);
    return true;
  }

  public async cancelDownload(appId: string): Promise<void> {
    const entry = this.activeDownloads.get(appId);
    if (entry) {
      entry.cancelled = true;
      entry.child?.kill("SIGTERM");
    }
    const gameKey = levelKeys.game("steam", appId);
    await downloadsSublevel.del(gameKey).catch(() => {});
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }
}

export const DepotDownloaderService = new DepotDownloaderServiceImpl();
