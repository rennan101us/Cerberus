import fs from "node:fs";

import type { Game } from "@types";

import { INTERVALS } from "@main/constants";
import { achievementsLogger } from "../logger";
import { duckstationLogPath, pcsx2LogPath } from "./emulator-log-paths";
import type { EmulatorSessionSystem } from "./emulator-session-tracker";
import { createRetroAchievementsRealtimeUnlocks } from "../retro-achievements/retro-achievements-realtime-unlocks";
import { readEmulatorSignedInUsername } from "../retro-achievements/emulator-credentials/emulator-credential-sync";
import type { DetectedRetroAchievementUnlock } from "../retro-achievements/retro-achievements-unlock-confirmer";
import {
  getEmulatorAchievementLogFormat,
  parseEmulatorAchievementLogLine,
} from "./emulator-achievement-log";
import { isEmulatorAchievementTrackingActive } from "./emulator-achievement-tracking";
import { loadEmulatorAchievementTracking } from "./load-emulator-achievement-tracking";

type EmulatorAchievementLogFormat = NonNullable<
  ReturnType<typeof getEmulatorAchievementLogFormat>
>;

interface WatcherRegistration {
  token: object;
  timer: ReturnType<typeof setInterval> | null;
}

const watchers = new Map<string, WatcherRegistration>();

const uniqueUnlocks = (achievements: DetectedRetroAchievementUnlock[]) =>
  Array.from(
    new Map(
      achievements.map((achievement) => [
        achievement.id.toLowerCase(),
        achievement,
      ])
    ).values()
  );

const createLogTail = (
  logPath: string,
  format: EmulatorAchievementLogFormat,
  initialOffset?: number
) => {
  let offset =
    initialOffset ?? (fs.existsSync(logPath) ? fs.statSync(logPath).size : 0);
  let remainder = "";

  return async (): Promise<DetectedRetroAchievementUnlock[]> => {
    const stats = await fs.promises.stat(logPath).catch(() => null);

    if (!stats) return [];

    if (stats.size < offset) {
      offset = 0;
      remainder = "";
    }

    if (stats.size === offset) return [];

    const handle = await fs.promises.open(logPath, "r");
    const length = stats.size - offset;
    const buffer = Buffer.alloc(length);

    await handle.read(buffer, 0, length, offset);
    await handle.close();

    offset = stats.size;

    const lines = (remainder + buffer.toString("utf8")).split(/\r?\n/);
    remainder = lines.pop() ?? "";

    return lines
      .map((line) => parseEmulatorAchievementLogLine(line, format))
      .filter((achievement) => !!achievement);
  };
};

interface StartLogWatcherOptions {
  getEmulatorUsername: () => Promise<string | null>;
  gameKey: string;
  watcherToken: object;
  game: Game;
  logPath: string;
  format: EmulatorAchievementLogFormat;
  initialOffset?: number;
  primeRealtimeUnlocks: boolean;
}

const startLogWatcher = ({
  getEmulatorUsername,
  gameKey,
  watcherToken,
  game,
  logPath,
  format,
  initialOffset,
  primeRealtimeUnlocks,
}: StartLogWatcherOptions) => {
  const readNewUnlocks = createLogTail(logPath, format, initialOffset);
  const realtimeUnlocks = createRetroAchievementsRealtimeUnlocks(game, {
    getEmulatorUsername,
  });
  if (primeRealtimeUnlocks) realtimeUnlocks.prime();
  let isProcessing = false;

  achievementsLogger.info("Started emulator achievement watcher", {
    objectId: game.objectId,
    logPath,
  });

  const watcher = setInterval(() => {
    if (isProcessing) return;
    isProcessing = true;

    void (async () => {
      const achievements = uniqueUnlocks(await readNewUnlocks());
      if (achievements.length === 0) return;

      achievementsLogger.info("Detected emulator achievement unlocks", {
        objectId: game.objectId,
        achievementIds: achievements.map(({ id }) => id),
      });

      const tracking = await loadEmulatorAchievementTracking();

      if (tracking.realtimeUnlocks) {
        void realtimeUnlocks.enqueue(achievements);
      }
    })()
      .catch((error) => {
        achievementsLogger.error(
          "Failed to handle emulator achievement unlocks",
          game.objectId,
          error
        );
      })
      .finally(() => {
        isProcessing = false;
      });
  }, INTERVALS.emulatorSouvenirWatcher);

  watcher.unref?.();
  const registration = watchers.get(gameKey);

  if (registration?.token === watcherToken) {
    registration.timer = watcher;
  } else {
    clearInterval(watcher);
  }
};

interface StartEmulatorSouvenirWatcherOptions {
  gameKey: string;
  game: Game;
  system: EmulatorSessionSystem;
  executablePath: string;
  processId: number;
  watcherToken: object;
  logPath?: string;
  logOffset?: number;
}

const configuredLogPathForSystem = (
  system: EmulatorSessionSystem,
  executablePath: string
): string | null => {
  if (system === "ps1") return duckstationLogPath();
  if (system === "ps2") return pcsx2LogPath(executablePath);
  return null;
};

export const startEmulatorSouvenirWatcher = async ({
  gameKey,
  game,
  system,
  executablePath,
  processId: _processId,
  watcherToken,
  logPath: sessionLogPath,
  logOffset: sessionLogOffset,
}: StartEmulatorSouvenirWatcherOptions) => {
  const previousWatcher = watchers.get(gameKey);
  if (previousWatcher?.timer) clearInterval(previousWatcher.timer);
  watchers.set(gameKey, { token: watcherToken, timer: null });

  const tracking = await loadEmulatorAchievementTracking();
  if (!isEmulatorAchievementTrackingActive(tracking)) {
    stopEmulatorSouvenirWatcher(gameKey, watcherToken);
    return;
  }
  if (watchers.get(gameKey)?.token !== watcherToken) return;

  const format = getEmulatorAchievementLogFormat(system);
  const logPath =
    sessionLogPath ?? configuredLogPathForSystem(system, executablePath);

  if (!format || !logPath) {
    if (format) {
      achievementsLogger.warn(
        "Could not start emulator achievement watcher without a log path",
        { objectId: game.objectId, system, executablePath }
      );
    }
    stopEmulatorSouvenirWatcher(gameKey, watcherToken);
    return;
  }

  startLogWatcher({
    getEmulatorUsername: () =>
      readEmulatorSignedInUsername(system, executablePath),
    gameKey,
    watcherToken,
    game,
    logPath,
    format,
    initialOffset: sessionLogOffset,
    primeRealtimeUnlocks: tracking.realtimeUnlocks,
  });
};

export const stopEmulatorSouvenirWatcher = (
  gameKey: string,
  watcherToken?: object
) => {
  const registration = watchers.get(gameKey);

  if (!registration) return;
  if (watcherToken && registration.token !== watcherToken) return;

  if (registration.timer) clearInterval(registration.timer);
  watchers.delete(gameKey);
};
