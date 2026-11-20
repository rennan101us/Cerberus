import type {
  Game,
  GameShop,
  UnlockedAchievement,
  UserPreferences,
} from "@types";
import { achievementSyncCoordinator } from "./achievement-sync-coordinator";
import { achievementSyncWorker } from "./achievement-sync-worker";
import { WindowManager } from "../window-manager";
import { HydraApi } from "../hydra-api";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { db, levelKeys } from "@main/level";
import { getGameAchievementData } from "./get-game-achievement-data";
import { AchievementWatcherManager } from "./achievement-watcher-manager";
import { AchievementMemoryStore } from "./achievement-memory-store";
import { UnlockedAchievementsCache } from "./unlocked-achievements-cache";
import { publishAchievementUnlockNotifications } from "./achievement-unlock-notifications";
import { PendingAchievementSouvenirStore } from "./pending-achievement-souvenir-store";

interface MergeAchievementsOptions {
  skipSouvenirCapture?: boolean;
  alwaysUpdateInterface?: boolean;
}

const saveAchievementsInMemory = async (
  objectId: string,
  shop: GameShop,
  unlockedAchievements: UnlockedAchievement[],
  sendUpdateEvent: boolean,
  current: () => boolean = () => true
) => {
  const gameAchievement = AchievementMemoryStore.get(shop, objectId);
  AchievementMemoryStore.set(shop, objectId, {
    achievements: gameAchievement?.achievements ?? [],
    unlockedAchievements,
    language: gameAchievement?.language,
    catalogueValidator: gameAchievement?.catalogueValidator,
  });
  const since = UnlockedAchievementsCache.invalidate(shop, objectId);

  if (!sendUpdateEvent) return;

  return getUnlockedAchievements(objectId, shop, true, current)
    .then((achievements) => {
      if (!current()) return;
      UnlockedAchievementsCache.set(
        shop,
        objectId,
        achievements,
        current,
        since
      );
      WindowManager.mainWindow?.webContents.send(
        `on-update-achievements-${objectId}-${shop}`,
        achievements
      );
    })
    .catch(() => {});
};

const mergeAchievementsLocally = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean,
  options: MergeAchievementsOptions,
  current: () => boolean
) => {
  const gameKey = levelKeys.game(game.shop, game.objectId);

  let localGameAchievement = AchievementMemoryStore.get(
    game.shop,
    game.objectId
  );
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (!localGameAchievement) {
    await getGameAchievementData(game.objectId, game.shop, false, current);
    localGameAchievement = AchievementMemoryStore.get(game.shop, game.objectId);
  }

  if (!current()) throw new Error("achievement-sync-context-changed");
  const achievementsData = localGameAchievement?.achievements ?? [];
  const unlockedAchievements = localGameAchievement?.unlockedAchievements ?? [];

  const newAchievementsMap = new Map(
    achievements.toReversed().map((achievement) => {
      return [achievement.name.toUpperCase(), achievement];
    })
  );

  const newAchievements = [...newAchievementsMap.values()]
    .filter((achievement) => {
      return !unlockedAchievements.some((localAchievement) => {
        return (
          localAchievement.name.toUpperCase() === achievement.name.toUpperCase()
        );
      });
    })
    .map((achievement) => {
      return {
        name: achievement.name.toUpperCase(),
        unlockTime: achievement.unlockTime,
        hardcoreUnlockTime: achievement.hardcoreUnlockTime,
      };
    });

  const pendingImageKeys = await PendingAchievementSouvenirStore.get(gameKey);
  const mergedLocalAchievements = unlockedAchievements
    .concat(newAchievements)
    .map((achievement) => {
      const imageKey = pendingImageKeys[achievement.name.toUpperCase()];
      return imageKey ? { ...achievement, imageKey } : achievement;
    });

  if (!current()) throw new Error("achievement-sync-context-changed");
  if (publishNotification) {
    publishAchievementUnlockNotifications({
      game,
      achievements: newAchievements
        .toSorted((a, b) => a.unlockTime - b.unlockTime)
        .map((achievement) =>
          achievementsData.find(
            (steamAchievement) =>
              achievement.name.toUpperCase() ===
              steamAchievement.name.toUpperCase()
          )
        )
        .filter((achievement) => !!achievement),
      completesGame:
        newAchievements.length + unlockedAchievements.length ===
        achievementsData.length,
      unlockedAchievementCount: mergedLocalAchievements.length,
      totalAchievementCount: achievementsData.length,
      userPreferences,
    });
  }

  const achievementsToSync = mergedLocalAchievements;

  const shouldSyncWithRemote =
    Boolean(game.remoteId) && AchievementWatcherManager.hasFinishedPreSearch;

  await saveAchievementsInMemory(
    game.objectId,
    game.shop,
    achievementsToSync,
    publishNotification || options.alwaysUpdateInterface === true,
    current
  );
  if (!current()) throw new Error("achievement-sync-context-changed");
  if (shouldSyncWithRemote) {
    const context = HydraApi.getAuthContext();
    if (context)
      await achievementSyncWorker.enqueue({
        context,
        gameKey,
        remoteId: game.remoteId!,
        shop: game.shop,
        objectId: game.objectId,
        achievements: achievementsToSync,
      });
  }

  return newAchievements.length;
};

export const mergeAchievements = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean,
  options: MergeAchievementsOptions = {}
) => {
  if (game.shop === "epic") return 0;
  const context = HydraApi.getAuthContext();
  const current = () =>
    context
      ? HydraApi.isAuthContextCurrent(context)
      : HydraApi.getAuthContext() === null;
  const result = await achievementSyncCoordinator.runMerge(
    levelKeys.game(game.shop, game.objectId),
    (valid) =>
      mergeAchievementsLocally(
        game,
        achievements,
        publishNotification,
        options,
        valid
      ),
    current
  );
  void achievementSyncWorker.trigger();
  return result;
};
