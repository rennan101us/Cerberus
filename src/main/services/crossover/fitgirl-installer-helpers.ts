import fs from "node:fs";
import path from "node:path";

export interface RepackDetectionResult {
  isRepack: boolean;
  isFitGirl: boolean;
  reason?: string;
}

/** Detects FitGirl / DODI / Inno-based repacks that need Wine Safe Mode on Apple Silicon. */
export function detectRepackInstaller(
  installerPath: string
): RepackDetectionResult {
  const normalized = installerPath.toLowerCase();
  const baseName = path.basename(normalized);
  const parentDir = path.dirname(installerPath);

  if (normalized.includes("fitgirl")) {
    return {
      isRepack: true,
      isFitGirl: true,
      reason: "FitGirl path signature matched",
    };
  }

  let siblings: string[] = [];
  try {
    if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
      siblings = fs.readdirSync(parentDir).map((entry) => entry.toLowerCase());
    }
  } catch {
    siblings = [];
  }

  if (
    siblings.some(
      (name) =>
        /^fg-.*\.bin$/i.test(name) ||
        name.includes("verify bin files") ||
        name.startsWith("fitgirl")
    ) ||
    fs.existsSync(path.join(parentDir, "MD5", "fitgirl-bins.md5"))
  ) {
    return {
      isRepack: true,
      isFitGirl: true,
      reason: "FitGirl archive/MD5 layout matched",
    };
  }

  const hasBinArchives = siblings.some((name) =>
    /^(?:data|setup)[-_0-9a-z]*\.bin$/i.test(name)
  );
  if (
    normalized.includes("dodi") ||
    normalized.includes("repack") ||
    normalized.includes("elamigos") ||
    (baseName === "setup.exe" && hasBinArchives)
  ) {
    return {
      isRepack: true,
      isFitGirl: false,
      reason: hasBinArchives
        ? "Multi-part .bin setup installer detected"
        : "Repack path signature matched",
    };
  }

  return { isRepack: false, isFitGirl: false };
}

/**
 * Returns env overrides injected via CrossOver `--env` CLI flag so `cxbottle.conf`
 * MSync/D3DMetal/AVX settings cannot overwrite safe installer defaults.
 */
export function buildInstallerEnvOverrides(
  isRepack: boolean
): Record<string, string> {
  if (!isRepack) {
    return {
      WINED3DMETAL: "0",
      D3DM_MTL4: "0",
      DXVK_HUD: "0",
      MTL_HUD_ENABLED: "0",
      WINEDEBUG: "-all",
    };
  }

  return {
    WINEMSYNC: "0",
    WINEESYNC: "0",
    WINED3DMETAL: "0",
    D3DM_MTL4: "0",
    DXVK_HUD: "0",
    MTL_HUD_ENABLED: "0",
    ROSETTA_ADVERTISE_AVX: "0",
    WINE_CPU_TOPOLOGY: "4:0,1,2,3",
    NUMBER_OF_PROCESSORS: "4",
    OMP_NUM_THREADS: "4",
    WINEDEBUG: "-all",
  };
}

/** Builds CrossOver `bin/wine` CLI args with `--winver`, `--dll`, and single `--env` string. */
export function buildInstallerWineArgs(options: {
  bottleName: string;
  windowsWorkingDir: string;
  windowsPath: string;
  ext: string;
  isRepack: boolean;
  extraArgs?: string[];
  envOverrides: Record<string, string>;
}): string[] {
  const args = [
    "--bottle",
    options.bottleName,
    "--workdir",
    options.windowsWorkingDir,
    "--wait-children",
  ];

  if (options.isRepack) {
    args.push("--winver", "win7", "--dll", "isdone,unarc=n,b");
  }

  const envPairs = Object.entries(options.envOverrides)
    .filter(([, val]) => val !== undefined && val !== "")
    .map(([key, val]) => `${key}=${val}`);
  if (envPairs.length > 0) {
    args.push("--env", envPairs.join(" "));
  }

  const extraArgs = options.extraArgs ?? [];
  const lowerExt = options.ext.toLowerCase();
  if (lowerExt === ".msi") {
    args.push("--cx-app", "msiexec", "/i", options.windowsPath, ...extraArgs);
  } else if (lowerExt === ".bat" || lowerExt === ".cmd") {
    args.push("--cx-app", "cmd", "/c", options.windowsPath, ...extraArgs);
  } else {
    args.push("--cx-app", options.windowsPath, ...extraArgs);
  }

  return args;
}

/** Maps an external installer folder into `C:\_fg_inst` to keep paths short for ISDone/xtool. */
export function prepareShortInstallerLink(
  bottleDir: string,
  installerDir: string,
  installerFileName: string
): { windowsPath: string; windowsWorkingDir: string; linkPath: string | null } {
  const driveC = path.join(bottleDir, "drive_c");
  const linkPath = path.join(driveC, "_fg_inst");

  try {
    fs.mkdirSync(driveC, { recursive: true });
    if (fs.existsSync(linkPath) || fs.lstatSync(linkPath)) {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink() || stat.isFile()) {
        fs.unlinkSync(linkPath);
      }
    }
  } catch {
    // linkPath does not exist
  }

  try {
    if (!fs.existsSync(linkPath)) {
      fs.symlinkSync(installerDir, linkPath, "dir");
      return {
        windowsWorkingDir: `C:\\_fg_inst`,
        windowsPath: `C:\\_fg_inst\\${installerFileName}`,
        linkPath,
      };
    }
  } catch {
    // Caller falls back to standard toWineWindowsPath
  }

  return {
    windowsWorkingDir: "",
    windowsPath: "",
    linkPath: null,
  };
}

export function removeShortInstallerLink(linkPath: string | null): void {
  if (!linkPath) return;
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(linkPath);
    }
  } catch {
    // Ignore missing link
  }
}

/** Cleans stale Inno Setup `is-*.tmp` folders left by aborted repack runs. */
export function cleanupStaleInnoTempDirs(bottleDir: string): number {
  const tempRoots = [
    path.join(bottleDir, "drive_c", "users", "crossover", "Temp"),
    path.join(bottleDir, "drive_c", "windows", "temp"),
  ];
  let removed = 0;

  for (const tempRoot of tempRoots) {
    if (!fs.existsSync(tempRoot)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(tempRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!/^is-.*\.tmp$/i.test(entry.name)) continue;
      try {
        fs.rmSync(path.join(tempRoot, entry.name), {
          recursive: true,
          force: true,
        });
        removed += 1;
      } catch {
        // Ignore locked entries
      }
    }
  }

  return removed;
}
