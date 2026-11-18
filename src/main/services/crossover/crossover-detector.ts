import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CrossOverStatus } from "@types";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);

export const DEFAULT_BOTTLE_NAME = "HydraGames";
export const CROSSOVER_FEED_URL =
  "https://www.codeweavers.com/xml/versions/cxmac.xml";

export class CrossOverDetector {
  private static cachedStatus: CrossOverStatus | null = null;
  private static lastCheckTime = 0;
  private static readonly CACHE_TTL_MS = 30_000; // 30s cache

  public static getPotentialAppPaths(): string[] {
    const homeDir = os.homedir();
    return [
      "/Applications/CrossOver.app",
      path.join(homeDir, "Applications", "CrossOver.app"),
    ];
  }

  public static findCrossOverApp(): string | null {
    for (const appPath of this.getPotentialAppPaths()) {
      if (fs.existsSync(appPath)) {
        return appPath;
      }
    }
    return null;
  }

  public static getBinaryPath(
    binaryName: "wine" | "cxbottle" | "cxstart" | "wineserver"
  ): string | null {
    const appPath = this.findCrossOverApp();
    if (!appPath) return null;

    const binPath = path.join(
      appPath,
      "Contents",
      "SharedSupport",
      "CrossOver",
      "bin",
      binaryName
    );

    return fs.existsSync(binPath) ? binPath : null;
  }

  public static async getInstalledVersion(appPath: string): Promise<{
    version: string | null;
    build: string | null;
  }> {
    const plistPath = path.join(appPath, "Contents", "Info.plist");
    if (!fs.existsSync(plistPath)) {
      return { version: null, build: null };
    }

    try {
      const { stdout: versionOut } = await execFileAsync(
        "/usr/bin/defaults",
        ["read", plistPath, "CFBundleShortVersionString"],
        { timeout: 3000 }
      );
      const { stdout: buildOut } = await execFileAsync(
        "/usr/bin/defaults",
        ["read", plistPath, "CFBundleVersion"],
        { timeout: 3000 }
      ).catch(() => ({ stdout: "" }));

      return {
        version: versionOut.trim() || null,
        build: buildOut.trim() || null,
      };
    } catch {
      return { version: null, build: null };
    }
  }

  public static async getBottlesDirectory(): Promise<string> {
    const homeDir = os.homedir();
    const defaultDir = path.join(
      homeDir,
      "Library",
      "Application Support",
      "CrossOver",
      "Bottles"
    );

    const plistPath = path.join(
      homeDir,
      "Library",
      "Preferences",
      "com.codeweavers.CrossOver.plist"
    );

    if (fs.existsSync(plistPath)) {
      try {
        const { stdout } = await execFileAsync(
          "/usr/bin/defaults",
          ["read", plistPath, "BottleDir"],
          { timeout: 3000 }
        );
        const configuredDir = stdout.trim();
        if (configuredDir && fs.existsSync(configuredDir)) {
          return configuredDir;
        }
      } catch {
        // Fallback to default
      }
    }

    return defaultDir;
  }

  public static async listBottles(bottlesDir: string): Promise<string[]> {
    if (!fs.existsSync(bottlesDir)) {
      return [];
    }

    try {
      const entries = await fs.promises.readdir(bottlesDir, {
        withFileTypes: true,
      });
      const bottles: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const bottleConf = path.join(bottlesDir, entry.name, "cxbottle.conf");
          const systemReg = path.join(bottlesDir, entry.name, "system.reg");
          if (fs.existsSync(bottleConf) || fs.existsSync(systemReg)) {
            bottles.push(entry.name);
          }
        }
      }

      return bottles;
    } catch (error) {
      logger.error("[CrossOver] Error listing bottles", error);
      return [];
    }
  }

  public static async checkLatestRelease(): Promise<{
    version: string | null;
    build: string | null;
    downloadUrl: string | null;
  }> {
    try {
      const response = await fetch(CROSSOVER_FEED_URL, {
        headers: {
          "User-Agent": "CrossOver/26.3.0 Sparkle/1.26.0",
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        return { version: null, build: null, downloadUrl: null };
      }

      const xmlText = await response.text();

      // Extract latest item enclosure
      const enclosureMatch = xmlText.match(/<enclosure\s+([^>]+)\/>/i);
      if (!enclosureMatch) {
        return { version: null, build: null, downloadUrl: null };
      }

      const attributes = enclosureMatch[1];
      const urlMatch = attributes.match(/url="([^"]+)"/i);
      const verMatch = attributes.match(
        /(?:sparkle:)?shortVersionString="([^"]+)"/i
      );
      const buildMatch = attributes.match(/(?:sparkle:)?version="([^"]+)"/i);

      return {
        version: verMatch ? verMatch[1] : null,
        build: buildMatch ? buildMatch[1] : null,
        downloadUrl: urlMatch ? urlMatch[1] : null,
      };
    } catch (error) {
      logger.warn("[CrossOver] Failed to check for latest release", error);
      return { version: null, build: null, downloadUrl: null };
    }
  }

  public static isNewerVersion(
    currentVer: string | null,
    latestVer: string | null
  ): boolean {
    if (!currentVer || !latestVer) return false;
    const curParts = currentVer.split(".").map((n) => parseInt(n, 10) || 0);
    const latParts = latestVer.split(".").map((n) => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(curParts.length, latParts.length); i++) {
      const cur = curParts[i] ?? 0;
      const lat = latParts[i] ?? 0;
      if (lat > cur) return true;
      if (lat < cur) return false;
    }
    return false;
  }

  public static async getStatus(
    forceRefresh = false
  ): Promise<CrossOverStatus> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cachedStatus &&
      now - this.lastCheckTime < this.CACHE_TTL_MS
    ) {
      return this.cachedStatus;
    }

    const appPath = this.findCrossOverApp();
    const installed = appPath !== null;

    let version: string | null = null;
    let build: string | null = null;
    if (appPath) {
      const verInfo = await this.getInstalledVersion(appPath);
      version = verInfo.version;
      build = verInfo.build;
    }

    const bottlesDir = await this.getBottlesDirectory();
    const bottles = await this.listBottles(bottlesDir);

    // Default bottle selection
    const defaultBottle = bottles.includes(DEFAULT_BOTTLE_NAME)
      ? DEFAULT_BOTTLE_NAME
      : bottles[0] || DEFAULT_BOTTLE_NAME;

    // Check updates
    const latestRelease = await this.checkLatestRelease();
    const updateAvailable =
      installed && this.isNewerVersion(version, latestRelease.version);

    const status: CrossOverStatus = {
      installed,
      version,
      build,
      appPath,
      bottlesDir,
      bottles,
      defaultBottle,
      updateAvailable,
      latestVersion: latestRelease.version,
      downloadUrl: latestRelease.downloadUrl,
    };

    this.cachedStatus = status;
    this.lastCheckTime = now;
    return status;
  }
}
