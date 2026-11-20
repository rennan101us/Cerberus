import fs from "node:fs";
import path from "node:path";
import { Downloader } from "@shared";
import type {
  Download,
  DownloadProgress,
  StoreDownloadProgress,
} from "@types";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { EpicDownloadProgressParser } from "@main/services/epic/download";
import {
  CrossOverDetector,
  CrossOverDiscovery,
  DEFAULT_BOTTLE_NAME,
} from "@main/services/crossover";
import { LocalNotificationManager } from "@main/services/notifications/local-notifications";
import { WindowManager } from "@main/services/window-manager";
import { logger } from "@main/services/logger";
import { getLegendaryConfigDir, runLegendary } from "./legendary-cli";
import { EpicStoreService } from "./epic-store-service";

interface ActiveEpicDownload {
  appName: string;
  title: string;
  abortController: AbortController;
  cancelled: boolean;
  progress: StoreDownloadProgress;
}

interface LegendaryDryRunJson {
  game_directory?: string;
  game_executable?: string;
  working_directory?: string;
  game_parameters?: string[];
  user_parameters?: string[];
  egl_parameters?: string[];
  environment?: Record<string, string>;
}

class EpicDownloadServiceImpl {
  private readonly activeDownloads = new Map<string, ActiveEpicDownload>();

  public getActiveDownloads(): StoreDownloadProgress[] {
    return Array.from(this.activeDownloads.values()).map((d) => d.progress);
  }

