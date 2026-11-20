import type {
  CatalogueSearchPayload,
  CatalogueSearchResult,
  DownloadSource,
} from "@types";

import { useAppDispatch, useAppSelector, useFormat } from "@renderer/hooks";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import "./catalogue.scss";

import { Button } from "@renderer/components/button/button";
import { SelectField } from "@renderer/components/select-field/select-field";
import { setFilters, setPage } from "@renderer/features";
import { useCatalogue } from "@renderer/hooks/use-catalogue";
import { debounce } from "lodash-es";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import cn from "classnames";
import { Gamepad2, Wrench } from "lucide-react";
import { ReleaseYearSection } from "./release-year-section";
import { FilterItem } from "./filter-item";
import { FilterSection } from "./filter-section";
import { GameItem } from "./game-item";
import { Pagination } from "./pagination";
import { CrossOverToolsCatalog } from "./crossover-tools";
import { SwitchCatalogue } from "./switch-catalogue";
import { MacNativeCatalogue } from "./mac-native-catalogue";
import {
  MacOSLogoIcon,
  WindowsLogoIcon,
} from "@renderer/components/platform-icons/official-platform-icons";
import { useSearchParams } from "react-router-dom";

const MIN_RELEASE_YEAR = 1970;

const filterCategoryColors = {
  genres: "hsl(262deg 50% 47%)",
  tags: "hsl(95deg 50% 20%)",
  downloadSourceFingerprints: "hsl(27deg 50% 40%)",
  developers: "hsl(340deg 50% 46%)",
  publishers: "hsl(200deg 50% 30%)",
  releaseYear: "hsl(38deg 50% 40%)",
};

const PAGE_SIZE = 30;

const clearAllCategoryFilters = {
  genres: [],
  tags: [],
  downloadSourceFingerprints: [],
  developers: [],
  publishers: [],
  releaseYear: undefined,
};

const sortValues = [
  "popularity:desc",
  "releaseDate:desc",
  "releaseDate:asc",
  "alphabetical:asc",
  "alphabetical:desc",
  "hydraScore:desc",
  "hydraScore:asc",
] as const;

type CatalogueSortValue = (typeof sortValues)[number];

