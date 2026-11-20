import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CrossOverStatus,
  MacChipFamily,
  MacChipTier,
  MacHardwareSpecs,
} from "@types";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);

export const DEFAULT_BOTTLE_NAME = "Head Bottle";
export const CROSSOVER_FEED_URL =
  "https://www.codeweavers.com/xml/versions/cxmac.xml";

export class CrossOverDetector {
  private static cachedStatus: CrossOverStatus | null = null;
  private static cachedHardwareSpecs: MacHardwareSpecs | null = null;
  private static lastCheckTime = 0;
  private static readonly CACHE_TTL_MS = 5 * 60_000; // 5m cache
  private static cachedLatestRelease: {
    version: string | null;
    build: string | null;
    downloadUrl: string | null;
  } = { version: null, build: null, downloadUrl: null };
  private static isCheckingRelease = false;

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

  public static detectBottleFromPath(
    filePath: string,
    bottlesDir?: string
  ): string | null {
    if (!filePath) return null;
    const normalized = path.resolve(filePath);

    // 1. Direct regex match on path: .../Bottles/<BottleName>/...
    const match = normalized.match(
      /[/\\](?:CrossOver[/\\])?Bottles[/\\]([^/\\]+)/i
    );
    if (match && match[1]) {
      return match[1];
    }

    // 2. Relative check if bottlesDir is provided
    if (bottlesDir) {
      const rel = path.relative(bottlesDir, normalized);
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
        const seg = rel.split(path.sep)[0];
        if (seg) return seg;
      }
    }

    return null;
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

      if (bottles.includes(DEFAULT_BOTTLE_NAME)) {
        return [DEFAULT_BOTTLE_NAME];
      }
      if (bottles.includes("Steam")) {
        return ["Steam"];
      }
      return bottles.slice(0, 1);
    } catch (error) {
      logger.error("[RedWine] Error listing bottles", error);
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
      logger.warn("[RedWine] Failed to check for latest release", error);
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
    await this.listBottles(bottlesDir);

    // Single unified bottle architecture: always expose Head Bottle
    const defaultBottle = DEFAULT_BOTTLE_NAME;
    const bottles = [DEFAULT_BOTTLE_NAME];

    // Refresh latest release asynchronously so UI modals never block on network calls
    if (!this.isCheckingRelease && (forceRefresh || !this.cachedLatestRelease.version)) {
      this.isCheckingRelease = true;
      void this.checkLatestRelease()
        .then((latest) => {
          this.cachedLatestRelease = latest;
          if (this.cachedStatus) {
            this.cachedStatus = {
              ...this.cachedStatus,
              updateAvailable:
                this.cachedStatus.installed &&
                this.isNewerVersion(this.cachedStatus.version, latest.version),
              latestVersion: latest.version,
              downloadUrl: latest.downloadUrl,
            };
          }
        })
        .finally(() => {
          this.isCheckingRelease = false;
        });
    }

    const latestRelease = this.cachedLatestRelease;
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

  private static parseChipFamily(chipName: string): {
    family: MacChipFamily;
    tier: MacChipTier;
    isAppleSilicon: boolean;
  } {
    const normalized = chipName.toUpperCase();
    let family: MacChipFamily = "Unknown";
    if (/\bM5\b/.test(normalized)) family = "M5";
    else if (/\bM4\b/.test(normalized)) family = "M4";
    else if (/\bM3\b/.test(normalized)) family = "M3";
    else if (/\bM2\b/.test(normalized)) family = "M2";
    else if (/\bM1\b/.test(normalized)) family = "M1";
    else if (/INTEL|CORE|XEON/.test(normalized)) family = "Intel";

    let tier: MacChipTier = "unknown";
    if (/\bULTRA\b/.test(normalized)) tier = "ultra";
    else if (/\bMAX\b/.test(normalized)) tier = "max";
    else if (/\bPRO\b/.test(normalized)) tier = "pro";
    else if (family !== "Intel" && family !== "Unknown") tier = "base";

    const isAppleSilicon =
      family === "M1" ||
      family === "M2" ||
      family === "M3" ||
      family === "M4" ||
      family === "M5" ||
      /APPLE/i.test(chipName) ||
      process.arch === "arm64";

    return { family, tier, isAppleSilicon };
  }

  private static estimateDefaultGpuCores(
    family: MacChipFamily,
    tier: MacChipTier
  ): number | null {
    if (family === "Intel" || family === "Unknown") return null;
    if (tier === "ultra") return 60;
    if (tier === "max") return 32;
    if (tier === "pro") return 16;
    return family === "M1" || family === "M2" ? 8 : 10;
  }

  public static async getMacHardwareSpecs(): Promise<MacHardwareSpecs> {
    if (this.cachedHardwareSpecs) {
      return this.cachedHardwareSpecs;
    }

    let chipName = os.cpus()[0]?.model?.trim() || "Apple Silicon";
    try {
      const { stdout } = await execFileAsync(
        "/usr/sbin/sysctl",
        ["-n", "machdep.cpu.brand_string"],
        { timeout: 2000 }
      );
      if (stdout.trim()) {
        chipName = stdout.trim();
      }
    } catch {
      // Fallback to os.cpus() model
    }

    const cpuCoresTotal = Math.max(1, os.cpus().length || 8);
    const ramGB = Math.max(
      1,
      Math.round(os.totalmem() / (1024 * 1024 * 1024))
    );

    let cpuPerformanceCores: number | null = null;
    let cpuEfficiencyCores: number | null = null;
    try {
      const { stdout } = await execFileAsync(
        "/usr/sbin/sysctl",
        ["-n", "hw.perflevel0.physicalcpu", "hw.perflevel1.physicalcpu"],
        { timeout: 2000 }
      );
      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .map((val) => parseInt(val.trim(), 10));
      if (Number.isFinite(lines[0]) && lines[0] > 0) {
        cpuPerformanceCores = lines[0];
      }
      if (Number.isFinite(lines[1]) && lines[1] > 0) {
        cpuEfficiencyCores = lines[1];
      }
    } catch {
      // Optional on non-Apple Silicon systems
    }

    let gpuCores: number | null = null;
    try {
      const { stdout } = await execFileAsync(
        "/usr/sbin/ioreg",
        ["-r", "-c", "AGXAccelerator", "-d", "1"],
        { timeout: 2500 }
      );
      const match = stdout.match(/"gpu-core-count"\s*=\s*(\d+)/i);
      if (match && match[1]) {
        const parsed = parseInt(match[1], 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          gpuCores = parsed;
        }
      }
    } catch {
      // Ignore and try system_profiler fallback
    }

    if (gpuCores === null) {
      try {
        const { stdout } = await execFileAsync(
          "/usr/sbin/system_profiler",
          ["SPDisplaysDataType"],
          { timeout: 3500 }
        );
        const match = stdout.match(/Total Number of Cores:\s*(\d+)/i);
        if (match && match[1]) {
          const parsed = parseInt(match[1], 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            gpuCores = parsed;
          }
        }
      } catch {
        // Fallback to heuristic
      }
    }

    const { family, tier, isAppleSilicon } = this.parseChipFamily(chipName);
    if (gpuCores === null && isAppleSilicon) {
      gpuCores = this.estimateDefaultGpuCores(family, tier);
    }

    const specs: MacHardwareSpecs = {
      chipName,
      chipFamily: family,
      chipTier: tier,
      ramGB,
      cpuCoresTotal,
      cpuPerformanceCores,
      cpuEfficiencyCores,
      gpuCores,
      isAppleSilicon,
    };

    this.cachedHardwareSpecs = specs;
    return specs;
  }
}
