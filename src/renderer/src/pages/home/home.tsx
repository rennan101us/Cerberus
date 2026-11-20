import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import { useNavigate } from "react-router-dom";
import { Flame, PackagePlus, Shuffle, TrendingUp } from "lucide-react";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import { Button, GameCard, Hero } from "@renderer/components";
import type {
  CatalogueSearchResult,
  DownloadSource,
  ShopAssets,
  Steam250Game,
} from "@types";

import { buildGameDetailsPath, ensureArray } from "@renderer/helpers";
import { CatalogueCategory } from "@shared";
import "./home.scss";

const getCategoryIcon = (category: CatalogueCategory, size = 16) => {
  switch (category) {
    case CatalogueCategory.Hot:
      return <Flame size={size} strokeWidth={2} />;
    case CatalogueCategory.Weekly:
      return <TrendingUp size={size} strokeWidth={2} />;
    case CatalogueCategory.Achievements:
      return <PackagePlus size={size} strokeWidth={2} />;
    default:
      return null;
  }
};

export default function Home() {
  const { t } = useTranslation("home");
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(false);
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);

  const [currentCatalogueCategory, setCurrentCatalogueCategory] = useState(
    CatalogueCategory.Hot
  );

  const [catalogue, setCatalogue] = useState<
    Record<CatalogueCategory, ShopAssets[]>
  >({
    [CatalogueCategory.Hot]: [],
    [CatalogueCategory.Weekly]: [],
    [CatalogueCategory.Achievements]: [],
  });

  const getCatalogue = useCallback(async (category: CatalogueCategory) => {
    try {
      setCurrentCatalogueCategory(category);
      setIsLoading(true);

      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const downloadSources = orderBy(sources, "createdAt", "desc");
      const downloadSourceIds = downloadSources.map((source) => source.id);

      // "Novos" (CatalogueCategory.Achievements) fetches the newest repacks present in configured download sources
      if (category === CatalogueCategory.Achievements) {
        const fingerprints = downloadSources
          .map((source) => source.fingerprint)
          .filter((fp): fp is string => Boolean(fp));

        if (downloadSourceIds.length === 0) {
          setCatalogue((prev) => ({
            ...prev,
            [category]: [],
          }));
          return;
        }

        const searchResult = await window.electron.hydraApi.post<{
          edges: CatalogueSearchResult[];
          count: number;
        }>("/catalogue/search", {
          data: {
            take: 12,
            skip: 0,
            sortBy: "releaseDate",
            sortOrder: "desc",
            downloadSourceIds,
            ...(fingerprints.length > 0
              ? { downloadSourceFingerprints: fingerprints }
              : {}),
          },
          needsAuth: false,
        });

        const edges = ensureArray<CatalogueSearchResult>(
          searchResult?.edges,
          "/catalogue/search"
        );

        const mappedGames: ShopAssets[] = edges.map((item) => ({
          objectId: item.objectId,
          shop: item.shop,
          title: item.title,
          iconUrl: null,
          libraryImageUrl: item.libraryImageUrl ?? null,
          libraryHeroImageUrl: null,
          logoImageUrl: null,
          logoPosition: null,
          coverImageUrl: item.libraryImageUrl ?? null,
          downloadSources: item.downloadSources ?? [],
        }));

        setCatalogue((prev) => ({
          ...prev,
          [category]: mappedGames,
        }));
        return;
      }

      const params = {
        take: 12,
        skip: 0,
        downloadSourceIds,
      };

      const catalogueResult = await window.electron.hydraApi.get<ShopAssets[]>(
        `/catalogue/${category}`,
        {
          params,
          needsAuth: false,
        }
      );

      setCatalogue((prev) => ({
        ...prev,
        [category]: ensureArray<ShopAssets>(
          catalogueResult,
          `/catalogue/${category}`
        ),
      }));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getRandomGame = useCallback(() => {
    window.electron.getRandomGame().then((game) => {
      if (game) setRandomGame(game);
    });
  }, []);

  const handleRandomizerClick = () => {
    if (randomGame) {
      navigate(
        buildGameDetailsPath(
          { ...randomGame, shop: "steam" },
          {
            fromRandomizer: "1",
          }
        )
      );
    }
  };

  const handleCategoryClick = (category: CatalogueCategory) => {
    if (category !== currentCatalogueCategory) {
      getCatalogue(category);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    getCatalogue(CatalogueCategory.Hot);

    getRandomGame();
  }, [getCatalogue, getRandomGame]);

  const categories = Object.values(CatalogueCategory);

  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <section className="home__content">
        <Hero />

        <section className="home__header">
          <ul className="home__buttons-list">
            {categories.map((category) => (
              <li key={category}>
                <Button
                  theme={
                    category === currentCatalogueCategory
                      ? "primary"
                      : "outline"
                  }
                  onClick={() => handleCategoryClick(category)}
                >
                  <span className="home__button-icon" aria-hidden="true">
                    {getCategoryIcon(category, 15)}
                  </span>
                  {t(category)}
                </Button>
              </li>
            ))}
          </ul>

          <Button
            onClick={handleRandomizerClick}
            theme="outline"
            disabled={!randomGame}
          >
            <span className="home__button-icon" aria-hidden="true">
              <Shuffle size={15} strokeWidth={2} />
            </span>
            {t("surprise_me")}
          </Button>
        </section>

        <h2 className="home__title">
          <span className="home__title-icon" aria-hidden="true">
            {getCategoryIcon(currentCatalogueCategory, 20)}
          </span>
          {t(currentCatalogueCategory)}
        </h2>

        <section className="home__cards">
          {isLoading ? (
            Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className="home__card-skeleton" />
            ))
          ) : catalogue[currentCatalogueCategory].length === 0 ? (
            <div className="home__no-results">
              <p>{t("no_results")}</p>
            </div>
          ) : (
            catalogue[currentCatalogueCategory].map((result) => (
              <GameCard
                key={result.objectId}
                game={result}
                onClick={() => navigate(buildGameDetailsPath(result))}
              />
            ))
          )}
        </section>
      </section>
    </SkeletonTheme>
  );
}
