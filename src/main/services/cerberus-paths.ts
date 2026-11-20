import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { UserPreferences } from "@types";

export const CERBERUS_CACHE_FOLDER_NAME = "Cerberus_Cache";

export interface AppBundleLocationOptions {
  execPath?: string;
  isPackaged?: boolean;
  cwd?: string;
}

const require = createRequire(import.meta.url);

const getElectronApp = ():
  | { isPackaged?: boolean; getPath?: (name: string) => string }
  | undefined => {
  try {
    const mod = require("electron");
    return mod?.app;
  } catch {
    return undefined;
  }
};

/**
 * Resolves the folder containing Cerberus.app on packaged macOS builds
 * (or the workspace/working directory in unpacked development runs).
 */
export function resolveAppBundleContainerDir(
  options?: AppBundleLocationOptions
): string {
  const execPath = path.resolve(options?.execPath ?? process.execPath);
  const macOsMarker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const markerIdx = execPath.indexOf(macOsMarker);

  const isUnpackedElectron =
    options?.isPackaged === false ||
    execPath.includes(`${path.sep}node_modules${path.sep}`);

  if (!isUnpackedElectron) {
    if (markerIdx !== -1) {
      const bundleOrInner = execPath.slice(0, markerIdx);
      if (bundleOrInner.toLowerCase().endsWith(".app")) {
        return path.dirname(bundleOrInner);
      }
    }

    const appMatch = execPath.match(
      /^(.*\/[^/]+\.app)\/Contents\/MacOS(?:\/|$)/
    );
    if (appMatch) {
      return path.dirname(appMatch[1]);
    }
  }

  return path.resolve(options?.cwd ?? process.cwd());
}

/** Checks whether the target directory (or nearest existing ancestor) is writable. */
export function isDirectoryWritable(targetPath: string): boolean {
  let cursor = path.resolve(targetPath);
  while (true) {
    if (fs.existsSync(cursor)) {
      try {
        fs.accessSync(cursor, fs.constants.W_OK | fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
}

export class CerberusPathsService {
  /** Directory that directly contains Cerberus.app (or project root in dev). */
  public static getAppBundleDir(): string {
    const electronApp = getElectronApp();
    return resolveAppBundleContainerDir({
      execPath: process.execPath,
      isPackaged: electronApp?.isPackaged ?? false,
      cwd: process.cwd(),
    });
  }

  /** Ideal default cache location directly beside Cerberus.app (`<dir>/Cerberus_Cache`). */
  public static getIdealAppAdjacentCacheRoot(): string {
    return path.join(this.getAppBundleDir(), CERBERUS_CACHE_FOLDER_NAME);
  }

  /**
   * Default cache root for new/unset configurations:
   * `<folder containing Cerberus.app>/Cerberus_Cache/`, falling back to userData
   * only when the bundle container folder is read-only (e.g. non-admin `/Applications`).
   */
  public static getDefaultCacheRoot(): string {
    const adjacent = this.getIdealAppAdjacentCacheRoot();
    if (isDirectoryWritable(adjacent)) {
      return adjacent;
    }

    const electronApp = getElectronApp();
    const userData =
      typeof electronApp?.getPath === "function"
        ? electronApp.getPath("userData")
        : path.join(process.cwd(), ".cerberus-data");
    return path.join(userData, CERBERUS_CACHE_FOLDER_NAME);
  }

  public static getCacheRootSync(customRoot?: string | null): string {
    const trimmed = customRoot?.trim();
    const target = trimmed ? path.resolve(trimmed) : this.getDefaultCacheRoot();
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  public static async getCacheRoot(
    prefs?: UserPreferences | null
  ): Promise<string> {
    if (prefs) {
      return this.getCacheRootSync(prefs.cerberusCacheRoot);
    }
    try {
      const { db, levelKeys } = await import("@main/level");
      const loaded = await db
        .get<string, UserPreferences | null>(levelKeys.userPreferences, {
          valueEncoding: "json",
        })
        .catch(() => null);
      return this.getCacheRootSync(loaded?.cerberusCacheRoot);
    } catch {
      return this.getCacheRootSync(null);
    }
  }

  public static async getCacheSubdir(
    subpath: string,
    prefs?: UserPreferences | null
  ): Promise<string> {
    const root = await this.getCacheRoot(prefs);
    const target = path.join(root, subpath);
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  public static getCrossOverToolsCacheDirSync(
    customRoot?: string | null
  ): string {
    const root = this.getCacheRootSync(customRoot);
    const target = path.join(root, "CrossOverTools");
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  public static getDefaultCacheRootDir(): string {
    return this.getDefaultCacheRoot();
  }

  public static getAppBundleContainerDir(): string {
    return this.getAppBundleDir();
  }

  public static async getCrossOverToolsCacheDir(
    prefs?: UserPreferences | null
  ): Promise<string> {
    return this.getCacheSubdir("CrossOverTools", prefs);
  }
}
