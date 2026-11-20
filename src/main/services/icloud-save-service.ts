import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import type {
  GameShop,
  ICloudGameSaveInfo,
  ICloudSaveStatus,
  UserPreferences,
} from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { Ludusavi } from "./ludusavi";
import {
  CrossOverDetector,
  DEFAULT_BOTTLE_NAME,
} from "./crossover/crossover-detector";
import { logger } from "./logger";

interface ICloudSaveMetadata {
  shop: GameShop;
  objectId: string;
  title: string;
  lastSyncedAt: string;
  fileCount: number;
  totalBytes: number;
  customSavePath?: string | null;
}

function getICloudDocsRoot(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Mobile Documents",
    "com~apple~CloudDocs"
  );
}

function getCerberusICloudRoot(): string {
  return path.join(getICloudDocsRoot(), "Cerberus Launcher", "Windows Saves");
}

function sanitizeSegment(input: string): string {
  return input
    .replace(/[:/\\?*"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function getFolderStats(dir: string): {
  fileCount: number;
  totalBytes: number;
} {
  if (!fs.existsSync(dir)) return { fileCount: 0, totalBytes: 0 };
  let fileCount = 0;
  let totalBytes = 0;

  const walk = (target: string) => {
    try {
      const stat = fs.statSync(target);
      if (stat.isFile()) {
        const base = path.basename(target);
        if (base === ".DS_Store" || base === "cerberus-icloud-meta.json")
          return;
        fileCount += 1;
        totalBytes += stat.size;
      } else if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(target)) {
          walk(path.join(target, entry));
        }
      }
    } catch {
      // ignore inaccessible files
    }
  };
  walk(dir);
  return { fileCount, totalBytes };
}

export class ICloudSaveService {
  public static getStatus(): ICloudSaveStatus {
    const docsRoot = getICloudDocsRoot();
    const rootPath = getCerberusICloudRoot();

    if (process.platform !== "darwin" || !fs.existsSync(docsRoot)) {
      return {
        available: false,
        rootPath,
        writable: false,
        error: "iCloud Drive não detectado neste Mac.",
      };
    }

    try {
      fs.mkdirSync(rootPath, { recursive: true });
      const probe = path.join(rootPath, `.cerberus-probe-${Date.now()}`);
      fs.writeFileSync(probe, "ok", "utf8");
      fs.unlinkSync(probe);
      return {
        available: true,
        rootPath,
        writable: true,
      };
    } catch (err) {
      return {
        available: true,
        rootPath,
        writable: false,
        error:
          err instanceof Error
            ? err.message
            : "Sem permissão de escrita no iCloud Drive.",
      };
    }
  }

  private static async resolveEffectiveWinePrefix(
    shop: GameShop,
    objectId: string
  ): Promise<string | null> {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => undefined);
    if (game?.winePrefixPath && fs.existsSync(game.winePrefixPath)) {
      return game.winePrefixPath;
    }

