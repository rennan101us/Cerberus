import { getEpicStoreDetails } from "@main/services/epic-store-details";
import {
  getSteamAppDetails,
  getSteamLanguage,
  HydraApi,
  logger,
} from "@main/services";

import type {
  CatalogueGameIdentity,
  GameArtworkOptions,
  ShopDetails,
  GameShop,
  ShopAssets,
  ShopDetailsWithAssets,
} from "@types";

import { registerEvent } from "../register-event";
import {
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { NxArtworkService } from "@main/services/nxnative/nx-artwork-service";
import { NxCompatibilityService } from "@main/services/nxnative/nx-compatibility-service";
import { NxScannerService } from "@main/services/nxnative/nx-scanner-service";
import { IgdbService } from "@main/services/igdb-service";
import { MacNativeCatalogueService } from "@main/services/mac-native/mac-native-catalogue-service";
import { composeAssetsWithArtwork } from "@shared";
import {
  getStoreDetailsWithFallback,
  formatEpicDescription,
  mapEpicShopDetails,
  STORE_DETAILS_TIMEOUT_MS,
  type EpicShopDetails,
  sanitizeEpicHtml,
} from "@main/services/store-shop-details";
import { resolveEpicDefaultArtwork } from "@main/services/game-artwork";

const applyArtworkToAssets = async (
  shop: GameShop,
  objectId: string,
  assets: ShopAssets | null,
  artworkIdentity?: CatalogueGameIdentity
): Promise<ShopAssets | null> => {
  if (!assets) return assets;
  if (shop === "epic") {
    const key = levelKeys.game(shop, objectId);
    assets = await resolveEpicDefaultArtwork(
      assets,
      await gamesShopAssetsSublevel.get(key)
    );
    await gamesShopAssetsSublevel.put(key, {
      ...assets,
      updatedAt: Date.now(),
    });
  }

  const selectedIdentity = artworkIdentity ?? { shop, objectId };
  const selection = await gamesArtworkSelectionSublevel.get(
    levelKeys.game(selectedIdentity.shop, selectedIdentity.objectId)
  );

  return composeAssetsWithArtwork(assets, selection);
};

interface LaunchboxBasic {
  objectId: string;
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  libraryImageUrl: string | null;
  logoImageUrl: string | null;
  logoPosition: string | null;
  coverImageUrl: string | null;
  releaseDate: string | null;
  releaseYear: number | null;
  retroAchievementsGameId: number | null;
}

interface LaunchboxShopDetailsAssets {
  objectId: string;
  shop: GameShop;
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  libraryImageUrl: string | null;
  logoImageUrl: string | null;
}

interface LaunchboxShopDetailsData {
  title: string;
  platform?: string | null;
  description: string | null;
  releaseDate: string | null;
  developers: string[];
  publishers: string[];
  genres: string[];
  headerImage: string | null;
  website: string | null;
  screenshots: string[];
  assets: LaunchboxShopDetailsAssets | null;
}

interface LaunchboxShopDetailsEntry {
  objectId: string;
  shop: GameShop;
  platform?: string | null;
  skus?: string[];
  data: LaunchboxShopDetailsData;
}

const mapLaunchboxToShopDetails = (
  objectId: string,
  basic: LaunchboxBasic | null,
  entry: LaunchboxShopDetailsEntry | null,
  cached: ShopDetailsWithAssets | null,
  language: string
): ShopDetails => {
  const data = entry?.data ?? null;
  const description = data?.description ?? "";

  return {
    objectId,
    descriptionLanguage: data ? language : undefined,
    name: data?.title ?? basic?.title ?? "",
    platform: entry?.platform ?? data?.platform ?? undefined,
    skus: entry?.skus ?? undefined,
    retroAchievementsGameId:
      basic?.retroAchievementsGameId ?? cached?.retroAchievementsGameId ?? null,
    steam_appid: 0,
    detailed_description: description,
    about_the_game: description,
    short_description: "",
    developers: data?.developers ?? [],
    publishers: data?.publishers ?? [],
    genres: (data?.genres ?? []).map((name, index) => ({
      id: String(index),
      name,
    })),
    movies: undefined,
    supported_languages: "",
    screenshots: (data?.screenshots ?? []).map((url, index) => ({
      id: index,
      path_thumbnail: url,
      path_full: url,
    })),
    pc_requirements: { minimum: "", recommended: "" },
    mac_requirements: { minimum: "", recommended: "" },
    linux_requirements: { minimum: "", recommended: "" },
    release_date: {
      coming_soon: false,
      date: data?.releaseDate ?? basic?.releaseDate ?? "",
    },
    content_descriptors: { ids: [] },
  };
};

const getLaunchboxShopDetails = async (
  objectId: string,
  shop: GameShop,
  language: string
): Promise<ShopDetailsWithAssets | null> => {
  const [cachedData, cachedAssets] = await Promise.all([
    gamesShopCacheSublevel.get(
      levelKeys.gameShopCacheItem(shop, objectId, language)
    ),
    gamesShopAssetsSublevel.get(levelKeys.game(shop, objectId)),
  ]);

  const cacheHasNewFields =
    cachedData &&
    (cachedData.platform || cachedData.skus) &&
    typeof cachedData.retroAchievementsGameId === "number" &&
    cachedData.descriptionLanguage === language;
  if (cachedData && cacheHasNewFields) {
    return { ...cachedData, assets: cachedAssets ?? null };
  }

  const [basic, detailsResponse] = await Promise.all([
    HydraApi.get<LaunchboxBasic | null>(`/games/${shop}/${objectId}`, null, {
      needsAuth: false,
    }).catch((err) => {
      logger.error("Failed to fetch launchbox basic game info", err);
      return null;
    }),
    HydraApi.post<LaunchboxShopDetailsEntry[]>(
      `/games/shop-details`,
      { shop, objectIds: [objectId], language },
      { needsAuth: false }
    ).catch((err) => {
      logger.error("Failed to fetch launchbox shop details", err);
      return [] as LaunchboxShopDetailsEntry[];
    }),
  ]);

  const detailsEntry = Array.isArray(detailsResponse)
    ? (detailsResponse.find((entry) => entry.objectId === objectId) ?? null)
    : null;
  const data = detailsEntry?.data ?? null;

  if (!data && !basic) return null;

  const mapped = mapLaunchboxToShopDetails(
    objectId,
    basic,
    detailsEntry,
    cachedData ? { ...cachedData, assets: cachedAssets ?? null } : null,
    language
  );

  gamesShopCacheSublevel
    .put(levelKeys.gameShopCacheItem(shop, objectId, language), mapped)
    .catch((err) => {
      logger.error("Could not cache launchbox game details", err);
    });

  const assets: ShopAssets | null =
    data?.assets || basic
      ? {
          objectId,
          shop,
          title: data?.assets?.title ?? basic?.title ?? mapped.name,
          iconUrl: data?.assets?.iconUrl ?? basic?.iconUrl ?? null,
          libraryHeroImageUrl:
            data?.assets?.libraryHeroImageUrl ??
            basic?.libraryHeroImageUrl ??
            null,
          libraryImageUrl:
            data?.assets?.libraryImageUrl ?? basic?.libraryImageUrl ?? null,
          logoImageUrl:
            data?.assets?.logoImageUrl ?? basic?.logoImageUrl ?? null,
          logoPosition: basic?.logoPosition ?? null,
          coverImageUrl: basic?.coverImageUrl ?? null,
          downloadSources: [],
        }
      : (cachedAssets ?? null);

  if (assets) {
    gamesShopAssetsSublevel
      .put(levelKeys.game(shop, objectId), {
        ...assets,
        updatedAt: Date.now(),
      })
      .catch((err) => {
        logger.error("Could not cache launchbox assets", err);
      });
  }

  return { ...mapped, assets };
};

const getGameShopDetails = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  language: string,
  options?: GameArtworkOptions
): Promise<ShopDetailsWithAssets | null> => {
  if (shop === "custom") return null;

  if (shop === "mac_native") {
    const cacheKey = levelKeys.gameShopCacheItem(shop, objectId, language);
    const cachedMacDetails = await gamesShopCacheSublevel
      .get(cacheKey)
      .catch(() => undefined);

    const buildMacNativeShopDetails =
      async (): Promise<ShopDetailsWithAssets> => {
        const gameKey = levelKeys.game(shop, objectId);
        const [storedGame, cachedAssets, macItem] = await Promise.all([
          gamesSublevel.get(gameKey).catch(() => undefined),
          gamesShopAssetsSublevel.get(gameKey).catch(() => undefined),
          MacNativeCatalogueService.getItemByObjectId(objectId).catch(
            () => null
          ),
        ]);

        const displayName =
          macItem?.title ??
          storedGame?.title ??
          cachedAssets?.title ??
          objectId;

        const [verifiedSteamAppId, igdbDetails] = await Promise.all([
          NxCompatibilityService.findVerifiedSteamAppId(displayName).catch(
            () => null
          ),
          IgdbService.fetchGameDetailsByTitle(displayName, "mac_native").catch(
            () => null
          ),
        ]);

        let steamDetails: ShopDetails | null = null;
        let steamAssets: ShopAssets | undefined;
        if (verifiedSteamAppId) {
          const steamLanguage = getSteamLanguage(language);
          const cachedSteamDetails = await gamesShopCacheSublevel
            .get(
              levelKeys.gameShopCacheItem(
                "steam",
                verifiedSteamAppId,
                steamLanguage
              )
            )
            .catch(() => undefined);
          const [fetchedSteamDetails, fetchedSteamAssets] = await Promise.all([
            cachedSteamDetails
              ? Promise.resolve(cachedSteamDetails)
              : getSteamAppDetails(verifiedSteamAppId, language).catch(
                  () => null
                ),
            gamesShopAssetsSublevel
              .get(levelKeys.game("steam", verifiedSteamAppId))
              .catch(() => undefined),
          ]);
          steamDetails = fetchedSteamDetails ?? null;
          steamAssets = fetchedSteamAssets;
        }

        const sourceBadges = macItem?.sources.map((s) => s.sourceLabel) ?? [];
        const infoLines: string[] = [
          `<strong>Plataforma:</strong> macOS Nativo (Apple Silicon / Universal)`,
        ];
        if (macItem?.version) {
          infoLines.push(
            `<strong>Versão disponível:</strong> ${macItem.version}`
          );
        }
        if (macItem?.fileSize) {
          infoLines.push(
            `<strong>Tamanho estimado:</strong> ${macItem.fileSize}`
          );
        }
        if (sourceBadges.length > 0) {
          infoLines.push(
            `<strong>Fontes:</strong> ${sourceBadges.join(" · ")}`
          );
        }
        const macMetaHtml = `<p>${infoLines.join("<br/>")}</p>`;

        const baseAbout =
          steamDetails?.about_the_game ||
          igdbDetails?.aboutHtml ||
          (macItem?.summary ? `<p>${macItem.summary}</p>` : "");
        const combinedAbout = baseAbout
          ? `${baseAbout}<hr/>${macMetaHtml}`
          : macMetaHtml;

        const coverUrl =
          igdbDetails?.coverUrl ??
          steamAssets?.coverImageUrl ??
          macItem?.coverUrl ??
          cachedAssets?.coverImageUrl ??
          storedGame?.iconUrl ??
          null;
        const heroUrl =
          steamAssets?.libraryHeroImageUrl ??
          igdbDetails?.heroUrl ??
          macItem?.coverUrl ??
          coverUrl;
        const iconUrl =
          macItem?.iconUrl ??
          coverUrl ??
          cachedAssets?.iconUrl ??
          storedGame?.iconUrl ??
          null;
        const logoUrl =
          cachedAssets?.logoImageUrl ??
          steamAssets?.logoImageUrl ??
          (verifiedSteamAppId
            ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${verifiedSteamAppId}/logo.png`
            : null);

        const baseAssets: ShopAssets = {
          objectId,
          shop,
          title: displayName,
          iconUrl,
          libraryImageUrl: coverUrl ?? iconUrl,
          libraryHeroImageUrl: heroUrl,
          logoImageUrl: logoUrl,
          logoPosition: cachedAssets?.logoPosition ?? null,
          coverImageUrl: coverUrl,
          downloadSources: sourceBadges,
        };

        const resolvedAssets = await applyArtworkToAssets(
          shop,
          objectId,
          baseAssets,
          options?.artworkIdentity
        );

        const movies =
          steamDetails?.movies && steamDetails.movies.length > 0
            ? steamDetails.movies
            : igdbDetails?.movies;
        const screenshots =
          steamDetails?.screenshots && steamDetails.screenshots.length > 0
            ? steamDetails.screenshots
            : (igdbDetails?.screenshots ?? []);

        return {
          objectId,
          name: displayName,
          platform: "macOS Native",
          steam_appid: verifiedSteamAppId ? Number(verifiedSteamAppId) : 0,
          igdbId: igdbDetails?.igdbId ?? null,
          igdbRating: igdbDetails?.rating ?? null,
          igdbSimilarGames: igdbDetails?.similarGames ?? [],
          detailed_description: combinedAbout,
          about_the_game: combinedAbout,
          short_description:
            steamDetails?.short_description ||
            igdbDetails?.summary ||
            macItem?.summary ||
            "",
          developers:
            steamDetails?.developers && steamDetails.developers.length > 0
              ? steamDetails.developers
              : igdbDetails?.developers && igdbDetails.developers.length > 0
                ? igdbDetails.developers
                : ["macOS Native"],
          publishers:
            steamDetails?.publishers && steamDetails.publishers.length > 0
              ? steamDetails.publishers
              : igdbDetails?.publishers && igdbDetails.publishers.length > 0
                ? igdbDetails.publishers
                : [],
          genres:
            steamDetails?.genres && steamDetails.genres.length > 0
              ? steamDetails.genres
              : (igdbDetails?.genres ?? []),
          movies,
          supported_languages:
            steamDetails?.supported_languages ||
            igdbDetails?.supportedLanguages ||
            "",
          screenshots,
          pc_requirements: steamDetails?.pc_requirements ?? {
            minimum: "",
            recommended: "",
          },
          mac_requirements: steamDetails?.mac_requirements ?? {
            minimum: "macOS 13+ (Apple Silicon / Universal)",
            recommended: "",
          },
          linux_requirements: { minimum: "", recommended: "" },
          release_date: steamDetails?.release_date?.date
            ? steamDetails.release_date
            : {
                coming_soon: false,
                date: igdbDetails?.releaseDate || macItem?.publishedAt || "",
              },
          content_descriptors: steamDetails?.content_descriptors ?? { ids: [] },
          assets: resolvedAssets,
        };
      };

    if (cachedMacDetails) {
      void buildMacNativeShopDetails()
        .then((fresh) => gamesShopCacheSublevel.put(cacheKey, fresh))
        .catch(() => {});
      return {
        ...cachedMacDetails,
        assets: await applyArtworkToAssets(
          shop,
          objectId,
          (cachedMacDetails as ShopDetailsWithAssets).assets ?? null,
          options?.artworkIdentity
        ),
      };
    }

    const freshMacDetails = await buildMacNativeShopDetails();
    void gamesShopCacheSublevel.put(cacheKey, freshMacDetails).catch(() => {});
    return freshMacDetails;
  }

  if (shop === "switch1" || shop === "switch2") {
    const cacheKey = levelKeys.gameShopCacheItem(shop, objectId, language);
    const cachedSwitchDetails = await gamesShopCacheSublevel
      .get(cacheKey)
      .catch(() => undefined);

    const buildSwitchShopDetails = async (): Promise<ShopDetailsWithAssets> => {
      const gameKey = levelKeys.game(shop, objectId);
      const [storedGame, cachedAssets, compatRes] = await Promise.all([
        gamesSublevel.get(gameKey).catch(() => undefined),
        gamesShopAssetsSublevel.get(gameKey).catch(() => undefined),
        NxCompatibilityService.getCompatibleGames(false).catch(() => ({
          games: [],
          isOnline: false,
          updatedAt: 0,
        })),
      ]);

      const normalizedId = objectId.toUpperCase();
      const storedTidUpper = storedGame?.switchTitleId?.toUpperCase() || "";
      const rawTitleForMatch =
        storedGame?.title ?? cachedAssets?.title ?? objectId;
      const normTitleForMatch =
        NxCompatibilityService.strictAlphaNum(rawTitleForMatch);

      const compat =
        compatRes.games.find(
          (entry) =>
            entry.titleId?.toUpperCase() === normalizedId ||
            entry.id.toUpperCase() === normalizedId ||
            (storedTidUpper &&
              (entry.titleId?.toUpperCase() === storedTidUpper ||
                entry.id.toUpperCase() === storedTidUpper))
        ) ??
        (normTitleForMatch
          ? compatRes.games.find(
              (entry) =>
                NxCompatibilityService.strictAlphaNum(entry.title) ===
                normTitleForMatch
            )
          : undefined);

      const rawDisplayName =
        storedGame?.title ?? cachedAssets?.title ?? compat?.title ?? objectId;
      const effectiveTid =
        storedGame?.switchTitleId ?? compat?.titleId ?? objectId;
      const displayName = await NxCompatibilityService.resolveCanonicalTitle(
        effectiveTid,
        rawDisplayName
      );
      const isSwitch2 =
        shop === "switch2" ||
        storedGame?.switchGeneration === "switch2" ||
        compat?.generation === "switch2";
      const platformLabel = isSwitch2 ? "Nintendo Switch 2" : "Nintendo Switch";

      const infoLines: string[] = [];
      if (compat?.versionTested)
        infoLines.push(
          `<strong>Versão testada:</strong> ${compat.versionTested}`
        );
      if (compat?.minRamGB)
        infoLines.push(`<strong>RAM mínima:</strong> ${compat.minRamGB} GB`);
      if (compat?.minChipTier)
        infoLines.push(`<strong>Chip mínimo:</strong> ${compat.minChipTier}`);
      if (compat?.macReq)
        infoLines.push(`<strong>macOS:</strong> ${compat.macReq}`);
      if (compat?.iosReq)
        infoLines.push(`<strong>iOS / iPadOS:</strong> ${compat.iosReq}`);
      if (compat?.androidReq || compat?.androidGpuTier)
        infoLines.push(
          `<strong>Android:</strong> ${[compat.androidGpuTier, compat.androidReq].filter(Boolean).join(" — ")}`
        );
      if (compat?.engine || compat?.graphicsApi)
        infoLines.push(
          `<strong>Engine / API:</strong> ${[compat.engine, compat.graphicsApi].filter(Boolean).join(" • ")}`
        );
      if (storedGame?.switchTitleId) {
        infoLines.push(
          `<strong>Title ID:</strong> <code>${storedGame.switchTitleId}</code>`
        );
      }
      if (storedGame?.switchRomPath) {
        infoLines.push(
          `<strong>ROM local:</strong> <code>${storedGame.switchRomPath}</code>`
        );
      }
      if (storedGame?.switchPortedAppPath || storedGame?.executablePath) {
        infoLines.push(
          `<strong>App macOS portado:</strong> <code>${storedGame.switchPortedAppPath || storedGame.executablePath}</code>`
        );
      }
      if (storedGame?.switchPortedIpaPath) {
        infoLines.push(
          `<strong>IPA iOS / iPadOS:</strong> <code>${storedGame.switchPortedIpaPath}</code>`
        );
      }
      if (storedGame?.switchPortedApkPath) {
        infoLines.push(
          `<strong>APK Android:</strong> <code>${storedGame.switchPortedApkPath}</code>`
        );
      }

      const descriptionHtml =
        infoLines.length > 0
          ? `<p>${infoLines.join("<br/>")}</p>`
          : `<p>Jogo ${platformLabel} integrado via NxNative / Nx2Android.</p>`;

      const artworkQuery = {
        titleId: effectiveTid,
        title: displayName,
        switchPortedAppPath: storedGame?.switchPortedAppPath ?? null,
        switchPortedIpaPath: storedGame?.switchPortedIpaPath ?? null,
        objectId,
      };
      const [resolvedCover, resolvedHero, verifiedSteamAppId, igdbDetails] =
        await Promise.all([
          NxArtworkService.resolveCoverForGame(artworkQuery),
          NxArtworkService.resolveHeroForGame(artworkQuery),
          NxCompatibilityService.findVerifiedSteamAppId(displayName),
          IgdbService.fetchGameDetailsByTitle(
            displayName,
            isSwitch2 ? "switch2" : "switch1"
          ).catch(() => null),
        ]);

      let steamDetails: ShopDetails | null = null;
      let steamAssets: ShopAssets | undefined;
      if (verifiedSteamAppId) {
        const steamLanguage = getSteamLanguage(language);
        const cachedSteamDetails = await gamesShopCacheSublevel
          .get(
            levelKeys.gameShopCacheItem(
              "steam",
              verifiedSteamAppId,
              steamLanguage
            )
          )
          .catch(() => undefined);
        const [fetchedSteamDetails, fetchedSteamAssets] = await Promise.all([
          cachedSteamDetails
            ? Promise.resolve(cachedSteamDetails)
            : getSteamAppDetails(verifiedSteamAppId, language).catch(
                () => null
              ),
          gamesShopAssetsSublevel
            .get(levelKeys.game("steam", verifiedSteamAppId))
            .catch(() => undefined),
        ]);
        steamDetails = fetchedSteamDetails ?? null;
        steamAssets = fetchedSteamAssets;
      }

      const switchLangMap: Record<string, string> = {
        "en-US": "English",
        "en-GB": "English",
        "pt-BR": "Portuguese - Brazil",
        pt: "Portuguese - Portugal",
        "es-419": "Spanish - Latin America",
        es: "Spanish - Spain",
        fr: "French",
        "fr-CA": "French",
        de: "German",
        it: "Italian",
        ja: "Japanese",
        ko: "Korean",
        "zh-Hans": "Simplified Chinese",
        "zh-Hant": "Traditional Chinese",
        ru: "Russian",
        nl: "Dutch",
      };
      const bundleLangs = NxScannerService.getSupportedLanguages(
        storedGame?.switchPortedAppPath || storedGame?.executablePath || ""
      );
      const uniqueSwitchLangNames = Array.from(
        new Set(
          bundleLangs.supported
            .map((code) => switchLangMap[code])
            .filter((v): v is string => Boolean(v))
        )
      );
      const fallbackSupportedLanguages =
        uniqueSwitchLangNames.length > 0
          ? `${uniqueSwitchLangNames.map((l) => `${l}<strong>*</strong>`).join(", ")}<br><strong>*</strong>languages with full audio support`
          : "";

      const fallbackUrl =
        resolvedCover ??
        igdbDetails?.coverUrl ??
        resolvedHero ??
        igdbDetails?.heroUrl ??
        cachedAssets?.coverImageUrl ??
        cachedAssets?.iconUrl ??
        storedGame?.iconUrl ??
        compat?.coverUrl ??
        null;
      const coverUrl =
        resolvedCover ??
        igdbDetails?.coverUrl ??
        cachedAssets?.coverImageUrl ??
        storedGame?.iconUrl ??
        compat?.coverUrl ??
        fallbackUrl;
      const heroUrl =
        resolvedHero ??
        igdbDetails?.heroUrl ??
        coverUrl ??
        cachedAssets?.libraryHeroImageUrl ??
        storedGame?.libraryHeroImageUrl ??
        fallbackUrl;
      const logoUrl =
        cachedAssets?.logoImageUrl ??
        steamAssets?.logoImageUrl ??
        (verifiedSteamAppId
          ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${verifiedSteamAppId}/logo.png`
          : null);

      const baseAssets: ShopAssets = {
        objectId,
        shop,
        title: displayName,
        iconUrl: coverUrl,
        libraryImageUrl: coverUrl,
        libraryHeroImageUrl: heroUrl,
        logoImageUrl: logoUrl,
        logoPosition: cachedAssets?.logoPosition ?? null,
        coverImageUrl: coverUrl,
        downloadSources: [],
      };

      const resolvedAssets = await applyArtworkToAssets(
        shop,
        objectId,
        baseAssets,
        options?.artworkIdentity
      );

      const primaryAbout =
        steamDetails?.about_the_game || igdbDetails?.aboutHtml || "";
      const primaryDetailed =
        steamDetails?.detailed_description || igdbDetails?.aboutHtml || "";
      const combinedAbout = primaryAbout
        ? `${primaryAbout}<hr/>${descriptionHtml}`
        : descriptionHtml;
      const combinedDetailed = primaryDetailed
        ? `${primaryDetailed}<hr/>${descriptionHtml}`
        : descriptionHtml;

      const mergedMovies =
        steamDetails?.movies && steamDetails.movies.length > 0
          ? steamDetails.movies
          : igdbDetails?.movies;
      const mergedScreenshots =
        steamDetails?.screenshots && steamDetails.screenshots.length > 0
          ? steamDetails.screenshots
          : (igdbDetails?.screenshots ?? []);

      const minRamVal = compat?.minRamGB ?? (isSwitch2 ? 16 : 8);
      const recRamVal = minRamVal >= 16 ? 16 : Math.max(8, minRamVal);

      const minChipM =
        minRamVal >= 16
          ? "Apple M1 Pro/Max ou M1 / M2 / M3 / M4 (com 16 GB+ de memória unificada)"
          : "Apple M1, M2, M3 ou M4 (Mac / iPad)";
      const recChipM =
        isSwitch2 || minRamVal >= 16
          ? "Apple M2 Pro/Max, M3 Pro/Max ou M4 (16 GB+)"
          : "Apple M2, M3 ou M4 (8 GB+ de memória unificada)";

      const minChipA = isSwitch2
        ? "Apple A18 Pro (Experimental) / iPad M1+"
        : compat?.iosReq?.includes("A18 Pro")
          ? "Apple A18 Pro (iPhone 16 Pro / 8 GB RAM)"
          : compat?.iosReq?.includes("A18")
            ? "Apple A18 / A18 Pro (iPhone 16 / 16 Pro • 8 GB RAM)"
            : "Apple A17 Pro+ (iPhone 15 Pro / 16 / 16 Pro • 8 GB RAM)";

      const recChipA = isSwitch2
        ? "iPad Pro M2 / M4 (16 GB) ou A18 Pro"
        : "Apple A18 Pro / iPad Air & Pro M2 / M4 (8 GB+ RAM)";

      const androidLine =
        compat?.isAndroidSupported ||
        compat?.androidGpuTier ||
        compat?.androidReq
          ? `<li><strong>Android (nx2android):</strong> ${compat?.androidGpuTier || compat?.androidReq || "Snapdragon 8 Gen 2/3 / Elite (Adreno 740/750/830) • Vulkan"}</li>`
          : isSwitch2
            ? `<li><strong>Android (nx2android):</strong> Indisponível para títulos Switch 2 (NVN2 exclusivo macOS)</li>`
            : `<li><strong>Android (nx2android):</strong> Snapdragon Adreno 6xx/7xx/830 ou Exynos Xclipse (Vulkan)</li>`;

      const storageLine = compat?.storageReq
        ? `<li><strong>Armazenamento:</strong> ${compat.storageReq.replace(/^HD:\s*/i, "")}</li>`
        : `<li><strong>Armazenamento:</strong> ${isSwitch2 ? "~12-16 GB" : "~6-8 GB"}</li>`;

      const engineApiLabel = [
        compat?.engine || (isSwitch2 ? "Nintendo EPD" : "Switch ARM64"),
        compat?.graphicsApi || (isSwitch2 ? "NVN2 → Metal 4" : "NVN → Metal 4"),
      ]
        .filter(Boolean)
        .join(" • ");

      const switchMinRequirementsHtml = [
        "<strong>Mínimo (NxNative &amp; Nx2Android):</strong>",
        '<ul class="bb_ul">',
        `<li><strong>SO (Apple):</strong> macOS 26.6+ (Tahoe) • Xcode 27.2+ (Metal 4)${!isSwitch2 && compat?.isIosSupported !== false ? " / iOS 26.0+ &amp; iPadOS 26.0+" : " (Exclusivo macOS)"}</li>`,
        `<li><strong>Chip Série M (Mac / iPad):</strong> ${minChipM}</li>`,
        `<li><strong>Chip Série A (iPhone / iPad):</strong> ${minChipA}</li>`,
        `<li><strong>Memória (RAM Unificada):</strong> ${minRamVal} GB RAM</li>`,
        `<li><strong>Gráficos / Engine:</strong> Apple Metal 4 (${engineApiLabel})</li>`,
        androidLine,
        storageLine,
        compat?.versionTested
          ? `<li><strong>Build Verificada:</strong> ${compat.versionTested}${compat.sdk ? ` (SDK ${compat.sdk})` : ""}</li>`
          : "",
        "</ul>",
      ]
        .filter(Boolean)
        .join("");

      const switchRecRequirementsHtml = [
        "<strong>Recomendado (NxNative &amp; Nx2Android):</strong>",
        '<ul class="bb_ul">',
        `<li><strong>SO (Apple):</strong> macOS 26.6+ (Tahoe)${!isSwitch2 && compat?.isIosSupported !== false ? " / iOS 26.0+ &amp; iPadOS 26.0+" : ""}</li>`,
        `<li><strong>Chip Série M (Mac / iPad):</strong> ${recChipM}</li>`,
        `<li><strong>Chip Série A (iPhone / iPad):</strong> ${recChipA}</li>`,
        `<li><strong>Memória (RAM Unificada):</strong> ${recRamVal} GB+ RAM (para 60 FPS / MetalFX Upscaling)</li>`,
        `<li><strong>Gráficos / Engine:</strong> Apple Metal 4 (${engineApiLabel})</li>`,
        androidLine,
        storageLine,
        "</ul>",
      ]
        .filter(Boolean)
        .join("");

      return {
        objectId,
        name: displayName,
        platform: platformLabel,
        steam_appid: verifiedSteamAppId ? Number(verifiedSteamAppId) : 0,
        igdbId: igdbDetails?.igdbId ?? null,
        igdbRating: igdbDetails?.rating ?? null,
        igdbSimilarGames: igdbDetails?.similarGames ?? [],
        detailed_description: combinedDetailed,
        about_the_game: combinedAbout,
        short_description:
          steamDetails?.short_description ||
          igdbDetails?.summary ||
          compat?.macReq ||
          "",
        developers:
          steamDetails?.developers && steamDetails.developers.length > 0
            ? steamDetails.developers
            : igdbDetails?.developers && igdbDetails.developers.length > 0
              ? igdbDetails.developers
              : [
                  isSwitch2
                    ? "Nintendo Switch 2 (NxNative)"
                    : "Nintendo Switch (NxNative)",
                ],
        publishers:
          steamDetails?.publishers && steamDetails.publishers.length > 0
            ? steamDetails.publishers
            : igdbDetails?.publishers && igdbDetails.publishers.length > 0
              ? igdbDetails.publishers
              : ["Nintendo"],
        genres:
          steamDetails?.genres && steamDetails.genres.length > 0
            ? steamDetails.genres
            : igdbDetails?.genres && igdbDetails.genres.length > 0
              ? igdbDetails.genres
              : (compat?.genres ?? []).map((g, i) => ({
                  id: String(i),
                  name: g,
                })),
        movies: mergedMovies,
        supported_languages:
          steamDetails?.supported_languages ||
          igdbDetails?.supportedLanguages ||
          fallbackSupportedLanguages,
        screenshots: mergedScreenshots,
        pc_requirements: {
          minimum: switchMinRequirementsHtml,
          recommended: switchRecRequirementsHtml,
        },
        mac_requirements: {
          minimum: switchMinRequirementsHtml,
          recommended: switchRecRequirementsHtml,
        },
        linux_requirements: steamDetails?.linux_requirements ?? {
          minimum: "",
          recommended: "",
        },
        release_date: steamDetails?.release_date?.date
          ? steamDetails.release_date
          : {
              coming_soon: false,
              date: igdbDetails?.releaseDate || "",
            },
        content_descriptors: steamDetails?.content_descriptors ?? { ids: [] },
        assets: resolvedAssets,
      };
    };

    const hasNewNxRequirements = Boolean(
      cachedSwitchDetails?.mac_requirements?.minimum?.includes(
        "NxNative &amp; Nx2Android"
      )
    );

    if (cachedSwitchDetails && hasNewNxRequirements) {
      void buildSwitchShopDetails()
        .then((fresh) => gamesShopCacheSublevel.put(cacheKey, fresh))
        .catch(() => {});
      return {
        ...cachedSwitchDetails,
        assets: await applyArtworkToAssets(
          shop,
          objectId,
          (cachedSwitchDetails as ShopDetailsWithAssets).assets ?? null,
          options?.artworkIdentity
        ),
      };
    }

    const freshSwitchDetails = await buildSwitchShopDetails();
    void gamesShopCacheSublevel
      .put(cacheKey, freshSwitchDetails)
      .catch(() => {});
    return freshSwitchDetails;
  }

  if (shop === "launchbox") {
    const details = await getLaunchboxShopDetails(objectId, shop, language);
    if (!details) return details;

    return {
      ...details,
      assets: await applyArtworkToAssets(
        shop,
        objectId,
        details.assets,
        options?.artworkIdentity
      ),
    };
  }

  if (shop === "steam") {
    const steamLanguage = getSteamLanguage(language);

    const [cachedData, cachedAssets] = await Promise.all([
      gamesShopCacheSublevel.get(
        levelKeys.gameShopCacheItem(shop, objectId, steamLanguage)
      ),
      gamesShopAssetsSublevel.get(levelKeys.game(shop, objectId)),
    ]);

    const fetchAndCacheSteamAppDetails = () =>
      getSteamAppDetails(objectId, language)
        .then((result) => {
          if (result) {
            result.name = cachedAssets?.title ?? result.name;

            gamesShopCacheSublevel
              .put(
                levelKeys.gameShopCacheItem(shop, objectId, steamLanguage),
                result
              )
              .catch((err) => {
                logger.error("Could not cache game details", err);
              });

            return {
              ...result,
              assets: cachedAssets ?? null,
            };
          }

          return null;
        })
        .catch(() => null);

    let details: ShopDetailsWithAssets | null;
    if (cachedData) {
      details = { ...cachedData, assets: cachedAssets ?? null };
      void fetchAndCacheSteamAppDetails();
    } else {
      details = await fetchAndCacheSteamAppDetails();
    }

    if (!details) return details;

    return {
      ...details,
      assets: await applyArtworkToAssets(
        shop,
        objectId,
        details.assets,
        options?.artworkIdentity
      ),
    };
  }

  if (shop === "epic") {
    const cacheLanguage = language;
    const path = `/games/${shop}/${encodeURIComponent(objectId)}/shop-details`;
    const [cachedData, cachedAssets] = await Promise.all([
      gamesShopCacheSublevel.get(
        levelKeys.gameShopCacheItem(shop, objectId, cacheLanguage)
      ),
      gamesShopAssetsSublevel.get(levelKeys.game(shop, objectId)),
    ]);

    const appDetails = (async () => {
      const details = await getStoreDetailsWithFallback<ShopDetailsWithAssets>(
        async () => {
          const data = await getEpicStoreDetails(objectId, language).catch(
            (error) => {
              logger.error("Could not fetch Epic store details", error);
              return null;
            }
          );
          const result = data
            ? mapEpicShopDetails(objectId, data, language)
            : null;
          if (!result) return null;
          return {
            ...result,
            name: result.name,
            assets: result.assets ?? cachedAssets ?? null,
          };
        },
        async () => {
          const data = await HydraApi.get<EpicShopDetails | null>(
            path,
            { language },
            {
              needsAuth: false,
              signal: AbortSignal.timeout(STORE_DETAILS_TIMEOUT_MS),
            }
          );
          if (!data) return null;
          return mapEpicShopDetails(objectId, data, language);
        },
        null
      );

      if (!details) return details;

      const { assets: freshAssets, ...payload } = details;
      let assets = freshAssets
        ? {
            ...freshAssets,
            coverImageUrl:
              freshAssets.coverImageUrl ?? cachedAssets?.coverImageUrl ?? null,
            iconUrl: freshAssets.iconUrl ?? cachedAssets?.iconUrl ?? null,
            libraryImageUrl:
              freshAssets.libraryImageUrl ??
              cachedAssets?.libraryImageUrl ??
              null,
            libraryHeroImageUrl:
              freshAssets.libraryHeroImageUrl ??
              cachedAssets?.libraryHeroImageUrl ??
              null,
            logoImageUrl:
              freshAssets.logoImageUrl ?? cachedAssets?.logoImageUrl ?? null,
            logoPosition:
              cachedAssets?.logoPosition ?? freshAssets.logoPosition,
            downloadSources:
              cachedAssets?.downloadSources ?? freshAssets.downloadSources,
          }
        : (cachedAssets ?? null);
      if (assets)
        assets = await resolveEpicDefaultArtwork(assets, cachedAssets);
      gamesShopCacheSublevel
        .put(
          levelKeys.gameShopCacheItem(shop, objectId, cacheLanguage),
          payload
        )
        .catch((error) => logger.error("Could not cache game details", error));
      if (assets)
        gamesShopAssetsSublevel
          .put(levelKeys.game(shop, objectId), {
            ...assets,
            updatedAt: Date.now(),
          })
          .catch((error) => logger.error("Could not cache game assets", error));

      return {
        ...details,
        assets,
      };
    })();
    const selected = cachedData
      ? { ...cachedData, assets: cachedAssets ?? null }
      : await appDetails;
    if (!selected) return null;
    return {
      ...selected,
      detailed_description: formatEpicDescription(
        selected.detailed_description
      ),
      about_the_game: formatEpicDescription(selected.about_the_game),
      short_description: sanitizeEpicHtml(selected.short_description),
      assets: await applyArtworkToAssets(
        shop,
        objectId,
        selected.assets,
        options?.artworkIdentity
      ),
    };
  }

  throw new Error("Not implemented");
};

registerEvent("getGameShopDetails", getGameShopDetails);
