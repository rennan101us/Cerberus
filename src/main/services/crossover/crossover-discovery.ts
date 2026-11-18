import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services/logger";
import { CrossOverDetector } from "./crossover-detector";
import { GameExecutables } from "@main/services/game-executables";
import { getGameAssets } from "@main/events/catalogue/get-game-assets";
import { createGame } from "@main/services/library-sync";
import { WindowManager } from "@main/services/window-manager";
import { LocalNotificationManager } from "@main/services/notifications/local-notifications";
import type { Game, GameShop } from "@types";

export interface BottleGameCandidate {
  title: string;
  executablePath: string;
  bottleName: string;
}

const IGNORE_EXECUTABLES = new Set([
  "unins000.exe",
  "uninstall.exe",
  "unitycrashhandler64.exe",
  "unitycrashhandler32.exe",
  "dxsetup.exe",
  "vc_redist.x64.exe",
  "vc_redist.x86.exe",
  "ueprereqsetup_x64.exe",
  "ue4prereqsetup_x64.exe",
  "createdump.exe",
  "pwsh.exe",
  "iexplore.exe",
  "wmplayer.exe",
  "wordpad.exe",
  "steamservice.exe",
  "steamcmd.exe",
  "steamerrorreporter.exe",
  "steamerrorreporter64.exe",
  "gameoverlayui.exe",
  "gameoverlayui64.exe",
  "streaming_client.exe",
  "steam.exe",
  "steamwebhelper.exe",
  "uplaywebcore.exe",
  "elevate.exe",
]);