    const prefs = (await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null)) as UserPreferences | null;
    if (
      prefs?.defaultWinePrefixPath &&
      fs.existsSync(prefs.defaultWinePrefixPath)
    ) {
      return prefs.defaultWinePrefixPath;
    }

    const bottlesDir = await CrossOverDetector.getBottlesDirectory().catch(
      () => null
    );
    if (!bottlesDir) return null;
    const bottles = await CrossOverDetector.listBottles(bottlesDir).catch(
      () => []
    );
    const headBottleName =
      bottles.find(
        (b) => b.toLowerCase() === DEFAULT_BOTTLE_NAME.toLowerCase()
      ) ?? bottles[0];
    return headBottleName ? path.join(bottlesDir, headBottleName) : null;
  }

  public static async getGameFolder(
    shop: GameShop,
    objectId: string
  ): Promise<string> {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => undefined);
    const safeTitle = sanitizeSegment(game?.title || objectId).slice(0, 64);
    const folderName = `${safeTitle} [${shop}_${sanitizeSegment(objectId)}]`;
    return path.join(getCerberusICloudRoot(), folderName);
  }

  private static readMetadata(folderPath: string): ICloudSaveMetadata | null {
    const metaPath = path.join(folderPath, "cerberus-icloud-meta.json");
    if (!fs.existsSync(metaPath)) return null;
    try {
      return JSON.parse(
        fs.readFileSync(metaPath, "utf8")
      ) as ICloudSaveMetadata;
    } catch {
      return null;
    }
  }

  private static writeMetadata(
    folderPath: string,
    meta: ICloudSaveMetadata
  ): void {
    fs.mkdirSync(folderPath, { recursive: true });
    fs.writeFileSync(
      path.join(folderPath, "cerberus-icloud-meta.json"),
      JSON.stringify(meta, null, 2),
      "utf8"
    );
  }

  public static async getGameSaveInfo(
    shop: GameShop,
    objectId: string
  ): Promise<ICloudGameSaveInfo> {
    const status = this.getStatus();
    const icloudFolderPath = await this.getGameFolder(shop, objectId);
    const winePrefixUsed = await this.resolveEffectiveWinePrefix(
      shop,
      objectId
    );
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => undefined);

    const meta = this.readMetadata(icloudFolderPath);
    const backupStats = getFolderStats(icloudFolderPath);

    let localFileCount = 0;
    let localTotalBytes = 0;
    let customSavePath: string | null = meta?.customSavePath ?? null;
    const localSavePaths: string[] = [];

    try {
      await Ludusavi.copyConfigFileToUserData();
      await Ludusavi.copyBinaryToUserData();
      const preview = await Ludusavi.getBackupPreview(
        shop,
        objectId,
        winePrefixUsed
      );
      if (preview) {
        if (preview.customBackupPath) {
          customSavePath = preview.customBackupPath;
        }
        const gameEntry = Object.values(preview.games ?? {})[0];
        if (gameEntry?.files) {
          for (const [filePath, info] of Object.entries(gameEntry.files)) {
            if (info.change !== "Removed") {
              localFileCount += 1;
              localTotalBytes += info.bytes || 0;
              const dir = path.dirname(filePath);
              if (!localSavePaths.includes(dir)) localSavePaths.push(dir);
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`[iCloudSave] Preview warning for ${shop}:${objectId}:`, err);
    }

    if (
      localFileCount === 0 &&
      customSavePath &&
      fs.existsSync(customSavePath)
    ) {
      const customStats = getFolderStats(customSavePath);
      localFileCount = customStats.fileCount;
      localTotalBytes = customStats.totalBytes;
      localSavePaths.push(customSavePath);
    }

    return {
      available: status.available,
      writable: status.writable,
      icloudBackupExists: backupStats.fileCount > 0,
      icloudFolderPath,
      lastSyncedAt: meta?.lastSyncedAt ?? null,
      backupFileCount: backupStats.fileCount,
      backupTotalBytes: backupStats.totalBytes,
      localFileCount,
      localTotalBytes,
      localSavePaths: localSavePaths.slice(0, 6),
      customSavePath,
      autoSyncEnabled: game?.automaticCloudSync !== false,
      winePrefixUsed,
    };
  }

  public static async backupGameToICloud(
    shop: GameShop,
    objectId: string
  ): Promise<{ ok: boolean; info?: ICloudGameSaveInfo; error?: string }> {
    const status = this.getStatus();
    if (!status.available || !status.writable) {
      return {
        ok: false,
        error: status.error || "iCloud Drive indisponível para escrita.",
      };
    }

    const icloudFolderPath = await this.getGameFolder(shop, objectId);
    const winePrefixUsed = await this.resolveEffectiveWinePrefix(
      shop,
      objectId
    );
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => undefined);

    fs.mkdirSync(icloudFolderPath, { recursive: true });

    try {
      await Ludusavi.copyConfigFileToUserData();
      await Ludusavi.copyBinaryToUserData();
      const ludusaviDir = path.join(icloudFolderPath, "ludusavi-backup");
      fs.mkdirSync(ludusaviDir, { recursive: true });
      await Ludusavi.backupGame(
        shop,
        objectId,
        ludusaviDir,
        winePrefixUsed,
        false
      );

      const prevMeta = this.readMetadata(icloudFolderPath);
      const customPath = prevMeta?.customSavePath;
      if (customPath && fs.existsSync(customPath)) {
        const customDest = path.join(icloudFolderPath, "custom-save");
        fs.rmSync(customDest, { recursive: true, force: true });
        fs.cpSync(customPath, customDest, { recursive: true });
      }

      const stats = getFolderStats(icloudFolderPath);
      this.writeMetadata(icloudFolderPath, {
        shop,
        objectId,
        title: game?.title || objectId,
        lastSyncedAt: new Date().toISOString(),
        fileCount: stats.fileCount,
        totalBytes: stats.totalBytes,
        customSavePath: customPath ?? null,
      });

      const info = await this.getGameSaveInfo(shop, objectId);
      return { ok: true, info };
    } catch (err) {
      logger.error(`[iCloudSave] Backup failed for ${shop}:${objectId}:`, err);
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Falha ao enviar save para o iCloud Drive.",
      };
    }
  }

  public static async restoreGameFromICloud(
    shop: GameShop,
    objectId: string
  ): Promise<{ ok: boolean; info?: ICloudGameSaveInfo; error?: string }> {
    const status = this.getStatus();
    if (!status.available) {
      return {
        ok: false,
        error: status.error || "iCloud Drive não disponível.",
      };
    }

    const icloudFolderPath = await this.getGameFolder(shop, objectId);
    if (!fs.existsSync(icloudFolderPath)) {
      return {
        ok: false,
        error: "Nenhum backup encontrado no iCloud Drive para este jogo.",
      };
    }

    const winePrefixUsed = await this.resolveEffectiveWinePrefix(
      shop,
      objectId
    );
    const ludusaviDir = path.join(icloudFolderPath, "ludusavi-backup");
    const customSrc = path.join(icloudFolderPath, "custom-save");
    const meta = this.readMetadata(icloudFolderPath);

    try {
      await Ludusavi.copyConfigFileToUserData();
      await Ludusavi.copyBinaryToUserData();

      let restored = false;
      if (fs.existsSync(ludusaviDir)) {
        await Ludusavi.restoreGame(shop, objectId, ludusaviDir, winePrefixUsed);
        restored = true;
      }

      if (meta?.customSavePath && fs.existsSync(customSrc)) {
        fs.mkdirSync(meta.customSavePath, { recursive: true });
        fs.cpSync(customSrc, meta.customSavePath, {
          recursive: true,
          force: true,
        });
        restored = true;
      }

      if (!restored) {
        return {
          ok: false,
          error: "Pasta do backup no iCloud Drive está vazia.",
        };
      }

      const info = await this.getGameSaveInfo(shop, objectId);
      return { ok: true, info };
    } catch (err) {
      logger.error(`[iCloudSave] Restore failed for ${shop}:${objectId}:`, err);
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Falha ao restaurar save do iCloud Drive.",
      };
    }
  }

  public static async setCustomSavePath(
    shop: GameShop,
    objectId: string,
    customPath: string | null
  ): Promise<ICloudGameSaveInfo> {
    await Ludusavi.copyConfigFileToUserData();
    await Ludusavi.addCustomGame(objectId, customPath);

    const icloudFolderPath = await this.getGameFolder(shop, objectId);
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => undefined);
    const prev = this.readMetadata(icloudFolderPath);
    const stats = getFolderStats(icloudFolderPath);

    if (this.getStatus().writable) {
      this.writeMetadata(icloudFolderPath, {
        shop,
        objectId,
        title: game?.title || objectId,
        lastSyncedAt: prev?.lastSyncedAt || "",
        fileCount: stats.fileCount,
        totalBytes: stats.totalBytes,
        customSavePath: customPath,
      });
    }

    return this.getGameSaveInfo(shop, objectId);
  }

  public static async setAutoSync(
    shop: GameShop,
    objectId: string,
    enabled: boolean
  ): Promise<void> {
    const key = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(key).catch(() => undefined);
    if (!game) return;
    await gamesSublevel.put(key, { ...game, automaticCloudSync: enabled });
  }

  public static async openICloudFolder(
    shop: GameShop,
    objectId: string
  ): Promise<void> {
    const folder = await this.getGameFolder(shop, objectId);
    if (fs.existsSync(folder)) {
      await shell.openPath(folder);
    } else {
      const root = getCerberusICloudRoot();
      fs.mkdirSync(root, { recursive: true });
      await shell.openPath(root);
    }
  }
}
