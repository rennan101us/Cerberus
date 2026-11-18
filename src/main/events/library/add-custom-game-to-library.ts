import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { randomUUID } from "node:crypto";
import type { GameShop, Game, MacOSCompatibilityOptions } from "@types";
import {
  CrossOverDiscovery,
  CrossOverDetector,
  DEFAULT_BOTTLE_NAME,
  WindowManager,
} from "@main/services";

const addCustomGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string,
  executablePath: string,
  iconUrl?: string,
  logoImageUrl?: string,
  libraryHeroImageUrl?: string
) => {
  const objectId = randomUUID();
  const shop: GameShop = "custom";
  const gameKey = levelKeys.game(shop, objectId);

  const existingGames = await gamesSublevel.iterator().all();
  const existingGame = existingGames.find(
    ([_key, game]) => game.executablePath === executablePath && !game.isDeleted
  );

  if (existingGame) {
    throw new Error(
      "A game with this executable path already exists in your library"
    );
  }

  // Detect bottle if on macOS
  let macOSCompatibility: MacOSCompatibilityOptions | undefined;
  if (process.platform === "darwin") {
    const detectedBottle =
      CrossOverDetector.detectBottleFromPath(executablePath) ||
      DEFAULT_BOTTLE_NAME;
    macOSCompatibility = {
      bottleName: detectedBottle,
      graphicsBackend: "d3dmetal",
      syncMode: "msync",
    };
  }

  // Attempt Steam matching to fetch official 600x900 covers, banners, logos
  const match = await CrossOverDiscovery.matchCandidateToSteam({
    title,
    executablePath,
    bottleName: macOSCompatibility?.bottleName ?? "",
  }).catch(() => null);

  let finalTitle = title;
  let finalIconUrl = iconUrl || null;
  let finalLogoImageUrl = logoImageUrl || null;
  let finalLibraryHeroImageUrl = libraryHeroImageUrl || null;
  let finalCoverImageUrl = iconUrl || "";
  let finalLibraryImageUrl = iconUrl || "";
  let catalogueGame: { shop: GameShop; objectId: string } | undefined;

  if (match) {
    const steamAssets = await CrossOverDiscovery.fetchOrConstructSteamAssets(
      match.appId,
      match.title
    ).catch(() => null);

    if (steamAssets) {
      catalogueGame = { shop: "steam", objectId: match.appId };
      finalTitle = title || steamAssets.title;
      finalIconUrl = steamAssets.iconUrl || finalIconUrl;
      finalLogoImageUrl = steamAssets.logoImageUrl || finalLogoImageUrl;
      finalLibraryHeroImageUrl =
        steamAssets.libraryHeroImageUrl || finalLibraryHeroImageUrl;
      finalCoverImageUrl =
        steamAssets.coverImageUrl || steamAssets.libraryImageUrl || "";
      finalLibraryImageUrl =
        steamAssets.libraryImageUrl || steamAssets.coverImageUrl || "";
    }
  }

  const assets = {
    updatedAt: Date.now(),
    objectId,
    shop,
    title: finalTitle,
    iconUrl: finalIconUrl,
    libraryHeroImageUrl: finalLibraryHeroImageUrl || "",
    libraryImageUrl: finalLibraryImageUrl,
    logoImageUrl: finalLogoImageUrl || "",
    logoPosition: null,
    coverImageUrl: finalCoverImageUrl,
    downloadSources: [],
  };
  await gamesShopAssetsSublevel.put(gameKey, assets);

  const game: Game = {
    title: finalTitle,
    iconUrl: finalIconUrl,
    logoImageUrl: finalLogoImageUrl,
    libraryHeroImageUrl: finalLibraryHeroImageUrl,
    objectId,
    shop,
    remoteId: null,
    isDeleted: false,
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
    addedToLibraryAt: new Date(),
    executablePath,
    executablePathUpdatedAt: new Date(),
    launchOptions: null,
    favorite: false,
    automaticCloudSync: false,
    hasManuallyUpdatedPlaytime: false,
    catalogueGame,
    macOSCompatibility,
  };

  await gamesSublevel.put(gameKey, game);
  WindowManager.sendToAppWindows("on-library-batch-complete");

  return game;
};

registerEvent("addCustomGameToLibrary", addCustomGameToLibrary);
