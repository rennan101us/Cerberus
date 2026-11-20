import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { NxSystemHardwareInfo, UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { CerberusPathsService } from "../cerberus-paths";

export const NXNATIVE_OFFICIAL_REPO_URL =
  "https://gitlab.com/rennan-group2/nxnative_Launcher.git";
export const NXNATIVE_UPSTREAM_REPO_URL =
  "https://github.com/seedds/nxnative.git";
export const NX2ANDROID_REPO_URL = "https://github.com/shirai91/nx2android.git";

const DEFAULT_DEV_NXNATIVE_PATH =
  "/Volumes/SSD FN501 PRO/Emulations/NativePort/nxnative";

export interface PythonRuntimeInfo {
  path: string | null;
  version: string;
  isSufficient: boolean;
  hasAndroidModules: boolean;
  isStable: boolean;
  isExperimental: boolean;
}

export class NxPathsService {
  private static async getPrefs(): Promise<UserPreferences | null> {
    try {
      return (await db.get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })) as UserPreferences;
    } catch {
      return null;
    }
  }

  public static isValidNxnativeDirectory(dirPath: string): boolean {
    if (!dirPath) return false;
    const scriptPath = path.join(dirPath, "scripts", "build_ipa_from_nsp.py");
    const dmPath = path.join(dirPath, "dm");
    return fs.existsSync(scriptPath) && fs.existsSync(dmPath);
  }

  public static isValidNx2AndroidDirectory(dirPath: string): boolean {
    if (!dirPath) return false;
    return fs.existsSync(path.join(dirPath, "porter"));
  }

  public static getDefaultEnginesDirectory(cacheRoot?: string | null): string {
    const root = CerberusPathsService.getCacheRootSync(cacheRoot);
    return path.join(root, "Engines");
  }

  public static async resolveNxnativePath(
    overridePath?: string | null
  ): Promise<{ path: string; isValid: boolean }> {
    const prefs = await this.getPrefs();
    const cacheRoot = await CerberusPathsService.getCacheRoot(prefs);
    const appBundleDir = CerberusPathsService.getAppBundleDir();
    const enginesDir = path.join(cacheRoot, "Engines");
    const candidates: string[] = [];

    const addCandidate = (p?: string | null) => {
      const trimmed = p?.trim();
      if (!trimmed) return;
      const resolved = path.resolve(trimmed);
      candidates.push(resolved);
      candidates.push(path.join(resolved, "nxnative"));
    };

    addCandidate(overridePath);
    addCandidate(prefs?.nxnativeRepoPath);
    addCandidate(enginesDir);
    addCandidate(appBundleDir);
    addCandidate(DEFAULT_DEV_NXNATIVE_PATH);
    addCandidate(path.join(os.homedir(), "NativePort", "nxnative"));
    addCandidate(
      path.join(os.homedir(), "Library", "Application Support", "nxnative_repo")
    );

    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (this.isValidNxnativeDirectory(candidate)) {
        return { path: candidate, isValid: true };
      }
    }

    const fallback =
      overridePath?.trim() ||
      prefs?.nxnativeRepoPath?.trim() ||
      path.join(enginesDir, "nxnative");
    return { path: path.resolve(fallback), isValid: false };
  }

  public static async resolveNx2AndroidPath(
    nxnativePath?: string
  ): Promise<{ path: string; isValid: boolean }> {
    const prefs = await this.getPrefs();
    const cacheRoot = await CerberusPathsService.getCacheRoot(prefs);
    const nxPath = nxnativePath || (await this.resolveNxnativePath()).path;

    const enginesNx2Android = path.join(cacheRoot, "Engines", "nx2android");
    const userAppSupport = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "nx2android"
    );

    const candidates = [
      prefs?.nx2androidRepoPath?.trim(),
      nxPath ? path.join(nxPath, "tools", "nx2android") : null,
      enginesNx2Android,
      userAppSupport,
      path.join(DEFAULT_DEV_NXNATIVE_PATH, "tools", "nx2android"),
    ].filter((v): v is string => Boolean(v));

    for (const c of candidates) {
      const resolved = path.resolve(c);
      if (this.isValidNx2AndroidDirectory(resolved)) {
        return { path: resolved, isValid: true };
      }
    }

    const preferredTarget =
      prefs?.nx2androidRepoPath?.trim() ||
      (nxPath && fs.existsSync(nxPath)
        ? path.join(nxPath, "tools", "nx2android")
        : enginesNx2Android);
    return { path: path.resolve(preferredTarget), isValid: false };
  }

  public static getDefaultAppSupportDirectory(
    cacheRoot?: string | null
  ): string {
    const root = CerberusPathsService.getCacheRootSync(cacheRoot);
    return path.join(root, "AppSupport");
  }

  public static async getAppSupportDirectory(): Promise<string> {
    const prefs = await this.getPrefs();
    const custom = prefs?.nxAppSupportFolder?.trim();
    const cacheRoot = await CerberusPathsService.getCacheRoot(prefs);
    const target = custom
      ? path.resolve(custom)
      : this.getDefaultAppSupportDirectory(cacheRoot);
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  public static getDefaultNx2AndroidHomeDirectory(
    cacheRoot?: string | null
  ): string {
    const root = CerberusPathsService.getCacheRootSync(cacheRoot);
    return path.join(root, "nx2android");
  }

  public static async getNx2AndroidHomeDirectory(): Promise<string> {
    const prefs = await this.getPrefs();
    const custom = prefs?.nx2androidHomeFolder?.trim();
    const cacheRoot = await CerberusPathsService.getCacheRoot(prefs);
    const target = custom
      ? path.resolve(custom)
      : this.getDefaultNx2AndroidHomeDirectory(cacheRoot);
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  public static async getArtworkSearchDirectories(): Promise<string[]> {
    const appSupport = await this.getAppSupportDirectory();
    const nxRepo = await this.resolveNxnativePath();
    const cacheRoot = await CerberusPathsService.getCacheRoot();
    const candidates = [
      appSupport,
      path.join(cacheRoot, "AppSupport"),
      path.join(nxRepo.path, "docs", "images"),
    ];
    const seen = new Set<string>();
    const results: string[] = [];
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      if (fs.existsSync(resolved)) {
        results.push(resolved);
      }
    }
    return results;
  }

  public static getDefaultOutputDirectory(cacheRoot?: string | null): string {
    const root = CerberusPathsService.getCacheRootSync(cacheRoot);
    return path.join(root, "Ports");
  }

  public static async getOutputDirectory(): Promise<string> {
    const prefs = await this.getPrefs();
    const custom = prefs?.nxPortedOutputFolder?.trim();
    const cacheRoot = await CerberusPathsService.getCacheRoot(prefs);
    const target = custom
      ? path.resolve(custom)
      : this.getDefaultOutputDirectory(cacheRoot);
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  public static getDefaultStagingDirectory(cacheRoot?: string | null): string {
    const root = CerberusPathsService.getCacheRootSync(cacheRoot);
    return path.join(root, "Staging");
  }

  public static async getStagingDirectory(): Promise<string> {
    const prefs = await this.getPrefs();
    const custom = prefs?.nxStagingFolder?.trim();
    const cacheRoot = await CerberusPathsService.getCacheRoot(prefs);
    const target = custom
      ? path.resolve(custom)
      : this.getDefaultStagingDirectory(cacheRoot);
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  public static async getTempDirectory(stagingDir?: string): Promise<string> {
    const dir = stagingDir?.trim()
      ? path.join(path.resolve(stagingDir), ".tmp")
      : path.join(await CerberusPathsService.getCacheRoot(), "Temp");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  public static getCachesDirectory(cacheRoot?: string | null): string {
    const root = CerberusPathsService.getCacheRootSync(cacheRoot);
    const dir = path.join(root, "Caches", "nxnative");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  public static async getNativeCacheDirectory(): Promise<string> {
    const root = await CerberusPathsService.getCacheRoot();
    const dir = path.join(root, "Caches", "nxnative");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  public static getICloudRootDirectory(): string {
    return path.join(
      os.homedir(),
      "Library",
      "Mobile Documents",
      "com~apple~CloudDocs",
      "nxnative_launcher"
    );
  }

  public static isICloudDriveAvailable(): boolean {
    const docs = path.join(
      os.homedir(),
      "Library",
      "Mobile Documents",
      "com~apple~CloudDocs"
    );
    return fs.existsSync(docs);
  }

  public static getAugmentedPath(
    nxnativeDir?: string | null,
    pythonPath?: string | null,
    nx2aHome?: string | null
  ): string {
    const extra: string[] = [];
    if (nxnativeDir) {
      const bundledToolsBin = path.join(
        nxnativeDir,
        "gui",
        "Resources",
        "tools",
        "bin"
      );
      if (fs.existsSync(bundledToolsBin)) extra.push(bundledToolsBin);
    }
    if (pythonPath) {
      extra.push(path.dirname(pythonPath));
    }
    if (nx2aHome) {
      extra.push(path.join(nx2aHome, "toolchains", "platform-tools"));
    }
    extra.push(
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "nx2android",
        "toolchains",
        "platform-tools"
      )
    );
    const current = process.env.PATH || "";
    const deduped = [...new Set(extra.filter(Boolean))];
    return [...deduped, current].filter(Boolean).join(":");
  }

  public static getBundledPythonEnv(options: {
    pythonPath?: string | null;
    nxnativeDir?: string | null;
    stagingDir: string;
    nx2aHome: string;
    cacheRoot: string;
  }): NodeJS.ProcessEnv {
    const tempDir = path.join(options.stagingDir, ".tmp");
    fs.mkdirSync(tempDir, { recursive: true });
    const cachesRoot = path.join(options.cacheRoot, "Caches");
    fs.mkdirSync(cachesRoot, { recursive: true });

    const cpus = Math.max(1, os.cpus().length || 8);

    return {
      ...process.env,
      PATH: this.getAugmentedPath(
        options.nxnativeDir,
        options.pythonPath,
        options.nx2aHome
      ),
      PYTHONNOUSERSITE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUNBUFFERED: "1",
      LC_ALL: "en_US.UTF-8",
      LANG: "en_US.UTF-8",
      NX2A_HOME: options.nx2aHome,
      TMPDIR: tempDir,
      XDG_CACHE_HOME: cachesRoot,
      J: String(cpus),
    };
  }

  public static findBestPython(nxnativeDir?: string | null): PythonRuntimeInfo {
    const home = os.homedir();
    const candidates = [
      nxnativeDir
        ? path.join(nxnativeDir, "gui", "Resources", "python", "bin", "python3")
        : null,
      path.join(
        DEFAULT_DEV_NXNATIVE_PATH,
        "gui",
        "Resources",
        "python",
        "bin",
        "python3"
      ),
      path.join(home, ".pyenv", "shims", "python3"),
      "/opt/homebrew/bin/python3.13",
      "/opt/homebrew/opt/python@3.13/libexec/bin/python3",
      "/opt/homebrew/bin/python3.14",
      "/opt/homebrew/bin/python3.12",
      "/usr/local/bin/python3.13",
      "/usr/local/bin/python3.14",
      "/usr/local/bin/python3.12",
      "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3",
      "/opt/homebrew/bin/python3",
      "/usr/local/bin/python3",
      "/usr/bin/python3",
    ].filter((v): v is string => Boolean(v));

    let fallbackStable: PythonRuntimeInfo | null = null;
    let experimental: PythonRuntimeInfo | null = null;

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const probeEnv = {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONNOUSERSITE: "1",
        };
        const verStr = execFileSync(
          candidate,
          [
            "-B",
            "-c",
            "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')",
          ],
          {
            timeout: 3000,
            encoding: "utf8",
            env: probeEnv,
          }
        ).trim();

        const parts = verStr.split(".").map((n) => Number.parseInt(n, 10));
        const major = parts[0] || 0;
        const minor = parts[1] || 0;

        let hasModules = false;
        let hasAndroidModules = false;
        try {
          const modOut = execFileSync(
            candidate,
            [
              "-B",
              "-c",
              "import lz4.block, capstone, fontTools, zbic, Crypto, backports.zstd; print('CORE_OK')",
            ],
            { timeout: 3000, encoding: "utf8", env: probeEnv }
          );
          hasModules = modOut.includes("CORE_OK");
        } catch {
          try {
            const fallbackOut = execFileSync(
              candidate,
              [
                "-B",
                "-c",
                "import lz4.block, capstone, fontTools, zbic; print('OK')",
              ],
              { timeout: 3000, encoding: "utf8", env: probeEnv }
            );
            hasModules = fallbackOut.includes("OK");
          } catch {
            hasModules = false;
          }
        }

        try {
          const androidOut = execFileSync(
            candidate,
            ["-B", "-c", "import PIL, yaml; print('ANDROID_OK')"],
            { timeout: 3000, encoding: "utf8", env: probeEnv }
          );
          hasAndroidModules = androidOut.includes("ANDROID_OK");
        } catch {
          hasAndroidModules = false;
        }

        if (major === 3 && minor >= 12 && minor <= 14) {
          const info: PythonRuntimeInfo = {
            path: candidate,
            version: `Python ${verStr}`,
            isSufficient: hasModules,
            hasAndroidModules,
            isStable: true,
            isExperimental: false,
          };
          if (hasModules && hasAndroidModules) return info;
          if (!fallbackStable || (info.isSufficient && !fallbackStable.isSufficient)) {
            fallbackStable = info;
          }
        } else if (major === 3 && minor >= 15 && !experimental) {
          experimental = {
            path: candidate,
            version: `Python ${verStr}`,
            isSufficient: hasModules,
            hasAndroidModules,
            isStable: false,
            isExperimental: true,
          };
        }
      } catch {
        continue;
      }
    }

    if (fallbackStable) return fallbackStable;
    if (experimental) return experimental;

    return {
      path: null,
      version: "Not Found",
      isSufficient: false,
      hasAndroidModules: false,
      isStable: false,
      isExperimental: false,
    };
  }

  public static getHardwareInfo(): NxSystemHardwareInfo {
    let chipName = "Apple Silicon";
    try {
      const brand = execFileSync(
        "/usr/sbin/sysctl",
        ["-n", "machdep.cpu.brand_string"],
        {
          encoding: "utf8",
          timeout: 2000,
        }
      ).trim();
      if (brand) chipName = brand;
    } catch {
      chipName = os.cpus()[0]?.model || "Apple Silicon";
    }

    const coreCount = os.cpus().length || 8;
    const physicalRamGB = Math.max(
      1,
      Math.round(os.totalmem() / (1024 * 1024 * 1024))
    );

    let supports120Hz = false;
    try {
      const sp = execFileSync(
        "/usr/sbin/system_profiler",
        ["SPDisplaysDataType"],
        {
          encoding: "utf8",
          timeout: 3000,
        }
      );
      supports120Hz = /120\s*Hz|ProMotion/i.test(sp);
    } catch {
      supports120Hz = false;
    }

    return { chipName, coreCount, physicalRamGB, supports120Hz };
  }

  public static getDiskFreeBytes(targetDir: string): number {
    try {
      const resolved = fs.existsSync(targetDir)
        ? targetDir
        : path.dirname(targetDir);
      const stat = fs.statfsSync(resolved);
      return Number(stat.bavail) * Number(stat.bsize);
    } catch {
      return 0;
    }
  }

  public static migrateDirectoryContents(
    sourceDir: string,
    targetDir: string
  ): { ok: boolean; error?: string } {
    const src = path.resolve(sourceDir);
    const dst = path.resolve(targetDir);
    if (src === dst) return { ok: true };
    if (dst.startsWith(src + path.sep) || src.startsWith(dst + path.sep)) {
      return { ok: true };
    }

    try {
      fs.mkdirSync(dst, { recursive: true });
      if (!fs.existsSync(src)) return { ok: true };
      const entries = fs.readdirSync(src);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const srcEntry = path.join(src, entry);
        const dstEntry = path.join(dst, entry);
        fs.cpSync(srcEntry, dstEntry, { recursive: true, force: true });
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
