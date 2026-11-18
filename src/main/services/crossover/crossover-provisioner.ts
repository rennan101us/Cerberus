import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { CrossOverProvisionProgress } from "@types";
import { CrossOverDetector, DEFAULT_BOTTLE_NAME } from "./crossover-detector";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);

export class CrossOverProvisioner {
  public static async resetTrial(): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const nowIso = new Date().toISOString();
      const homeDir = os.homedir();
      const plistPath = path.join(
        homeDir,
        "Library",
        "Preferences",
        "com.codeweavers.CrossOver.plist"
      );

      // 1. Update plist if it exists or create directory if needed
      const plistDir = path.dirname(plistPath);
      if (!fs.existsSync(plistDir)) {
        await fs.promises.mkdir(plistDir, { recursive: true });
      }

      await execFileAsync("/usr/bin/defaults", [
        "write",
        plistPath,
        "FirstRunDate",
        "-date",
        nowIso,
      ]).catch(() => null);

      await execFileAsync("/usr/bin/defaults", [
        "write",
        plistPath,
        "SULastCheckTime",
        "-date",
        nowIso,
      ]).catch(() => null);

      // Flush preference caching daemon
      await execFileAsync("/usr/bin/killall", ["cfprefsd"]).catch(() => null);

      // 2. Clean system.reg across all bottles
      const bottlesDir = await CrossOverDetector.getBottlesDirectory();
      let cleanedCount = 0;

      if (fs.existsSync(bottlesDir)) {
        const bottleFolders = await fs.promises.readdir(bottlesDir, {
          withFileTypes: true,
        });

        for (const entry of bottleFolders) {
          if (!entry.isDirectory()) continue;
          const regPath = path.join(bottlesDir, entry.name, "system.reg");
          if (!fs.existsSync(regPath)) continue;

          try {
            const content = await fs.promises.readFile(regPath, "utf-8");
            if (content.includes("CodeWeavers\\CrossOver\\cxoffice")) {
              const lines = content.split("\n");
              const newLines: string[] = [];
              let skip = false;

              for (const line of lines) {
                if (
                  line.startsWith(
                    "[Software\\CodeWeavers\\CrossOver\\cxoffice]"
                  )
                ) {
                  skip = true;
                  continue;
                }
                if (skip) {
                  // End of section on empty line or next section header
                  if (line.startsWith("[") || line.trim() === "") {
                    skip = false;
                    if (line.startsWith("[")) {
                      newLines.push(line);
                    }
                  }
                  continue;
                }
                newLines.push(line);
              }

              // Create backup if not present
              const bakPath = `${regPath}.bak`;
              if (!fs.existsSync(bakPath)) {
                await fs.promises.copyFile(regPath, bakPath);
              }

              await fs.promises.writeFile(
                regPath,
                newLines.join("\n"),
                "utf-8"
              );
              cleanedCount++;
            }
          } catch (regError) {
            logger.warn(
              `[CrossOver] Failed to clean registry in ${entry.name}`,
              regError
            );
          }
        }
      }

