import type { Game } from "@types";
import {
  CrossOverDetector,
  DEFAULT_BOTTLE_NAME,
} from "@main/services/crossover/crossover-detector";

export function updateGameExecutablePath<TGame extends Game>(
  game: TGame,
  executablePath: string | null
): TGame {
  if (game.executablePath === executablePath) {
    return game;
  }

  const updated: TGame = {
    ...game,
    executablePath,
    executablePathUpdatedAt: executablePath ? new Date() : null,
  };

  if (process.platform === "darwin" && executablePath) {
    const detectedBottle =
      CrossOverDetector.detectBottleFromPath(executablePath) ||
      game.macOSCompatibility?.bottleName ||
      DEFAULT_BOTTLE_NAME;

    updated.macOSCompatibility = {
      bottleName: detectedBottle,
      graphicsBackend: "d3dmetal",
      syncMode: "msync",
      ...game.macOSCompatibility,
    };
  }

  return updated;
}

export function updateGameTrackingExecutablePaths<TGame extends Game>(
  game: TGame,
  trackingExecutablePaths: string[]
): TGame {
  return {
    ...game,
    trackingExecutablePaths,
    trackingExecutablePathsUpdatedAt: trackingExecutablePaths.length
      ? new Date()
      : null,
  };
}
