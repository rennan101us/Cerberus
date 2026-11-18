import { spawn, type ChildProcess } from "node:child_process";
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
        "CrossOver is not installed. Please install it in Compatibility options."
      );
    }

    // 1. Run automatic trial reset before launching
    await CrossOverProvisioner.resetTrial().catch((err) => {
      logger.warn("[CrossOver] Pre-launch trial reset warning", err);
    });

    // 2. Determine bottle
    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    const bottleName =
      game.macOSCompatibility?.bottleName || DEFAULT_BOTTLE_NAME;

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
    const args: string[] = [
      "--bottle",
      bottleName,
      "--cx-app",
      game.executablePath,
    ];

    // Append launch options
    const rawOptions = (launchOptionsString || game.launchOptions || "").trim();
    if (rawOptions) {
      args.push(...rawOptions.split(/\s+/));
    }

    logger.info(
      `[CrossOver] Launching game in bottle '${bottleName}': ${game.executablePath}`
    );

    const proc = spawn(wineBin, args, {
      cwd: workingDir,
      env,
      detached: true,
      stdio: "ignore",
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
      throw new Error("CrossOver is not installed");
    }

    await CrossOverProvisioner.resetTrial().catch((err) => {
      logger.warn("[CrossOver] Pre-installer trial reset warning", err);
    });

    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    const bottleName = options.bottleName || DEFAULT_BOTTLE_NAME;

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
    const args: string[] = [
      "--bottle",
      bottleName,
      "--wait-children",
      "--cx-app",
      options.installerPath,
    ];

    logger.info(
      `[CrossOver] Executing installer in bottle '${bottleName}': ${options.installerPath}`
    );

    const proc: ChildProcess = spawn(wineBin, args, {
      cwd: workingDir,
      env,
      stdio: "ignore",
    });

    if (options.onExit) {
      proc.on("close", (code) => {
        options.onExit?.(code);
      });
      proc.on("exit", (code) => {
        options.onExit?.(code);
      });
    }

    return {
      spawned: true,
      pid: proc.pid,
    };
  }
}