      logger.info(
        `[CrossOver] Trial reset completed successfully. Plist updated, ${cleanedCount} bottles cleaned.`
      );
      return {
        success: true,
        message: `Trial reset successfully (${cleanedCount} bottles cleaned)`,
      };
    } catch (error) {
      logger.error("[CrossOver] Trial reset failed", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  public static async configureBottleOptimalDefaults(
    bottleDir: string
  ): Promise<void> {
    const confPath = path.join(bottleDir, "cxbottle.conf");
    if (!fs.existsSync(confPath)) return;

    try {
      let content = await fs.promises.readFile(confPath, "utf-8");

      // Check if [EnvironmentVariables] exists
      if (!content.includes("[EnvironmentVariables]")) {
        content += "\n[EnvironmentVariables]\n";
      }

      const optimalSettings: Record<string, string> = {
        CX_GRAPHICS_BACKEND: "d3dmetal",
        WINEMSYNC: "1",
        D3DM_ENABLE_METALFX: "1",
        D3DM_SUPPORT_DXR: "1",
        ROSETTA_ADVERTISE_AVX: "1",
        DXMT_ENABLE_NVEXT: "1",
        D3DM_MTL4: "1",
      };

      for (const [key, val] of Object.entries(optimalSettings)) {
        const regex = new RegExp(`^"${key}"\\s*=.*$`, "m");
        const entry = `"${key}" = "${val}"`;
        if (regex.test(content)) {
          content = content.replace(regex, entry);
        } else {
          // Append after [EnvironmentVariables]
          content = content.replace(
            "[EnvironmentVariables]",
            `[EnvironmentVariables]\n${entry}`
          );
        }
      }

      await fs.promises.writeFile(confPath, content, "utf-8");
      logger.info(
        `[CrossOver] Configured optimal settings for bottle at ${bottleDir}`
      );
    } catch (error) {
      logger.warn(
        "[CrossOver] Failed to write optimal settings to cxbottle.conf",
        error
      );
    }
  }

  public static async ensureBottle(
    bottleName = DEFAULT_BOTTLE_NAME
  ): Promise<string> {
    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    if (!fs.existsSync(bottlesDir)) {
      await fs.promises.mkdir(bottlesDir, { recursive: true });
    }

    const bottleDir = path.join(bottlesDir, bottleName);
    const confPath = path.join(bottleDir, "cxbottle.conf");

    if (fs.existsSync(confPath)) {
      return bottleDir;
    }

    const cxbottleBin = CrossOverDetector.getBinaryPath("cxbottle");
    if (!cxbottleBin) {
      throw new Error("CrossOver command-line tool 'cxbottle' not found");
    }

    logger.info(
      `[CrossOver] Creating bottle '${bottleName}' with win10_64 template...`
    );

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        cxbottleBin,
        ["--bottle", bottleName, "--create", "--template", "win10_64"],
        {
          env: {
            ...process.env,
            CX_BOTTLE_PATH: bottlesDir,
          },
          stdio: "ignore",
        }
      );

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`cxbottle exited with code ${code}`));
        }
      });

      proc.on("error", reject);
    });

    await this.configureBottleOptimalDefaults(bottleDir);
    return bottleDir;
  }

  public static async downloadAndInstallCrossOver(
    onProgress?: (progress: CrossOverProvisionProgress) => void
  ): Promise<string> {
    const updateProgress = (
      phase: CrossOverProvisionProgress["phase"],
      progress: number,
      message?: string,
      error?: string
    ) => {
      onProgress?.({ phase, progress, message, error });
    };

    updateProgress("checking", 0, "Checking CrossOver release...");
    const release = await CrossOverDetector.checkLatestRelease();
    const downloadUrl =
      release.downloadUrl ||
      "https://media.codeweavers.com/pub/crossover/cxmac/demo/crossover-26.3.0.zip";

    const tmpDir = path.join(os.tmpdir(), "hydra-crossover-install");
    if (!fs.existsSync(tmpDir)) {
      await fs.promises.mkdir(tmpDir, { recursive: true });
    }
    const zipPath = path.join(tmpDir, "crossover.zip");

    updateProgress("downloading", 5, "Downloading CrossOver...");

    // Download stream with progress
    const response = await fetch(downloadUrl, {
      headers: {
        "User-Agent": "CrossOver/26.3.0 Sparkle/1.26.0",
      },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download CrossOver: HTTP ${response.status}`);
    }

    const contentLength =
      Number(response.headers.get("content-length")) || 380_000_000;
    let downloadedBytes = 0;

    const fileStream = fs.createWriteStream(zipPath);
    const reader = response.body.getReader();

    let isReading = true;
    while (isReading) {
      const { done, value } = await reader.read();
      if (done) {
        isReading = false;
        break;
      }
      if (value) {
        fileStream.write(Buffer.from(value));
        downloadedBytes += value.length;
        const pct = Math.min(
          85,
          5 + Math.round((downloadedBytes / contentLength) * 80)
        );
        updateProgress(
          "downloading",
          pct,
          `Downloading CrossOver (${Math.round(downloadedBytes / 1024 / 1024)} MB)...`
        );
      }
    }
    fileStream.end();

    await new Promise<void>((resolve, reject) => {
      fileStream.on("finish", resolve);
      fileStream.on("error", reject);
    });

    updateProgress("extracting", 88, "Extracting CrossOver to Applications...");

    // Target installation directory: prefer /Applications, fallback to ~/Applications
    let targetAppsDir = "/Applications";
    try {
      await fs.promises.access(targetAppsDir, fs.constants.W_OK);
    } catch {
      targetAppsDir = path.join(os.homedir(), "Applications");
      if (!fs.existsSync(targetAppsDir)) {
        await fs.promises.mkdir(targetAppsDir, { recursive: true });
      }
    }

    // Extract using ditto for full macOS bundle preservation
    await execFileAsync("/usr/bin/ditto", ["-xk", zipPath, targetAppsDir], {
      timeout: 120_000,
    });

    const targetAppPath = path.join(targetAppsDir, "CrossOver.app");

    // Remove quarantine flag
    await execFileAsync("/usr/bin/xattr", [
      "-dr",
      "com.apple.quarantine",
      targetAppPath,
    ]).catch(() => null);

    // Clean up zip
    await fs.promises
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => null);

    updateProgress("configuring", 95, "Setting up bottle and trial...");

    // Run trial reset
    await this.resetTrial();

    // Ensure default bottle
    await this.ensureBottle(DEFAULT_BOTTLE_NAME).catch((err) => {
      logger.warn("[CrossOver] Initial bottle setup warning", err);
    });

    updateProgress("done", 100, "CrossOver setup completed!");
    return targetAppPath;
  }
}