export default function Catalogue() {
  const requestSequenceRef = useRef(0);
  const hasResultsRef = useRef(false);
  const cataloguePageRef = useRef<HTMLDivElement>(null);

  const { steamDevelopers, steamPublishers, downloadSources, loadingLists } =
    useCatalogue();

  const { steamGenres, steamUserTags, filters, page, mode } = useAppSelector(
    (state) => state.catalogueSearch
  );
  const deferredTitleFilter = useDeferredValue(filters.title);

  const effectiveFilters = useMemo(() => {
    return {
      ...filters,
      title: deferredTitleFilter,
    };
  }, [filters, deferredTitleFilter]);

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<
    "games" | "mac-native" | "switch1" | "switch2" | "crossover-tools"
  >(
    initialTabParam === "mac-native" ||
      initialTabParam === "switch1" ||
      initialTabParam === "switch2" ||
      initialTabParam === "crossover-tools"
      ? initialTabParam
      : "games"
  );

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (
      tab === "games" ||
      tab === "mac-native" ||
      tab === "switch1" ||
      tab === "switch2" ||
      tab === "crossover-tools"
    ) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const selectCatalogueTab = (
    tab: "games" | "mac-native" | "switch1" | "switch2" | "crossover-tools"
  ) => {
    setActiveTab(tab);
    setSearchParams(tab === "games" ? {} : { tab });
  };
  const [isLoading, setIsLoading] = useState(true);

  const [results, setResults] = useState<CatalogueSearchResult[]>([]);
  const [resultsMode, setResultsMode] = useState(mode);

  const [itemsCount, setItemsCount] = useState(0);

  const { formatNumber } = useFormat();

  const dispatch = useAppDispatch();

  const { t, i18n } = useTranslation("catalogue");

  const debouncedSearch = useRef(
    debounce(
      async (
        filters: CatalogueSearchPayload,
        downloadSources: DownloadSource[],
        pageSize: number,
        offset: number,
        requestId: number,
        mode: "modern" | "classics"
      ) => {
        const { platforms, ...restFilters } = filters;
        const baseRequest = {
          ...restFilters,
          take: pageSize,
          skip: offset,
          downloadSourceIds: downloadSources.map(
            (downloadSource) => downloadSource.id
          ),
        };

        const requestData =
          mode === "classics"
            ? {
                ...baseRequest,
                shops: ["launchbox"],
                platforms: platforms ?? [],
              }
            : baseRequest;

        const response = await window.electron.hydraApi.post<{
          edges: CatalogueSearchResult[];
          count: number;
        }>("/catalogue/search", {
          data: requestData,
          needsAuth: false,
        });

        if (requestId !== requestSequenceRef.current) return;

        setResults(response.edges);
        setResultsMode(mode);
        setItemsCount(response.count);
        setIsLoading(false);
      },
      500
    )
  ).current;

  const decodeHTML = (s: string) =>
    s.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");

  useEffect(() => {
    hasResultsRef.current = results.length > 0;
  }, [results.length]);

  const isModeTransitioning = resultsMode !== mode;
  const showSkeleton = isLoading || isModeTransitioning;

  useEffect(() => {
    const requestId = ++requestSequenceRef.current;

    if (!hasResultsRef.current) {
      setIsLoading(true);
    }

    debouncedSearch(
      effectiveFilters,
      downloadSources,
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE,
      requestId,
      mode
    );

    return () => {
      debouncedSearch.cancel();
    };
  }, [effectiveFilters, downloadSources, page, debouncedSearch, mode]);

  const language = i18n.language.split("-")[0];

  const steamGenresMapping = useMemo<Record<string, string>>(() => {
    if (!steamGenres[language]) return {};

    return steamGenres[language].reduce((prev, genre, index) => {
      prev[genre] = steamGenres["en"][index];
      return prev;
    }, {});
  }, [steamGenres, language]);

  const steamGenresFilterItems = useMemo(() => {
    return Object.entries(steamGenresMapping)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => ({
        label: key,
        value: value,
        checked: filters.genres.includes(value),
      }));
  }, [steamGenresMapping, filters.genres]);

  const steamUserTagsFilterItems = useMemo(() => {
    if (!steamUserTags[language]) return [];

    return Object.entries(steamUserTags[language])
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => ({
        label: key,
        value: value,
        checked: filters.tags.includes(value),
      }));
  }, [steamUserTags, filters.tags, language]);

  const groupedFilters = useMemo(() => {
    return [
      ...filters.genres.map((genre) => ({
        label: Object.keys(steamGenresMapping).find(
          (key) => steamGenresMapping[key] === genre
        ) as string,
        filterType: t("genres"),
        orbColor: filterCategoryColors.genres,
        key: "genres",
        value: genre,
      })),

      ...filters.tags.map((tag) => {
        const tagsForLanguage = steamUserTags[language] ?? {};
        return {
          label: Object.keys(tagsForLanguage).find(
            (key) => tagsForLanguage[key] === tag
          ),
          filterType: t("tags"),
          orbColor: filterCategoryColors.tags,
          key: "tags",
          value: tag,
        };
      }),

      ...filters.downloadSourceFingerprints.map((fingerprint) => ({
        label: downloadSources.find(
          (source) => source.fingerprint === fingerprint
        )?.name as string,
        filterType: t("download_sources"),
        orbColor: filterCategoryColors.downloadSourceFingerprints,
        key: "downloadSourceFingerprints",
        value: fingerprint,
      })),

      ...filters.developers.map((developer) => ({
        label: developer,
        filterType: t("developers"),
        orbColor: filterCategoryColors.developers,
        key: "developers",
        value: developer,
      })),

      ...filters.publishers.map((publisher) => ({
        label: decodeHTML(publisher),
        filterType: t("publishers"),
        orbColor: filterCategoryColors.publishers,
        key: "publishers",
        value: publisher,
      })),

      ...(filters.releaseYear
        ? [
            {
              label: `${filters.releaseYear.gte ?? MIN_RELEASE_YEAR} – ${filters.releaseYear.lte ?? new Date().getFullYear()}`,
              filterType: t("release_year"),
              orbColor: filterCategoryColors.releaseYear,
              key: "releaseYear",
              value: "range",
            },
          ]
        : []),
    ];
  }, [
    filters,
    steamUserTags,
    downloadSources,
    steamGenresMapping,
    language,
    t,
  ]);

  const filterSections = useMemo(() => {
    return [
      {
        title: t("genres"),
        items: steamGenresFilterItems,
        key: "genres",
        isLoading: !steamGenres[language],
      },
      {
        title: t("tags"),
        items: steamUserTagsFilterItems,
        key: "tags",
        isLoading: !steamUserTags[language],
      },
      {
        title: t("download_sources"),
        items: downloadSources
          .filter((source) => source.fingerprint)
          .map((source) => ({
            label: source.name,
            value: source.fingerprint!,
            checked: filters.downloadSourceFingerprints.includes(
              source.fingerprint!
            ),
          })),
        key: "downloadSourceFingerprints",
        isLoading: loadingLists.downloadSources,
      },
      {
        title: t("developers"),
        items: steamDevelopers.map((developer) => ({
          label: developer,
          value: developer,
          checked: filters.developers.includes(developer),
        })),
        key: "developers",
        isLoading: loadingLists.developers,
      },
      {
        title: t("publishers"),
        items: steamPublishers.map((publisher) => ({
          label: decodeHTML(publisher),
          value: publisher,
          checked: filters.publishers.includes(publisher),
        })),
        key: "publishers",
        isLoading: loadingLists.publishers,
      },
    ];
  }, [
    language,
    loadingLists.developers,
    loadingLists.downloadSources,
    loadingLists.publishers,
    steamGenres,
    steamUserTags,
    downloadSources,
    filters.developers,
    filters.downloadSourceFingerprints,
    filters.publishers,
    steamDevelopers,
    steamGenresFilterItems,
    steamPublishers,
    steamUserTagsFilterItems,
    t,
  ]);

  const activeGroupedFilters = groupedFilters;
  const selectedFiltersCount = activeGroupedFilters.length;

  const sortOptions = useMemo(
    () => [
      {
        key: "popularity:desc",
        value: "popularity:desc",
        label: t("sort_popularity"),
      },
      {
        key: "releaseDate:desc",
        value: "releaseDate:desc",
        label: t("sort_newest"),
      },
      {
        key: "releaseDate:asc",
        value: "releaseDate:asc",
        label: t("sort_oldest"),
      },
      {
        key: "alphabetical:asc",
        value: "alphabetical:asc",
        label: t("sort_title_asc"),
      },
      {
        key: "alphabetical:desc",
        value: "alphabetical:desc",
        label: t("sort_title_desc"),
      },
      {
        key: "hydraScore:desc",
        value: "hydraScore:desc",
        label: t("sort_highest_rating"),
      },
      {
        key: "hydraScore:asc",
        value: "hydraScore:asc",
        label: t("sort_lowest_rating"),
      },
    ],
    [t]
  );

  const selectedSortValue = `${filters.sortBy}:${filters.sortOrder}`;

  return (
    <div className="catalogue" ref={cataloguePageRef}>
      <nav className="catalogue__tabs" aria-label="Abas do catálogo">
        <button
          type="button"
          className={cn("catalogue__tab", {
            "catalogue__tab--active": activeTab === "games",
          })}
          onClick={() => selectCatalogueTab("games")}
        >
          <WindowsLogoIcon size={15} />
          Jogos Windows
        </button>

        <button
          type="button"
          className={cn("catalogue__tab", {
            "catalogue__tab--active": activeTab === "mac-native",
          })}
          onClick={() => selectCatalogueTab("mac-native")}
        >
          <MacOSLogoIcon size={15} />
          Mac Native
        </button>

        <button
          type="button"
          className={cn("catalogue__tab", {
            "catalogue__tab--active": activeTab === "switch1",
          })}
          onClick={() => selectCatalogueTab("switch1")}
        >
          <Gamepad2 size={16} strokeWidth={2} />
          Switch 1
        </button>

        <button
          type="button"
          className={cn("catalogue__tab", {
            "catalogue__tab--active": activeTab === "switch2",
          })}
          onClick={() => selectCatalogueTab("switch2")}
        >
          <Gamepad2 size={16} strokeWidth={2} />
          Switch 2
        </button>

        <button
          type="button"
          className={cn("catalogue__tab", {
            "catalogue__tab--active": activeTab === "crossover-tools",
          })}
          onClick={() => selectCatalogueTab("crossover-tools")}
        >
          <Wrench size={16} strokeWidth={2} />
          Ferramentas Red Wine
        </button>
      </nav>

      {activeTab === "crossover-tools" ? (
        <CrossOverToolsCatalog />
      ) : activeTab === "mac-native" ? (
        <MacNativeCatalogue />
      ) : activeTab === "switch1" ? (
        <SwitchCatalogue generation="switch1" />
      ) : activeTab === "switch2" ? (
        <SwitchCatalogue generation="switch2" />
      ) : (
        <>
          <div className="catalogue__header">
            <div className="catalogue__header-row">
              <div className="catalogue__header-summary">
                <span className="catalogue__result-count">
                  {t("result_count", {
                    resultCount: formatNumber(itemsCount),
                  })}
                </span>
                {selectedFiltersCount === 0 && (
                  <span className="catalogue__filters-hint">
                    {t("filters_sidebar_hint")}
                  </span>
                )}
              </div>

              <div className="catalogue__sort-inline">
                <span className="catalogue__sort-label">{t("sort_by")}</span>
                <SelectField
                  theme="dark"
                  className="catalogue__sort-select"
                  value={
                    sortValues.includes(selectedSortValue as CatalogueSortValue)
                      ? selectedSortValue
                      : "popularity:desc"
                  }
                  options={sortOptions}
                  onChange={(event) => {
                    const [sortBy, sortOrder] = event.target.value.split(
                      ":"
                    ) as [
                      CatalogueSearchPayload["sortBy"],
                      CatalogueSearchPayload["sortOrder"],
                    ];

                    dispatch(setFilters({ sortBy, sortOrder }));
                  }}
                />
              </div>
            </div>

            {selectedFiltersCount > 0 && (
              <div className="catalogue__header-row catalogue__header-row--filters">
                <span className="catalogue__active-filters-label">
                  {t("active_filters")}
                </span>

                <div className="catalogue__filters-wrapper">
                  <ul className="catalogue__filters-list">
                    {activeGroupedFilters.map((filter) => (
                      <li key={`${filter.key}-${filter.value}`}>
                        <FilterItem
                          filter={filter.label ?? ""}
                          filterType={filter.filterType}
                          orbColor={filter.orbColor}
                          onRemove={() => {
                            if (filter.value === "range") {
                              dispatch(setFilters({ releaseYear: undefined }));
                              return;
                            }

                            if (filter.key === "recompilation") {
                              dispatch(setFilters({ [filter.key]: undefined }));
                              return;
                            }

                            if (filter.value === "threshold") {
                              dispatch(setFilters({ [filter.key]: [] }));
                              return;
                            }

                            const currentValues =
                              (filters[filter.key] as
                                | (string | number)[]
                                | undefined) ?? [];

                            dispatch(
                              setFilters({
                                [filter.key]: currentValues.filter(
                                  (item) => item !== filter.value
                                ),
                              })
                            );
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </div>

                <Button
                  type="button"
                  theme="outline"
                  className="catalogue__clear-all-button"
                  onClick={() => dispatch(setFilters(clearAllCategoryFilters))}
                >
                  {t("clear_filters", {
                    filterCount: formatNumber(selectedFiltersCount),
                  })}
                </Button>
              </div>
            )}
          </div>

          <div className="catalogue__content">
            <div
              className={cn("catalogue__games-container", {
                "catalogue__games-container--classics": mode === "classics",
              })}
            >
              {showSkeleton ? (
                <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
                  {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <Skeleton key={i} className="catalogue__skeleton" />
                  ))}
                </SkeletonTheme>
              ) : (
                results.map((game) => <GameItem key={game.id} game={game} />)
              )}

              <div className="catalogue__pagination-container">
                <Pagination
                  page={page}
                  totalPages={Math.ceil(itemsCount / PAGE_SIZE)}
                  onPageChange={(page) => {
                    dispatch(setPage(page));
                    if (cataloguePageRef.current) {
                      cataloguePageRef.current.scrollTop = 0;
                    }
                  }}
                />
              </div>
            </div>

            <div className="catalogue__filters-container">
              <div className="catalogue__filters-sections">
                <ReleaseYearSection
                  title={t("release_year")}
                  color={filterCategoryColors.releaseYear}
                  value={filters.releaseYear}
                  onChange={(value) =>
                    dispatch(setFilters({ releaseYear: value }))
                  }
                />

                {filterSections.map((section) => (
                  <FilterSection
                    key={section.key}
                    title={section.title}
                    onClear={() => dispatch(setFilters({ [section.key]: [] }))}
                    color={filterCategoryColors[section.key]}
                    onSelect={(value) => {
                      if (filters[section.key].includes(value)) {
                        dispatch(
                          setFilters({
                            [section.key]: filters[
                              section.key as
                                | "genres"
                                | "tags"
                                | "downloadSourceFingerprints"
                                | "developers"
                                | "publishers"
                                | "protondbSupportBadges"
                                | "deckCompatibility"
                            ].filter((item) => item !== value),
                          })
                        );
                      } else {
                        dispatch(
                          setFilters({
                            [section.key]: [...filters[section.key], value],
                          })
                        );
                      }
                    }}
                    items={section.items}
                    isLoading={section.isLoading}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
