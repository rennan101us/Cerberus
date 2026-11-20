export interface LibraryShelfGame {
  id: string;
  shop: string;
  title: string;
  favorite?: boolean;
  hasActiveSteamImport?: boolean;
  hasActiveEpicImport?: boolean;
  source?: string;
  executablePath?: string | null;
  switchPortedAppPath?: string | null;
  macOSCompatibility?: unknown;
}

export type LibraryShelfId =
  | "favorites"
  | "mac_native"
  | "windows_red_wine"
  | "switch1"
  | "switch2"
  | "steam"
  | "epic"
  | "gog"
  | "classics";

export const DEFAULT_LIBRARY_SHELVES_ORDER: readonly LibraryShelfId[] = [
  "favorites",
  "mac_native",
  "windows_red_wine",
  "switch1",
  "switch2",
  "steam",
  "epic",
  "gog",
  "classics",
];

export interface LibraryShelfDefinition {
  id: LibraryShelfId;
  labelKey: string;
  defaultLabel: string;
  matches: (game: LibraryShelfGame) => boolean;
}

export const SHELF_DEFINITIONS: Record<LibraryShelfId, LibraryShelfDefinition> =
  {
    favorites: {
      id: "favorites",
      labelKey: "shelf_favorites",
      defaultLabel: "Favoritos",
      matches: (game) => Boolean(game.favorite),
    },
    mac_native: {
      id: "mac_native",
      labelKey: "shelf_mac_native",
      defaultLabel: "Mac Native",
      matches: (game) =>
        game.shop === "mac_native" ||
        Boolean(game.switchPortedAppPath) ||
        Boolean(
          game.executablePath &&
            game.executablePath.toLowerCase().endsWith(".app")
        ),
    },
    windows_red_wine: {
      id: "windows_red_wine",
      labelKey: "shelf_windows_red_wine",
      defaultLabel: "Windows (Red Wine)",
      matches: (game) => {
        if (
          game.shop === "mac_native" ||
          game.shop === "switch1" ||
          game.shop === "switch2" ||
          game.shop === "launchbox" ||
          Boolean(game.switchPortedAppPath) ||
          (game.executablePath &&
            game.executablePath.toLowerCase().endsWith(".app"))
        ) {
          return false;
        }
        return (
          game.shop === "steam" ||
          game.shop === "epic" ||
          game.shop === "gog" ||
          game.shop === "custom" ||
          Boolean(game.macOSCompatibility) ||
          Boolean(
            game.executablePath &&
              game.executablePath.toLowerCase().endsWith(".exe")
          )
        );
      },
    },
    switch1: {
      id: "switch1",
      labelKey: "shelf_switch1",
      defaultLabel: "Nintendo Switch 1",
      matches: (game) => game.shop === "switch1",
    },
    switch2: {
      id: "switch2",
      labelKey: "shelf_switch2",
      defaultLabel: "Nintendo Switch 2",
      matches: (game) => game.shop === "switch2",
    },
    steam: {
      id: "steam",
      labelKey: "shelf_steam",
      defaultLabel: "Steam",
      matches: (game) =>
        game.shop === "steam" ||
        Boolean(game.hasActiveSteamImport) ||
        Boolean(game.source === "steam"),
    },
    epic: {
      id: "epic",
      labelKey: "shelf_epic",
      defaultLabel: "Epic Games",
      matches: (game) =>
        game.shop === "epic" ||
        Boolean(game.hasActiveEpicImport) ||
        Boolean(game.source === "epic"),
    },
    gog: {
      id: "gog",
      labelKey: "shelf_gog",
      defaultLabel: "GOG Galaxy",
      matches: (game) => game.shop === "gog" || Boolean(game.source === "gog"),
    },
    classics: {
      id: "classics",
      labelKey: "shelf_classics",
      defaultLabel: "Clássicos & Emuladores",
      matches: (game) => game.shop === "launchbox",
    },
  };

const STORAGE_KEY_ORDER = "cerberus_library_shelves_order";
const STORAGE_KEY_HIDDEN = "cerberus_library_shelves_hidden";

export function getStoredShelvesOrder(): LibraryShelfId[] {
  if (typeof localStorage === "undefined") {
    return [...DEFAULT_LIBRARY_SHELVES_ORDER];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ORDER);
    if (!raw) return [...DEFAULT_LIBRARY_SHELVES_ORDER];
    const parsed = JSON.parse(raw) as LibraryShelfId[];
    if (!Array.isArray(parsed)) return [...DEFAULT_LIBRARY_SHELVES_ORDER];
    const valid = parsed.filter((id) => id in SHELF_DEFINITIONS);
    for (const defId of DEFAULT_LIBRARY_SHELVES_ORDER) {
      if (!valid.includes(defId)) valid.push(defId);
    }
    return valid;
  } catch {
    return [...DEFAULT_LIBRARY_SHELVES_ORDER];
  }
}

export function saveStoredShelvesOrder(order: LibraryShelfId[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_ORDER, JSON.stringify(order));
  } catch {
    // ignore
  }
}

export function getStoredShelvesHidden(): LibraryShelfId[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HIDDEN);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LibraryShelfId[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => id in SHELF_DEFINITIONS);
  } catch {
    return [];
  }
}

export function saveStoredShelvesHidden(hidden: LibraryShelfId[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_HIDDEN, JSON.stringify(hidden));
  } catch {
    // ignore
  }
}

export interface ComputedShelf<T = LibraryShelfGame> {
  id: LibraryShelfId;
  label: string;
  games: T[];
}

export function buildLibraryShelves<T extends LibraryShelfGame>(
  games: T[],
  order?: LibraryShelfId[],
  hidden?: LibraryShelfId[]
): ComputedShelf<T>[] {
  const effectiveOrder = order ?? getStoredShelvesOrder();
  const effectiveHidden = hidden ?? getStoredShelvesHidden();
  const hiddenSet = new Set(effectiveHidden);
  const shelves: ComputedShelf<T>[] = [];

  for (const shelfId of effectiveOrder) {
    if (hiddenSet.has(shelfId)) continue;
    const def = SHELF_DEFINITIONS[shelfId];
    if (!def) continue;

    const matchedGames = games.filter(def.matches);
    if (matchedGames.length > 0) {
      shelves.push({
        id: shelfId,
        label: def.defaultLabel,
        games: matchedGames,
      });
    }
  }

  return shelves;
}