export class CrossOverDiscovery {
  public static async findBottleGameCandidates(): Promise<
    BottleGameCandidate[]
  > {
    if (process.platform !== "darwin") return [];

    const candidates: BottleGameCandidate[] = [];
    try {
      const bottlesDir = await CrossOverDetector.getBottlesDirectory();
      const bottles = await CrossOverDetector.listBottles(bottlesDir);

      for (const bottle of bottles) {
        const bottlePath = path.join(bottlesDir, bottle);

        const gameRoots = [
          path.join(bottlePath, "drive_c", "Games"),
          path.join(bottlePath, "drive_c", "GOG Games"),
          path.join(
            bottlePath,
            "drive_c",
            "Program Files (x86)",
            "DODI-Repacks"
          ),
          path.join(bottlePath, "drive_c", "Program Files", "DODI-Repacks"),
          path.join(
            bottlePath,
            "drive_c",
            "Program Files (x86)",
            "Steam",
            "steamapps",
            "common"
          ),
          path.join(
            bottlePath,
            "drive_c",
            "Program Files",
            "Steam",
            "steamapps",
            "common"
          ),
        ];

        // Also check external drives in dosdevices
        const dosdevicesDir = path.join(bottlePath, "dosdevices");
        if (fs.existsSync(dosdevicesDir)) {
          const devEntries = await fs.promises
            .readdir(dosdevicesDir)
            .catch(() => [] as string[]);
          for (const dev of devEntries) {
            if (
              dev.startsWith("c") ||
              dev.startsWith("z") ||
              dev.includes("::")
            )
              continue;
            const devPath = path.join(dosdevicesDir, dev);
            try {
              const real = await fs.promises.realpath(devPath);
              for (const sub of [
                "Games",
                "GOG Games",
                "Steam/steamapps/common",
              ]) {
                const extTarget = path.join(real, sub);
                if (fs.existsSync(extTarget)) {
                  gameRoots.push(extTarget);
                }
              }
            } catch {
              // ignore
            }
          }
        }

        for (const root of gameRoots) {
          if (!fs.existsSync(root)) continue;
          const gameDirs = await fs.promises
            .readdir(root, { withFileTypes: true })
            .catch(() => [] as fs.Dirent[]);
          for (const dir of gameDirs) {
            if (!dir.isDirectory()) continue;
            const gameDir = path.join(root, dir.name);

            const foundExes = await this.findExecutablesInDir(gameDir, 0, 3);
            if (foundExes.length > 0) {
              const primaryExe = this.pickPrimaryExecutable(
                dir.name,
                foundExes
              );
              candidates.push({
                title: dir.name,
                executablePath: primaryExe,
                bottleName: bottle,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.warn(
        "[CrossOverDiscovery] Error scanning bottles for game candidates",
        error
      );
    }

    return candidates;
  }

  private static async findExecutablesInDir(
    current: string,
    depth = 0,
    maxDepth = 3
  ): Promise<string[]> {
    if (depth > maxDepth) return [];
    const exes: string[] = [];
    try {
      const entries = await fs.promises.readdir(current, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          const lower = entry.name.toLowerCase();
          if (
            lower !== "uninstall" &&
            !lower.includes("redist") &&
            !lower.includes("crashpad")
          ) {
            const nested = await this.findExecutablesInDir(
              fullPath,
              depth + 1,
              maxDepth
            );
            exes.push(...nested);
          }
        } else if (
          entry.isFile() &&
          entry.name.toLowerCase().endsWith(".exe")
        ) {
          if (!IGNORE_EXECUTABLES.has(entry.name.toLowerCase())) {
            exes.push(fullPath);
          }
        }
      }
    } catch {
      // ignore
    }
    return exes;
  }

  private static pickPrimaryExecutable(
    folderName: string,
    exes: string[]
  ): string {
    if (exes.length === 1) return exes[0];

    const folderClean = folderName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const sorted = [...exes].sort((a, b) => {
      const aName = path
        .basename(a)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const bName = path
        .basename(b)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

      const aMatch = aName.includes(folderClean) || folderClean.includes(aName);
      const bMatch = bName.includes(folderClean) || folderClean.includes(bName);

      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;

      return a.length - b.length;
    });

    return sorted[0];
  }

  public static async autoImportBottleGames(): Promise<number> {
    if (process.platform !== "darwin") return 0;

    try {
      const candidates = await this.findBottleGameCandidates();
      if (candidates.length === 0) return 0;

      const existingEntries = await gamesSublevel.iterator().all();
      const existingPaths = new Set(
        existingEntries.flatMap(([_key, game]) =>
          game.executablePath && !game.isDeleted
            ? [path.resolve(game.executablePath).toLowerCase()]
            : []
        )
      );

      await GameExecutables.ensureLoaded(true).catch(() => {});

      let addedCount = 0;

      for (const candidate of candidates) {
        const normalized = path.resolve(candidate.executablePath).toLowerCase();
        if (existingPaths.has(normalized)) continue;

        // 1. Check if it matches a Steam game in the catalogue
        const fileName = path.basename(candidate.executablePath).toLowerCase();
        let matchedAppId: string | null = null;

        for (const objectId of GameExecutables.getAllObjectIds()) {
          const executables = GameExecutables.getExecutablesForGame(objectId);
          if (executables?.some((e) => e.exe.toLowerCase() === fileName)) {
            matchedAppId = objectId;
            break;
          }
        }

        if (matchedAppId) {
          const assets = await getGameAssets(matchedAppId, "steam").catch(
            () => null
          );
          if (assets?.title) {
            const gameKey = levelKeys.game("steam", matchedAppId);
            const existingGame = await gamesSublevel
              .get(gameKey)
              .catch(() => null);

            const steamGame: Game = {
              ...existingGame,
              title: existingGame?.title ?? assets.title,
              iconUrl: assets.iconUrl,
              libraryHeroImageUrl: assets.libraryHeroImageUrl,
              logoImageUrl: assets.logoImageUrl,
              objectId: matchedAppId,
              shop: "steam",
              remoteId: existingGame?.remoteId ?? null,
              isDeleted: false,
              playTimeInMilliseconds: existingGame?.playTimeInMilliseconds ?? 0,
              lastTimePlayed: existingGame?.lastTimePlayed ?? null,
              addedToLibraryAt: existingGame?.addedToLibraryAt ?? new Date(),
              platform: existingGame?.platform ?? null,
              executablePath: candidate.executablePath,
              executablePathUpdatedAt: new Date(),
            };

            await gamesSublevel.put(gameKey, steamGame);
            await createGame(steamGame).catch(() => {});
            existingPaths.add(normalized);
            addedCount++;
            logger.info(
              `[CrossOverDiscovery] Auto-imported Steam game: ${steamGame.title} (${candidate.executablePath})`
            );
            continue;
          }
        }

        // 2. Otherwise, add as a Custom Game
        const objectId = crypto.randomUUID();
        const shop: GameShop = "custom";
        const gameKey = levelKeys.game(shop, objectId);

        const customAssets = {
          updatedAt: Date.now(),
          objectId,
          shop,
          title: candidate.title,
          iconUrl: null,
          libraryHeroImageUrl: "",
          libraryImageUrl: "",
          logoImageUrl: "",
          logoPosition: null,
          coverImageUrl: "",
          downloadSources: [],
        };
        await gamesShopAssetsSublevel.put(gameKey, customAssets);

        const customGame: Game = {
          title: candidate.title,
          iconUrl: null,
          logoImageUrl: null,
          libraryHeroImageUrl: null,
          objectId,
          shop,
          remoteId: null,
          isDeleted: false,
          playTimeInMilliseconds: 0,
          lastTimePlayed: null,
          addedToLibraryAt: new Date(),
          executablePath: candidate.executablePath,
          executablePathUpdatedAt: new Date(),
          launchOptions: null,
          favorite: false,
          automaticCloudSync: false,
          hasManuallyUpdatedPlaytime: false,
        };

        await gamesSublevel.put(gameKey, customGame);
        existingPaths.add(normalized);
        addedCount++;
        logger.info(
          `[CrossOverDiscovery] Auto-imported Custom Game: ${candidate.title} (${candidate.executablePath})`
        );
      }

      if (addedCount > 0) {
        logger.info(
          `[CrossOverDiscovery] Total games auto-imported: ${addedCount}`
        );
        WindowManager.sendToAppWindows("on-library-batch-complete");
        await LocalNotificationManager.createNotification(
          "SCAN_GAMES_COMPLETE",
          "Fine Wine",
          `${addedCount} jogo(s) encontrados no Fine Wine foram adicionados à sua biblioteca!`,
          { url: "/library" }
        ).catch(() => {});
      }

      return addedCount;
    } catch (error) {
      logger.error("[CrossOverDiscovery] Error during auto-import", error);
      return 0;
    }
  }
}
