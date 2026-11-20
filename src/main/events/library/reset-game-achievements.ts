import {
  achievementSyncCoordinator,
  AchievementSyncCancelledError,
} from "@main/services/achievements/achievement-sync-coordinator";
import type { HydraApiAuthContext } from "@main/services/hydra-auth-context";
import { achievementSyncWorker } from "@main/services/achievements/achievement-sync-worker";
import { registerEvent } from "../register-event";
import { collectGameAchievementFiles } from "@main/services/achievements/collect-game-achievement-files";
import fs from "fs";
import {
  achievementsLogger,
  emulators,
  HydraApi,
  WindowManager,
} from "@main/services";
import { getUnlockedAchievements } from "../user/get-unlocked-achievements";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import { AchievementSouvenirStore } from "@main/services/achievements/achievement-souvenir-store";
import { UnlockedAchievementsCache } from "@main/services/achievements/unlocked-achievements-cache";
import {
  cancelPendingSouvenirsForGame,
  deleteLocalSouvenirAssetsForGame,
} from "@main/services/achievements/grouped-souvenir-worker";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { updateGameRecord } from "@main/services/game-record-updater";
import { removeShadps4TrophyFile } from "@main/services/emulators/shadps4-trophy-watcher";
import { removeRpcs3TrophyFiles } from "@main/services/emulators/rpcs3-trophy-sources";
import { resetRecompilationTrophies } from "../recompilation/recompilation-trophy-reset";

const resetGameAchievementsNow = async (
  shop: GameShop,
  objectId: string,
  context: HydraApiAuthContext | null
) => {
  const current = () =>
    context
      ? HydraApi.isAuthContextCurrent(context)
      : HydraApi.getAuthContext() === null;
  const assertCurrent = () => {
    if (!current()) throw new AchievementSyncCancelledError();
  };
  try {
    assertCurrent();
    const levelKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(levelKey);

    assertCurrent();
    if (!game) return;

    await achievementSyncWorker.cancelGame(levelKey);
    await cancelPendingSouvenirsForGame(levelKey);
    assertCurrent();

    const achievementFiles = await collectGameAchievementFiles(game, {
      includeSteamCache: false,
      awaitGameDirectoryLocations: true,
    });

    for (const achievementFile of achievementFiles) {
      assertCurrent();
      achievementsLogger.log(`deleting ${achievementFile.filePath}`);

      await fs.promises.rm(achievementFile.filePath, {
        force: true,
        recursive: true,
      });
    }

    await removeShadps4TrophyFile(game);
    await removeRpcs3TrophyFiles(game);
    await resetRecompilationTrophies(game);

    assertCurrent();
    AchievementWatcherManager.forgetAchievementFiles(
      levelKey,
      achievementFiles.map((achievementFile) => achievementFile.filePath)
    );

    if (game.reportedUnlockedAchievementCount !== undefined) {
      await updateGameRecord(levelKey, {
        reportedUnlockedAchievementCount: undefined,
      });
    }

    const gameAchievements = AchievementMemoryStore.get(shop, objectId);
    if (gameAchievements) {
      AchievementMemoryStore.set(shop, objectId, {
        ...gameAchievements,
        unlockedAchievements: [],
      });
    }
    const since = UnlockedAchievementsCache.invalidate(shop, objectId);

    await deleteLocalSouvenirAssetsForGame(levelKey);
    assertCurrent();
    AchievementSouvenirStore.invalidate(shop, objectId);
    achievementsLogger.log(
      `Deleted local achievements for ${game.objectId} - ${game.title}`
    );

    const updatedAchievements = await getUnlockedAchievements(
      game.objectId,
      game.shop,
      false,
      current
    );

    assertCurrent();
    UnlockedAchievementsCache.set(
      game.shop,
      game.objectId,
      updatedAchievements,
      current,
      since
    );
    WindowManager.mainWindow?.webContents.send(
      `on-update-achievements-${game.objectId}-${game.shop}`,
      updatedAchievements
    );
  } catch (error) {
    achievementsLogger.error(error);
    throw error;
  }
};

const resetGameAchievements = (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const context = HydraApi.getAuthContext();
  if (
    emulators.emulatorSessions.get(levelKeys.game(shop, objectId))?.system ===
    "ps3"
  ) {
    return Promise.reject(new Error("reset_achievements_game_running"));
  }
  UnlockedAchievementsCache.invalidate(shop, objectId);
  return achievementSyncCoordinator.resetGame(
    levelKeys.game(shop, objectId),
    () => resetGameAchievementsNow(shop, objectId, context),
    () =>
      context
        ? HydraApi.isAuthContextCurrent(context)
        : HydraApi.getAuthContext() === null
  );
};
registerEvent("resetGameAchievements", resetGameAchievements);
