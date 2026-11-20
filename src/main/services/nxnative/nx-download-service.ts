import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Download, Game, SwitchGeneration, UserPreferences } from "@types";
import { Downloader, getDownloadersForUri } from "@shared";
import {
  db,
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import {
  DownloadManager,
  DownloadOrchestrator,
  WindowManager,
} from "@main/services";
import { updateGameRecord } from "@main/services/game-record-updater";
import { getGlobalTrackers } from "@main/helpers";
import { AppLogHub } from "@main/services/app-log-hub";
import { NxArtworkService } from "./nx-artwork-service";
import { NxCloudScraperService } from "./nx-cloud-scraper-service";
import { baseApplicationTitleId } from "./nx-core-parsers";

export interface StartSwitchDownloadParams {
  titleId?: string | null;
  title: string;
  generation: SwitchGeneration;
  streamUrl?: string;
  directUri?: string;
}

export interface StartSwitchDownloadResult {
  ok: boolean;
  fallbackBrowser?: boolean;
  url?: string;
  error?: string;
  downloader?: Downloader;
  gameKey?: string;
}

const DIRECT_HOSTERS = new Set<Downloader>([
  Downloader.Gofile,
  Downloader.PixelDrain,
  Downloader.Datanodes,
  Downloader.Mediafire,
  Downloader.FuckingFast,
  Downloader.VikingFile,
  Downloader.Rootz,
  Downloader.FileKeeper,
  Downloader.ArchiveOrg,
]);

function pickDownloaderForUri(uri: string): Downloader {
  const lower = uri.trim().toLowerCase();
  if (lower.startsWith("magnet:") || lower.endsWith(".torrent")) {
    return Downloader.Torrent;
  }

  const supported = getDownloadersForUri(uri).filter((d) =>
    DIRECT_HOSTERS.has(d)
  );
  if (supported.length > 0) {
    return supported[0];
  }

  return Downloader.DirectHttp;
}

async function resolveSwitchDownloadDestination(
  generation: SwitchGeneration
): Promise<string> {
  let prefs: UserPreferences | null = null;
  try {
    prefs = (await db.get<string, UserPreferences>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })) as UserPreferences;
  } catch {
    prefs = null;
  }

  const configuredFolders =
    generation === "switch2"
      ? prefs?.switch2RomFolders
      : prefs?.switch1RomFolders;

  const firstExisting = configuredFolders?.find(
    (dir) => dir.trim().length > 0 && fs.existsSync(dir.trim())
  );
  if (firstExisting) return firstExisting.trim();

  const firstConfigured = configuredFolders?.find(
    (dir) => dir.trim().length > 0
  );
  if (firstConfigured) {
    await fsp.mkdir(firstConfigured.trim(), { recursive: true });
    return firstConfigured.trim();
  }

  const defaultDir = path.join(
    os.homedir(),
    "Downloads",
    "Cerberus",
    generation === "switch2" ? "Switch 2" : "Switch 1"
  );
  await fsp.mkdir(defaultDir, { recursive: true });

  const updatedPrefs: UserPreferences = {
    ...(prefs ?? {}),
    ...(generation === "switch2"
      ? { switch2RomFolders: [defaultDir] }
      : { switch1RomFolders: [defaultDir] }),
  };
  await db
    .put(levelKeys.userPreferences, updatedPrefs, { valueEncoding: "json" })
    .catch(() => {});

  return defaultDir;
}

/**
 * Resolves Switch 1 / 2 portal links and queues native Cerberus downloads
 * via WebTorrent, supported hosters, or `Downloader.DirectHttp`.
 */
