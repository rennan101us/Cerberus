export interface GamePlayModes {
  singlePlayer: boolean;
  multiPlayer: boolean;
  onlineCoop: boolean;
  offlineCoop: boolean;
  pvpOnline: boolean;
  crossPlatform: boolean;
}

export interface SteamCategoryLike {
  id: number;
  description?: string;
}

export function extractPlayModesFromSteamCategories(
  categories?: SteamCategoryLike[] | null
): GamePlayModes {
  const result: GamePlayModes = {
    singlePlayer: false,
    multiPlayer: false,
    onlineCoop: false,
    offlineCoop: false,
    pvpOnline: false,
    crossPlatform: false,
  };

  if (!Array.isArray(categories)) return result;

  for (const cat of categories) {
    const id = Number(cat.id);
    const desc = (cat.description || "").toLowerCase();

    // Single-player (Steam id 2)
    if (
      id === 2 ||
      desc.includes("single-player") ||
      desc.includes("um jogador")
    ) {
      result.singlePlayer = true;
    }
    // Multi-player (Steam id 1)
    if (
      id === 1 ||
      desc.includes("multi-player") ||
      desc.includes("multijogador")
    ) {
      result.multiPlayer = true;
    }
    // Online Co-op (Steam id 38)
    if (
      id === 38 ||
      desc.includes("online co-op") ||
      desc.includes("cooperativo online")
    ) {
      result.onlineCoop = true;
      result.multiPlayer = true;
    }
    // Shared/Split Screen Co-op (Steam id 39, 24)
    if (
      id === 39 ||
      id === 24 ||
      desc.includes("split screen") ||
      desc.includes("ecrã dividido") ||
      desc.includes("cooperativo local")
    ) {
      result.offlineCoop = true;
      result.multiPlayer = true;
    }
    // Online PvP (Steam id 36)
    if (
      id === 36 ||
      desc.includes("online pvp") ||
      desc.includes("pvp online")
    ) {
      result.pvpOnline = true;
      result.multiPlayer = true;
    }
    // Cross-Platform (Steam id 27)
    if (
      id === 27 ||
      desc.includes("cross-platform") ||
      desc.includes("multiplataforma")
    ) {
      result.crossPlatform = true;
    }
    // Generic Co-op (Steam id 9)
    if (id === 9) {
      result.multiPlayer = true;
      if (!result.onlineCoop && !result.offlineCoop) {
        result.onlineCoop = true;
      }
    }
  }

  return result;
}

export function hasAnyPlayMode(modes: GamePlayModes): boolean {
  return (
    modes.singlePlayer ||
    modes.multiPlayer ||
    modes.onlineCoop ||
    modes.offlineCoop ||
    modes.pvpOnline ||
    modes.crossPlatform
  );
}