  private emitProgress(
    entry: ActiveEpicDownload,
    downloadRecord?: Download | null
  ) {
    WindowManager.sendToAppWindows("on-store-download-progress", entry.progress);

    if (!downloadRecord) return;
    const gameId = levelKeys.game("epic", entry.appName);
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

  public async startDownload(params: {
    appName: string;
    title: string;
    installBaseDir?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const { appName, title } = params;
    if (this.activeDownloads.has(appName)) {
      return { ok: true };
    }

    const account = EpicStoreService.getAccount();
    if (!account.connected) {
      return { ok: false, error: "Conta Epic Games não conectada" };
    }

    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    const baseDir =
      params.installBaseDir?.trim() ||
      path.join(bottlesDir, DEFAULT_BOTTLE_NAME, "drive_c", "Games", "Epic");
    await fs.promises.mkdir(baseDir, { recursive: true });

    const gameKey = levelKeys.game("epic", appName);
    let downloadRecord: Download = {
      shop: "epic",
      objectId: appName,
      uri: `epic://${appName}`,
      folderName: appName,
      downloadPath: baseDir,
      progress: 0,
      downloader: Downloader.Epic,
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

    const abortController = new AbortController();
    const entry: ActiveEpicDownload = {
      appName,
      title,
      abortController,
      cancelled: false,
      progress: {
        provider: "epic",
        storeId: appName,
        title,
        status: "preparing",
        progress: 0,
        message: "Preparando download na Epic Games...",
      },
    };
    this.activeDownloads.set(appName, entry);
    this.emitProgress(entry, downloadRecord);

    const parser = new EpicDownloadProgressParser(0, 0, 0);
    let lastPersistTime = 0;

    void runLegendary(
      [
        "-y",
        "install",
        appName,
        "--platform",
        "Windows",
        "--base-path",
        baseDir,
        "--skip-sdl",
        "--skip-dlcs",
      ],
      {
        signal: abortController.signal,
        onLine: (line) => {
          parser.line(line);
          const s = parser.state;
          entry.progress = {
            ...entry.progress,
            status: s.preparing ? "preparing" : "downloading",
            progress: s.progress,
            bytesDownloaded: s.bytesDownloaded,
            fileSize: s.fileSize > 0 ? s.fileSize : undefined,
            speedBytesPerSecond: s.downloadSpeed,
            message: line.trim(),
          };
          downloadRecord = {
            ...downloadRecord,
            progress: s.progress,
            bytesDownloaded: s.bytesDownloaded,
            fileSize: s.fileSize > 0 ? s.fileSize : downloadRecord.fileSize,
            status: "active",
          };
          const now = Date.now();
          if (now - lastPersistTime > 1_000) {
            lastPersistTime = now;
            void downloadsSublevel.put(gameKey, downloadRecord).catch(() => {});
          }
          this.emitProgress(entry, downloadRecord);
        },
      }
    )
      .then(async (res) => {
        this.activeDownloads.delete(appName);

        if (entry.cancelled) {
          await downloadsSublevel.del(gameKey).catch(() => {});
          entry.progress = { ...entry.progress, status: "cancelled" };
          this.emitProgress(entry);
          return;
        }

        if (res.code === 0 && !parser.state.failed) {
          const installed = EpicStoreService.readInstalledMap()[appName];
          let resolvedExe: string | null = null;
          if (installed?.install_path && installed?.executable) {
            const fullExe = path.join(
              installed.install_path,
              installed.executable.replace(/\\/g, path.sep)
            );
            if (fs.existsSync(fullExe)) {
              resolvedExe = fullExe;
            }
          }
          if (!resolvedExe && installed?.install_path) {
            const exes = await CrossOverDiscovery.findExecutablesInDir(
              installed.install_path,
              0,
              4
            );
            if (exes.length > 0) {
              resolvedExe = CrossOverDiscovery.pickPrimaryExecutable(title, exes);
            }
          }

          downloadRecord = {
            ...downloadRecord,
            progress: 1,
            bytesDownloaded:
              parser.state.fileSize || downloadRecord.bytesDownloaded,
            fileSize: parser.state.fileSize || downloadRecord.fileSize,
            folderName: installed?.install_path
              ? path.basename(installed.install_path)
              : appName,
            status: "complete",
          };
          await downloadsSublevel.put(gameKey, downloadRecord).catch(() => {});

          const existingGame = await gamesSublevel.get(gameKey).catch(() => null);
          if (existingGame) {
            await gamesSublevel.put(gameKey, {
              ...existingGame,
              executablePath: resolvedExe ?? existingGame.executablePath ?? null,
              executablePathUpdatedAt: resolvedExe
                ? new Date()
                : existingGame.executablePathUpdatedAt ?? null,
              installedSizeInBytes:
                installed?.install_size ??
                (parser.state.fileSize || existingGame.installedSizeInBytes),
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
            installPath: installed?.install_path,
            message: "Download Epic concluído!",
          };
          this.emitProgress(entry, downloadRecord);
          await LocalNotificationManager.createNotification(
            "DOWNLOAD_COMPLETE",
            `${title} baixado da Epic Games`,
            "Jogo instalado e pronto para jogar no Red Wine."
          ).catch(() => {});
          WindowManager.sendToAppWindows("on-library-batch-complete");
        } else {
          const errMsg = `Download Epic falhou (código ${res.code})`;
          downloadRecord = { ...downloadRecord, status: "error" };
          await downloadsSublevel.put(gameKey, downloadRecord).catch(() => {});
          entry.progress = {
            ...entry.progress,
            status: "error",
            error: errMsg,
            message: errMsg,
          };
          this.emitProgress(entry, downloadRecord);
        }
      })
      .catch(async (err) => {
        this.activeDownloads.delete(appName);
        const msg = err instanceof Error ? err.message : "Erro ao baixar da Epic";
        logger.error("[EpicDownload] Failed", err);
        downloadRecord = { ...downloadRecord, status: "error" };
        await downloadsSublevel.put(gameKey, downloadRecord).catch(() => {});
        entry.progress = {
          ...entry.progress,
          status: "error",
          error: msg,
          message: msg,
        };
        this.emitProgress(entry, downloadRecord);
      });

    return { ok: true };
  }

  public async cancelDownload(appName: string): Promise<void> {
    const entry = this.activeDownloads.get(appName);
    if (entry) {
      entry.cancelled = true;
      entry.abortController.abort();
    }
    await downloadsSublevel.del(levelKeys.game("epic", appName)).catch(() => {});
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  public async getLaunchParameters(appName: string): Promise<{
    args: string[];
    env: Record<string, string>;
  } | null> {
    const installedPath = path.join(getLegendaryConfigDir(), "installed.json");
    if (!fs.existsSync(installedPath)) return null;

    let res = await runLegendary(["launch", appName, "--dry-run", "--json"]).catch(
      () => null
    );
    if (!res || res.code !== 0) {
      res = await runLegendary([
        "launch",
        appName,
        "--dry-run",
        "--json",
        "--offline",
      ]).catch(() => null);
    }
    if (!res || res.code !== 0) return null;

    try {
      const parsed = JSON.parse(res.stdout) as LegendaryDryRunJson;
      const args = [
        ...(Array.isArray(parsed.game_parameters) ? parsed.game_parameters : []),
        ...(Array.isArray(parsed.user_parameters) ? parsed.user_parameters : []),
        ...(Array.isArray(parsed.egl_parameters) ? parsed.egl_parameters : []),
      ];
      return {
        args,
        env: parsed.environment ?? {},
      };
    } catch {
      return null;
    }
  }
}

export const EpicDownloadService = new EpicDownloadServiceImpl();