export class NxDownloadService {
  public static async startSwitchGameDownload(
    params: StartSwitchDownloadParams
  ): Promise<StartSwitchDownloadResult> {
    const rawUri = params.directUri?.trim() || params.streamUrl?.trim();
    if (!rawUri) {
      return {
        ok: false,
        fallbackBrowser: false,
        error: "Nenhum link de download informado.",
      };
    }

    let candidateUris: string[] = [rawUri];
    if (!params.directUri?.trim()) {
      const resolved =
        await NxCloudScraperService.resolveFinalDownloadLink(rawUri);
      if (!resolved.ok) {
        return {
          ok: false,
          fallbackBrowser: resolved.fallbackBrowser,
          url: resolved.url,
          error: resolved.reason,
        };
      }
      candidateUris =
        resolved.allCandidates && resolved.allCandidates.length > 0
          ? resolved.allCandidates
          : [resolved.url];
    }

    const rawTid = params.titleId?.trim().toUpperCase() || null;
    const normalizedTid = rawTid
      ? (baseApplicationTitleId(rawTid) ?? rawTid)
      : null;
    const shop: SwitchGeneration = normalizedTid?.startsWith("0400")
      ? "switch2"
      : params.generation;
    const objectId =
      normalizedTid ||
      `nx_${params.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")}`;
    const gameKey = levelKeys.game(shop, objectId);
    const downloadPath = await resolveSwitchDownloadDestination(shop);

    const [coverUrl, heroUrl] = await Promise.all([
      NxArtworkService.resolveCoverForGame({
        titleId: normalizedTid,
        title: params.title,
        objectId,
      }),
      NxArtworkService.resolveHeroForGame({
        titleId: normalizedTid,
        title: params.title,
        objectId,
      }),
    ]);

    const existingGame = await gamesSublevel.get(gameKey).catch(() => null);
    if (existingGame) {
      await updateGameRecord(gameKey, (current) => ({
        ...current,
        title: current.title || params.title,
        isDeleted: false,
        switchTitleId: normalizedTid ?? current.switchTitleId ?? null,
        switchGeneration: shop,
        iconUrl: current.iconUrl || coverUrl,
        libraryHeroImageUrl: current.libraryHeroImageUrl || heroUrl || coverUrl,
      }));
    } else {
      const newGame: Game = {
        title: params.title,
        iconUrl: coverUrl,
        libraryHeroImageUrl: heroUrl ?? coverUrl,
        logoImageUrl: null,
        playTimeInMilliseconds: 0,
        lastTimePlayed: null,
        addedToLibraryAt: new Date(),
        objectId,
        shop,
        remoteId: null,
        isDeleted: false,
        platform: shop === "switch2" ? "Nintendo Switch 2" : "Nintendo Switch",
        executablePath: null,
        installedSizeInBytes: null,
        switchTitleId: normalizedTid,
        switchGeneration: shop,
      };
      await gamesSublevel.put(gameKey, newGame);
    }

    if (coverUrl || heroUrl) {
      await gamesShopAssetsSublevel.put(gameKey, {
        objectId,
        shop,
        title: params.title,
        iconUrl: coverUrl,
        libraryHeroImageUrl: heroUrl ?? coverUrl,
        libraryImageUrl: coverUrl ?? heroUrl,
        logoImageUrl: null,
        logoPosition: null,
        coverImageUrl: coverUrl ?? heroUrl,
        downloadSources: [],
        updatedAt: Date.now(),
      });
    }

    const globalTrackers = await getGlobalTrackers().catch(() => []);
    let lastErrorMessage = "Falha ao iniciar download.";
    let lastAttemptedUri = candidateUris[0];
    let lastDownloader = pickDownloaderForUri(lastAttemptedUri);

    for (const candidateUri of candidateUris) {
      lastAttemptedUri = candidateUri;
      const downloader = pickDownloaderForUri(candidateUri);
      lastDownloader = downloader;
      const automaticallyExtract = /\.(zip|rar|7z)(\?|#|$)/i.test(candidateUri);

      const download: Download = {
        shop,
        objectId,
        status: "paused",
        progress: 0,
        bytesDownloaded: 0,
        downloadPath,
        downloader,
        uri: candidateUri,
        folderName: null,
        shouldSeed: false,
        timestamp: Date.now(),
        queued: false,
        pinnedToHero: false,
        extracting: false,
        automaticallyExtract,
        automaticallyDeleteArchiveFiles: false,
        fileSize: null,
        customTrackers: globalTrackers,
      };

      try {
        await DownloadOrchestrator.validateDownloadOrMarkPending(download);
        await DownloadManager.cancelDownload(gameKey).catch(() => null);
        await downloadsSublevel.put(gameKey, download);
        await DownloadOrchestrator.startPreparedDownload(download);

        WindowManager.sendDownloadsUpdated();
        AppLogHub.info(
          "nxnative",
          `Download nativo Switch iniciado: "${params.title}" -> ${downloadPath} (downloader=${Downloader[downloader]}, uri=${candidateUri}).`
        );
        return { ok: true, downloader, gameKey };
      } catch (err) {
        await downloadsSublevel.del(gameKey).catch(() => null);
        lastErrorMessage = err instanceof Error ? err.message : String(err);
        AppLogHub.warn(
          "nxnative",
          `Mirror Switch falhou para "${params.title}" (${candidateUri}): ${lastErrorMessage}`
        );
      }
    }

    if (lastDownloader === Downloader.DirectHttp) {
      return {
        ok: false,
        fallbackBrowser: true,
        url: rawUri,
        error: lastErrorMessage,
      };
    }
    return {
      ok: false,
      fallbackBrowser: false,
      url: lastAttemptedUri,
      error: lastErrorMessage,
    };
  }
}
