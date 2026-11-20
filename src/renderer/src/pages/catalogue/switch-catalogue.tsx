import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { CheckIcon, PlusIcon, QuestionIcon } from "@primer/octicons-react";
import cn from "classnames";
import type {
  NxCompatibleGame,
  NxSystemHardwareInfo,
  SwitchGeneration,
} from "@types";
import {
  Badge,
  Button,
  Link,
  SelectField,
  TextField,
} from "@renderer/components";
import { useLibrary, useToast } from "@renderer/hooks";
import { FilterSection } from "./filter-section";
import { FilterItem } from "./filter-item";
import { Pagination } from "./pagination";
import "./game-item.scss";
import "./switch-catalogue.scss";

interface SwitchCatalogueProps {
  generation: SwitchGeneration;
}

type SwitchSortValue = "new" | "alpha_asc" | "alpha_desc" | "ram_asc";
const PAGE_SIZE = 30;

export function SwitchCatalogue({
  generation,
}: Readonly<SwitchCatalogueProps>) {
  const { library, updateLibrary } = useLibrary();
  const { showSuccessToast, showErrorToast } = useToast();

  const [allGames, setAllGames] = useState<NxCompatibleGame[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [hardware, setHardware] = useState<NxSystemHardwareInfo | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SwitchSortValue>("new");
  const [page, setPage] = useState(1);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedRam, setSelectedRam] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [addingIds, setAddingIds] = useState<Set<string>>(() => new Set());
  const [failedCovers, setFailedCovers] = useState<Set<string>>(
    () => new Set()
  );

  const loadGames = useCallback(
    async (force = false) => {
      if (force) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const [res, hw] = await Promise.all([
          force
            ? window.electron.nxRefreshCompatibleGames()
            : window.electron.nxGetCompatibleGames(false),
          window.electron.nxGetSystemHardwareInfo(),
        ]);
        setAllGames(res.games);
        setIsOnline(res.isOnline);
        setHardware(hw);

        const hasAnySources = res.games.some(
          (g) => Array.isArray(g.cloudSources) && g.cloudSources.length > 0
        );
        if (force || !hasAnySources) {
          void window.electron
            .nxSyncSwitchSources()
            .then(() => window.electron.nxGetCompatibleGames(false))
            .then((updated) => setAllGames(updated.games))
            .catch(() => {});
        }
      } catch {
        showErrorToast("Não foi possível carregar a lista de compatibilidade.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [showErrorToast]
  );

  useEffect(() => {
    void loadGames(false);
  }, [loadGames]);

  useEffect(() => {
    const unsubscribe = window.electron.onNxLibraryUpdated(() => {
      void window.electron
        .nxGetCompatibleGames(false)
        .then((res) => setAllGames(res.games))
        .catch(() => {});
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    setPage(1);
    setFailedCovers(new Set());
  }, [
    generation,
    searchQuery,
    selectedPlatforms,
    selectedRam,
    selectedGenres,
    selectedSources,
    sortBy,
  ]);

  const genGames = useMemo(
    () => allGames.filter((g) => g.generation === generation),
    [allGames, generation]
  );

  const platformItems = useMemo(() => {
    const macCount = genGames.filter((g) => g.isMacSupported).length;
    const iosCount = genGames.filter((g) => g.isIosSupported).length;
    const ipadCount = genGames.filter((g) => g.isIpadOsSupported).length;
    const androidCount = genGames.filter((g) => g.isAndroidSupported).length;
    return [
      {
        label: `macOS (${macCount})`,
        value: "macOS",
        checked: selectedPlatforms.includes("macOS"),
      },
      {
        label: `iOS (${iosCount})`,
        value: "iOS",
        checked: selectedPlatforms.includes("iOS"),
      },
      {
        label: `iPadOS (${ipadCount})`,
        value: "iPadOS",
        checked: selectedPlatforms.includes("iPadOS"),
      },
      {
        label: `Android (${androidCount})`,
        value: "Android",
        checked: selectedPlatforms.includes("Android"),
      },
    ];
  }, [genGames, selectedPlatforms]);

  const ramItems = useMemo(() => {
    const myRam = hardware?.physicalRamGB ?? 16;
    const tiers = [4, 6, 8, 16];
    return [
      {
        label: `Meu Mac (${myRam} GB RAM) (${genGames.filter((g) => g.minRamGB <= myRam).length})`,
        value: `my_mac_${myRam}`,
        checked: selectedRam.includes(`my_mac_${myRam}`),
      },
      ...tiers.map((gb) => ({
        label: `Até ${gb} GB RAM (${genGames.filter((g) => g.minRamGB <= gb).length})`,
        value: String(gb),
        checked: selectedRam.includes(String(gb)),
      })),
    ];
  }, [genGames, hardware, selectedRam]);

  const genreItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of genGames) {
      for (const genre of g.genres || []) {
        counts.set(genre, (counts.get(genre) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([genre, count]) => ({
        label: `${genre} (${count})`,
        value: genre,
        checked: selectedGenres.includes(genre),
      }));
  }, [genGames, selectedGenres]);

  const sourceItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of genGames) {
      for (const s of g.cloudSources || []) {
        counts.set(s, (counts.get(s) || 0) + 1);
      }
    }
    const items = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([src, count]) => ({
        label: `${src} (${count})`,
        value: src,
        checked: selectedSources.includes(src),
      }));
    if (items.length > 0) {
      items.unshift({
        label: `Qualquer fonte disponível (${genGames.filter((g) => g.cloudSources.length > 0).length})`,
        value: "__any__",
        checked: selectedSources.includes("__any__"),
      });
    }
    return items;
  }, [genGames, selectedSources]);

  const filteredGames = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const myRam = hardware?.physicalRamGB ?? 16;

    const list = genGames.filter((game) => {
      if (
        q &&
        !game.title.toLowerCase().includes(q) &&
        !game.titleId.toLowerCase().includes(q) &&
        !game.engine.toLowerCase().includes(q)
      ) {
        return false;
      }

      if (selectedPlatforms.length > 0) {
        const matchesPlatform = selectedPlatforms.some((p) => {
          if (p === "macOS") return game.isMacSupported;
          if (p === "iOS") return game.isIosSupported;
          if (p === "iPadOS") return game.isIpadOsSupported;
          if (p === "Android") return game.isAndroidSupported;
          return true;
        });
        if (!matchesPlatform) return false;
      }

      if (selectedRam.length > 0) {
        const maxAllowed = Math.min(
          ...selectedRam.map((v) =>
            v.startsWith("my_mac_") ? myRam : Number.parseInt(v, 10) || 64
          )
        );
        if (game.minRamGB > maxAllowed) return false;
      }

      if (selectedGenres.length > 0) {
        const hasGenre = selectedGenres.some((g) => game.genres.includes(g));
        if (!hasGenre) return false;
      }

      if (selectedSources.length > 0) {
        const matchesSource = selectedSources.some((s) =>
          s === "__any__"
            ? game.cloudSources.length > 0
            : game.cloudSources.includes(s)
        );
        if (!matchesSource) return false;
      }

      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === "new") {
        if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
        if (b.addedTimestamp !== a.addedTimestamp) {
          return b.addedTimestamp - a.addedTimestamp;
        }
        return a.title.localeCompare(b.title);
      }
      if (sortBy === "alpha_desc") return b.title.localeCompare(a.title);
      if (sortBy === "ram_asc") {
        if (a.minRamGB !== b.minRamGB) return a.minRamGB - b.minRamGB;
        return a.title.localeCompare(b.title);
      }
      return a.title.localeCompare(b.title);
    });
  }, [
    genGames,
    searchQuery,
    selectedPlatforms,
    selectedRam,
    selectedGenres,
    selectedSources,
    sortBy,
    hardware,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredGames.length / PAGE_SIZE));
  const paginatedGames = useMemo(
    () => filteredGames.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredGames, page]
  );

  const libraryByTid = useMemo(() => {
    const map = new Map<string, (typeof library)[number]>();
    for (const item of library) {
      if (item.shop === "switch1" || item.shop === "switch2") {
        map.set((item.switchTitleId || item.objectId).toUpperCase(), item);
      }
    }
    return map;
  }, [library]);

  const toggleItem = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    val: string
  ) => {
    setter((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
    );
  };

  const handleAddToLibrary = async (game: NxCompatibleGame) => {
    const tid = game.titleId.toUpperCase();
    if (addingIds.has(tid) || libraryByTid.has(tid)) return;
    setAddingIds((prev) => new Set(prev).add(tid));
    try {
      await window.electron.addGameToLibrary(
        game.generation,
        game.titleId,
        game.title,
        game.generation === "switch2" ? "Nintendo Switch 2" : "Nintendo Switch"
      );
      await updateLibrary();
      showSuccessToast(`"${game.title}" adicionado à biblioteca.`);
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(tid);
        return next;
      });
    }
  };

  const activeFiltersCount =
    selectedPlatforms.length +
    selectedRam.length +
    selectedGenres.length +
    selectedSources.length;

  return (
    <div className="switch-catalogue">
      <div className="catalogue__header">
        <div className="catalogue__header-row">
          <div className="catalogue__header-summary">
            <span className="catalogue__result-count">
              {filteredGames.length} jogos encontrados (
              {generation === "switch2"
                ? "Nintendo Switch 2"
                : "Nintendo Switch 1"}
              )
            </span>
            <span className="catalogue__filters-hint">
              Fonte: nxnative + nx2android (
              {isOnline ? "GitHub Online" : "Local"})
            </span>
          </div>

          <div className="switch-catalogue__header-controls">
            <TextField
              theme="dark"
              placeholder="Buscar jogo, Title ID ou engine..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              rightContent={<Search size={14} />}
            />

            <SelectField
              theme="dark"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SwitchSortValue)}
              options={[
                { key: "new", value: "new", label: "Novos primeiro" },
                { key: "alpha_asc", value: "alpha_asc", label: "Título (A–Z)" },
                {
                  key: "alpha_desc",
                  value: "alpha_desc",
                  label: "Título (Z–A)",
                },
                { key: "ram_asc", value: "ram_asc", label: "Menor RAM" },
              ]}
            />

            <Button
              theme="outline"
              size="small"
              onClick={() => void loadGames(true)}
              disabled={isRefreshing}
            >
              <RefreshCw size={14} className={cn({ spin: isRefreshing })} />
              {isRefreshing ? "Atualizando..." : "Atualizar"}
            </Button>
          </div>
        </div>

        {activeFiltersCount > 0 && (
          <div className="catalogue__header-row catalogue__header-row--filters">
            <span className="catalogue__active-filters-label">
              Filtros ativos
            </span>
            <div className="catalogue__filters-wrapper">
              <ul className="catalogue__filters-list">
                {selectedPlatforms.map((p) => (
                  <li key={`plat-${p}`}>
                    <FilterItem
                      filter={p}
                      filterType="Plataforma"
                      orbColor="#3b82f6"
                      onRemove={() => toggleItem(setSelectedPlatforms, p)}
                    />
                  </li>
                ))}
                {selectedRam.map((r) => (
                  <li key={`ram-${r}`}>
                    <FilterItem
                      filter={
                        r.startsWith("my_mac_")
                          ? `Meu Mac (${r.replace("my_mac_", "")}GB)`
                          : `Até ${r}GB RAM`
                      }
                      filterType="RAM"
                      orbColor="#10b981"
                      onRemove={() => toggleItem(setSelectedRam, r)}
                    />
                  </li>
                ))}
                {selectedGenres.map((g) => (
                  <li key={`genre-${g}`}>
                    <FilterItem
                      filter={g}
                      filterType="Gênero"
                      orbColor="#8b5cf6"
                      onRemove={() => toggleItem(setSelectedGenres, g)}
                    />
                  </li>
                ))}
                {selectedSources.map((s) => (
                  <li key={`src-${s}`}>
                    <FilterItem
                      filter={s === "__any__" ? "Com fonte" : s}
                      filterType="Fonte"
                      orbColor="#f59e0b"
                      onRemove={() => toggleItem(setSelectedSources, s)}
                    />
                  </li>
                ))}
              </ul>
            </div>
            <Button
              theme="outline"
              size="small"
              onClick={() => {
                setSelectedPlatforms([]);
                setSelectedRam([]);
                setSelectedGenres([]);
                setSelectedSources([]);
              }}
            >
              Limpar filtros ({activeFiltersCount})
            </Button>
          </div>
        )}
      </div>

      <div className="catalogue__content">
        <div className="catalogue__games-container">
          {isLoading ? (
            <p className="switch-catalogue__empty">
              Carregando jogos compatíveis do nxnative e nx2android...
            </p>
          ) : paginatedGames.length === 0 ? (
            <p className="switch-catalogue__empty">
              Nenhum jogo encontrado com os filtros selecionados.
            </p>
          ) : (
            paginatedGames.map((game) => {
              const tid = game.titleId.toUpperCase();
              const inLibrary = libraryByTid.get(tid);
              const added = Boolean(inLibrary);
              const isAdding = addingIds.has(tid);
              const detailsPath = `/game/${inLibrary?.shop ?? game.generation}/${encodeURIComponent(
                inLibrary?.objectId ?? game.titleId
              )}?title=${encodeURIComponent(game.title)}`;

              return (
                <article key={game.id} className="game-item">
                  <Link to={detailsPath} className="game-item__content-link">
                    <div className="game-item__cover-wrapper">
                      {game.coverUrl && !failedCovers.has(game.coverUrl) ? (
                        <img
                          className="game-item__cover"
                          src={game.coverUrl}
                          alt={game.title}
                          width={200}
                          height={103}
                          loading="lazy"
                          onError={() => {
                            const url = game.coverUrl;
                            if (!url) return;
                            setFailedCovers((prev) => {
                              if (prev.has(url)) return prev;
                              const next = new Set(prev);
                              next.add(url);
                              return next;
                            });
                          }}
                        />
                      ) : (
                        <div className="game-item__cover-placeholder">
                          <QuestionIcon size={28} />
                        </div>
                      )}
                    </div>

                    <div className="game-item__details">
                      <span>{game.title}</span>
                      {game.genres && game.genres.length > 0 ? (
                        <span className="game-item__genres">
                          {game.genres.join(", ")}
                        </span>
                      ) : (
                        <span className="game-item__genres game-item__genres--empty">
                          {game.engine} · {game.minRamGB} GB RAM+
                        </span>
                      )}

                      <div className="game-item__repackers">
                        {game.isMacSupported && <Badge>macOS</Badge>}
                        {game.isIosSupported && <Badge>iOS/iPadOS</Badge>}
                        {game.isAndroidSupported && <Badge>Android</Badge>}
                        {game.cloudSources.map((src) => (
                          <Badge key={src}>{src}</Badge>
                        ))}
                      </div>
                    </div>
                  </Link>

                  <button
                    type="button"
                    className={cn("game-item__plus-wrapper", {
                      "game-item__plus-wrapper--added": added,
                    })}
                    onClick={() => void handleAddToLibrary(game)}
                    title={
                      added
                        ? "Já está na biblioteca"
                        : "Adicionar à biblioteca"
                    }
                    aria-label={
                      added
                        ? "Já está na biblioteca"
                        : "Adicionar à biblioteca"
                    }
                    disabled={added || isAdding}
                  >
                    {added ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
                  </button>
                </article>
              );
            })
          )}

          {totalPages > 1 && (
            <div className="catalogue__pagination-container">
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={(nextPage) => setPage(nextPage)}
              />
            </div>
          )}
        </div>

        <div className="catalogue__filters-container">
          <div className="catalogue__filters-sections">
            <FilterSection
              title="Plataforma"
              color="#3b82f6"
              items={platformItems}
              onSelect={(value) =>
                toggleItem(setSelectedPlatforms, String(value))
              }
              onClear={() => setSelectedPlatforms([])}
            />

            <FilterSection
              title="RAM"
              color="#10b981"
              items={ramItems}
              onSelect={(value) => toggleItem(setSelectedRam, String(value))}
              onClear={() => setSelectedRam([])}
            />

            <FilterSection
              title="Gênero"
              color="#8b5cf6"
              items={genreItems}
              onSelect={(value) => toggleItem(setSelectedGenres, String(value))}
              onClear={() => setSelectedGenres([])}
            />

            <FilterSection
              title="Fontes de Download"
              color="#f59e0b"
              items={sourceItems}
              onSelect={(value) =>
                toggleItem(setSelectedSources, String(value))
              }
              onClear={() => setSelectedSources([])}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
