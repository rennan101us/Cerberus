import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Game, MacOSCompatibilityOptions } from "@types";
import { CrossOverDetector, DEFAULT_BOTTLE_NAME } from "./crossover-detector";
import { CrossOverProvisioner } from "./crossover-provisioner";
import { logger } from "../logger";

export interface CrossOverLaunchOptions {
  executablePath: string;
  args?: string[];
  launchOptions?: string | null;
  compatibility?: MacOSCompatibilityOptions;
  cwd?: string;
  onExit?: (code: number | null) => void;
  waitChildren?: boolean;
}

export class CrossOverRunner {
  public static async prepareLaunchEnvironment(
    compatibility?: MacOSCompatibilityOptions,
    bottleDir?: string
  ): Promise<Record<string, string>> {
    const backend = compatibility?.graphicsBackend ?? "d3dmetal";
    const syncMode = compatibility?.syncMode ?? "msync";
    const metalHud = compatibility?.metalHud ?? false;
    const rosettaAvx = compatibility?.rosettaAvx ?? true;
    const highRes = compatibility?.highResolutionMode ?? false;

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      CX_GRAPHICS_BACKEND: backend,
      D3DM_ENABLE_METALFX: "1",
      D3DM_SUPPORT_DXR: "1",
      DXMT_ENABLE_NVEXT: "1",
      D3DM_MTL4: "1",
    };

    if (bottleDir) {
      env.WINEPREFIX = bottleDir;
    }

    // Backend specifics
    switch (backend) {
      case "d3dmetal":
        env.WINED3DMETAL = "1";
        env.DXVK = "0";
        break;
      case "dxmt":
        env.DXMT = "1";
        env.WINED3DMETAL = "0";
        env.DXVK = "0";
        break;
      case "dxvk":
        env.DXVK = "1";
        env.WINED3DMETAL = "0";
        break;
      case "wined3d":
        env.WINED3DMETAL = "0";
        env.DXVK = "0";
        break;
    }

    // Sync mode
    switch (syncMode) {
      case "msync":
        env.WINEMSYNC = "1";
        env.WINEESYNC = "0";
        break;
      case "esync":
        env.WINEESYNC = "1";
        env.WINEMSYNC = "0";
        break;
      case "none":
        env.WINEMSYNC = "0";
        env.WINEESYNC = "0";
        break;
    }

    // Metal HUD
    if (metalHud) {
      env.MTL_HUD_ENABLED = "1";
    }

    // Rosetta AVX
    if (rosettaAvx) {
      env.ROSETTA_ADVERTISE_AVX = "1";
    }

    // High resolution Retina
    if (highRes) {
      env.WINE_HIGH_DPI = "1";
    }

    // Custom user environment variables
    if (compatibility?.environmentVariables) {
      Object.assign(env, compatibility.environmentVariables);
    }

