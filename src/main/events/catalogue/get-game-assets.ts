import type { GameAssetsOptions, GameShop, ShopAssets } from "@types";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import {
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { NxArtworkService } from "@main/services/nxnative/nx-artwork-service";
import { IgdbService } from "@main/services/igdb-service";
import { MacNativeCatalogueService } from "@main/services/mac-native/mac-native-catalogue-service";
import { composeAssetsWithArtwork } from "@shared";
import { resolveEpicDefaultArtwork } from "@main/services/game-artwork";

const LOCAL_CACHE_EXPIRATION = 1000 * 60 * 60 * 8; // 8 hours

const applyArtworkSelection = async <T extends ShopAssets | null>(
  gameKey: string,
  assets: T
): Promise<T> => {
  if (!assets) return assets;

  const selection = await gamesArtworkSelectionSublevel.get(gameKey);

  return composeAssetsWithArtwork(assets, selection);
};

export const getGameAssets = async (
  objectId: string,
  shop: GameShop,
  options?: GameAssetsOptions
) => {
  if (shop === "custom") {
    return null;
  }

  const gameKey = levelKeys.game(shop, objectId);
  const artworkIdentity = options?.artworkIdentity ?? { shop, objectId };
  const artworkKey = levelKeys.game(
    artworkIdentity.shop,
    artworkIdentity.objectId
  );
  const cachedAssets = await gamesShopAssetsSublevel.get(gameKey);

  if (shop === "mac_native") {
    const [storedGame, macItem] = await Promise.all([
      gamesSublevel.get(gameKey).catch(() => undefined),
      MacNativeCatalogueService.getItemByObjectId(objectId).catch(() => null),
    ]);
    const title =
      macItem?.title ?? cachedAssets?.title ?? storedGame?.title ?? objectId;
    const igdb = await IgdbService.fetchGameDetailsByTitle(
      title,
      "mac_native"
    ).catch(() => null);

    const coverUrl =
      igdb?.coverUrl ??
      macItem?.coverUrl ??
      cachedAssets?.coverImageUrl ??
      storedGame?.iconUrl ??
      null;
    const heroUrl =
      igdb?.heroUrl ??
      macItem?.coverUrl ??
      cachedAssets?.libraryHeroImageUrl ??
      coverUrl;
    const iconUrl =
      macItem?.iconUrl ?? coverUrl ?? cachedAssets?.iconUrl ?? null;

    const merged: ShopAssets = {
      objectId,
      shop,
      title,
      iconUrl,
      libraryImageUrl: coverUrl ?? iconUrl,
      libraryHeroImageUrl: heroUrl,
      logoImageUrl: cachedAssets?.logoImageUrl ?? null,
      logoPosition: cachedAssets?.logoPosition ?? null,
      coverImageUrl: coverUrl,
      downloadSources:
        macItem?.sources.map((s) => s.sourceLabel) ??
        cachedAssets?.downloadSources ??
        [],
    };

    return applyArtworkSelection(artworkKey, merged);
  }

  if (shop === "switch1" || shop === "switch2") {
    const storedGame = await gamesSublevel.get(gameKey).catch(() => undefined);
    const title = cachedAssets?.title ?? storedGame?.title ?? objectId;
    const query = {
      titleId: storedGame?.switchTitleId ?? objectId,
      title,
      switchPortedAppPath: storedGame?.switchPortedAppPath ?? null,
      switchPortedIpaPath: storedGame?.switchPortedIpaPath ?? null,
      objectId,
    };
    const [resolvedCover, resolvedHero] = await Promise.all([
      NxArtworkService.resolveCoverForGame(query),
      NxArtworkService.resolveHeroForGame(query),
    ]);

    let igdbCover: string | null = null;
    let igdbHero: string | null = null;
    if (!resolvedCover || !resolvedHero) {
      const igdb = await IgdbService.fetchGameDetailsByTitle(
        title,
        shop === "switch2" ? "switch2" : "switch1"
      ).catch(() => null);
      igdbCover = igdb?.coverUrl ?? null;
      igdbHero = igdb?.heroUrl ?? null;
    }

    const iconUrl =
      resolvedCover ??
      igdbCover ??
      cachedAssets?.iconUrl ??
      storedGame?.iconUrl ??
      null;
    const heroUrl =
      resolvedHero ??
      igdbHero ??
      resolvedCover ??
      igdbCover ??
      cachedAssets?.libraryHeroImageUrl ??
      storedGame?.libraryHeroImageUrl ??
      null;
    const coverUrl =
      resolvedCover ??
      igdbCover ??
      cachedAssets?.coverImageUrl ??
      storedGame?.iconUrl ??
      heroUrl;

    const merged: ShopAssets | null =
      cachedAssets || iconUrl || heroUrl
        ? {
            objectId,
            shop,
            title,
            iconUrl,
            libraryImageUrl: coverUrl,
            libraryHeroImageUrl: heroUrl,
            logoImageUrl: cachedAssets?.logoImageUrl ?? null,
            logoPosition: cachedAssets?.logoPosition ?? null,
            coverImageUrl: coverUrl,
            downloadSources: cachedAssets?.downloadSources ?? [],
          }
        : null;

    return merged ? applyArtworkSelection(artworkKey, merged) : null;
  }

  if (options?.cacheOnly) {
    return cachedAssets
      ? applyArtworkSelection(artworkKey, cachedAssets)
      : null;
  }

  if (
    !options?.forceFresh &&
    cachedAssets &&
    cachedAssets.updatedAt + LOCAL_CACHE_EXPIRATION > Date.now()
  ) {
    if (shop !== "epic") return applyArtworkSelection(artworkKey, cachedAssets);
    const resolved = await resolveEpicDefaultArtwork(
      cachedAssets,
      cachedAssets
    );
    await gamesShopAssetsSublevel.put(gameKey, {
      ...resolved,
      updatedAt: cachedAssets.updatedAt,
    });
    return applyArtworkSelection(artworkKey, resolved);
  }

  return HydraApi.get<ShopAssets | null>(
    `/games/${shop}/${objectId}/assets`,
    null,
    {
      needsAuth: false,
    }
  ).then(async (assets) => {
    if (!assets) return null;
    if (shop === "epic")
      assets = await resolveEpicDefaultArtwork(
        assets,
        options?.forceFresh ? null : cachedAssets
      );

    const shouldPreserveTitle =
      !options?.forceFresh &&
      cachedAssets?.title &&
      cachedAssets.title !== assets.title;

    await gamesShopAssetsSublevel.put(gameKey, {
      ...assets,
      title: shouldPreserveTitle ? cachedAssets.title : assets.title,
      updatedAt: Date.now(),
    });

    return applyArtworkSelection(artworkKey, assets);
  });
};

const getGameAssetsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  options?: GameAssetsOptions
) => getGameAssets(objectId, shop, options);

registerEvent("getGameAssets", getGameAssetsEvent);