    return env;
  }

  public static async toWineWindowsPath(
    posixPath: string,
    bottleDir: string
  ): Promise<string> {
    if (/^[a-zA-Z]:[/\\]/.test(posixPath)) {
      return posixPath.replace(/\\/g, "/");
    }

    const driveC = path.join(bottleDir, "drive_c");
    const relDriveC = path.relative(driveC, posixPath);

    // 1. Inside bottle's drive_c -> C:/...
    if (!relDriveC.startsWith("..") && !path.isAbsolute(relDriveC)) {
      return `C:/${relDriveC.split(path.sep).join("/")}`;
    }

    // 2. Check dosdevices symlinks (e.g. d: -> /Volumes/Nintendo, y: -> /Users/rennan)
    const dosdevicesDir = path.join(bottleDir, "dosdevices");
    if (fs.existsSync(dosdevicesDir)) {
      try {
        const entries = await fs.promises.readdir(dosdevicesDir);
        for (const entry of entries) {
          if (!entry.endsWith(":") || entry.includes("::")) continue;
          const linkPath = path.join(dosdevicesDir, entry);
          try {
            const target = await fs.promises.realpath(linkPath);
            const relTarget = path.relative(target, posixPath);
            if (!relTarget.startsWith("..") && !path.isAbsolute(relTarget)) {
              const driveLetter = entry.slice(0, 1).toUpperCase();
              return `${driveLetter}:/${relTarget.split(path.sep).join("/")}`;
            }
          } catch {
            // Ignore broken link
          }
        }
      } catch {
        // Ignore read error
      }
    }

    // 3. Fallback: Z: drive maps to root / in Wine
    return `Z:/${posixPath.replace(/^\/+/, "")}`;
  }

  public static async launchGame(
    game: Game,
    launchOptionsString?: string | null
  ): Promise<number | null> {
    if (!game.executablePath) {
      throw new Error(`Game '${game.title}' has no executable path set`);
    }

    const appPath = CrossOverDetector.findCrossOverApp();
    if (!appPath) {
      throw new Error(
        "Fine Wine is not installed. Please set it up in Compatibility options."
      );
    }

    // 1. Run automatic Fine Reset before launching
    await CrossOverProvisioner.resetTrial().catch((err) => {
      logger.warn("[FineWine] Pre-launch Fine Reset notice", err);
    });

    // 2. Determine bottle
    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    let bottleName = game.macOSCompatibility?.bottleName;

    // Detect actual bottle if executable is located inside a bottle directory
    if (bottlesDir && game.executablePath) {
      const relToBottles = path.relative(bottlesDir, game.executablePath);
      if (!relToBottles.startsWith("..") && !path.isAbsolute(relToBottles)) {
        const detected = relToBottles.split(path.sep)[0];
        if (detected) {
          bottleName = detected;
        }
      }
    }

    if (!bottleName) {
      bottleName = DEFAULT_BOTTLE_NAME;
    }

    await CrossOverProvisioner.ensureBottle(bottleName).catch((err) => {
      logger.warn(`[CrossOver] Bottle ensure warning for '${bottleName}'`, err);
    });

    const bottleDir = path.join(bottlesDir, bottleName);
    const wineBin = CrossOverDetector.getBinaryPath("wine");
    if (!wineBin) {
      throw new Error("CrossOver wine binary not found");
    }

    const env = await this.prepareLaunchEnvironment(
      game.macOSCompatibility,
      bottleDir
    );
    env.CX_BOTTLE_PATH = bottlesDir;

    const workingDir = path.dirname(game.executablePath);
    const windowsPath = await this.toWineWindowsPath(
      game.executablePath,
      bottleDir
    );

    const args: string[] = [
      "--bottle",
      bottleName,
      "--wait-children",
      "--cx-app",
      windowsPath,
    ];

    // Append launch options
    const rawOptions = (launchOptionsString || game.launchOptions || "").trim();
    if (rawOptions) {
      args.push(...rawOptions.split(/\s+/));
    }

    logger.info(
      `[CrossOver] Launching game in bottle '${bottleName}': ${game.executablePath} -> ${windowsPath}`
    );

    const proc = spawn(wineBin, args, {
      cwd: workingDir,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      logger.info(`[FineWine:${bottleName}] ${chunk.toString().trim()}`);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      logger.warn(`[FineWine:${bottleName}] ${chunk.toString().trim()}`);
    });

    proc.on("error", (error) => {
      logger.error(`[CrossOver] Failed to launch game '${game.title}'`, error);
    });

    proc.unref();

    const pid = proc.pid ?? null;
    return pid;
  }

  public static async executeInstaller(options: {
    installerPath: string;
    bottleName?: string;
    compatibility?: MacOSCompatibilityOptions;
    onExit?: (code: number | null) => void;
  }): Promise<{ spawned: boolean; pid?: number }> {
    const appPath = CrossOverDetector.findCrossOverApp();
    if (!appPath) {
      throw new Error("Fine Wine is not installed");
    }

    await CrossOverProvisioner.resetTrial().catch((err) => {
      logger.warn("[FineWine] Pre-installer Fine Reset notice", err);
    });

    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    let bottleName = options.bottleName;

    if (bottlesDir && options.installerPath) {
      const relToBottles = path.relative(bottlesDir, options.installerPath);
      if (!relToBottles.startsWith("..") && !path.isAbsolute(relToBottles)) {
        const detected = relToBottles.split(path.sep)[0];
        if (detected) {
          bottleName = detected;
        }
      }
    }

    if (!bottleName) {
      bottleName = DEFAULT_BOTTLE_NAME;
    }

    await CrossOverProvisioner.ensureBottle(bottleName).catch((err) => {
      logger.warn(`[CrossOver] Bottle ensure warning for '${bottleName}'`, err);
    });

    const bottleDir = path.join(bottlesDir, bottleName);
    const wineBin = CrossOverDetector.getBinaryPath("wine");
    if (!wineBin) {
      throw new Error("CrossOver wine binary not found");
    }

    const env = await this.prepareLaunchEnvironment(
      options.compatibility,
      bottleDir
    );
    env.CX_BOTTLE_PATH = bottlesDir;

    const workingDir = path.dirname(options.installerPath);
    const windowsPath = await this.toWineWindowsPath(
      options.installerPath,
      bottleDir
    );

    const ext = path.extname(options.installerPath).toLowerCase();
    let args: string[];

    if (ext === ".msi") {
      args = [
        "--bottle",
        bottleName,
        "--wait-children",
        "--cx-app",
        "msiexec",
        "/i",
        windowsPath,
      ];
    } else if (ext === ".bat" || ext === ".cmd") {
      args = [
        "--bottle",
        bottleName,
        "--wait-children",
        "--cx-app",
        "cmd",
        "/c",
        windowsPath,
      ];
    } else {
      args = [
        "--bottle",
        bottleName,
        "--wait-children",
        "--cx-app",
        windowsPath,
      ];
    }

    logger.info(
      `[CrossOver] Executing installer in bottle '${bottleName}': ${options.installerPath} -> ${windowsPath}`
    );

    const proc: ChildProcess = spawn(wineBin, args, {
      cwd: workingDir,
      env,
      stdio: "ignore",
    });

    if (options.onExit) {
      let exitFired = false;
      const safeExit = (code: number | null) => {
        if (exitFired) return;
        exitFired = true;
        options.onExit?.(code);
      };
      proc.once("close", safeExit);
      proc.once("exit", safeExit);
    }

    return {
      spawned: true,
      pid: proc.pid,
    };
  }
}
