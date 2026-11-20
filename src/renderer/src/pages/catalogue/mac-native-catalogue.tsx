import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { CheckIcon, PlusIcon, QuestionIcon } from "@primer/octicons-react";
import cn from "classnames";
import type { MacNativeCatalogueItem } from "@types";
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

type MacNativeSortValue = "recent" | "alpha_asc" | "alpha_desc";
const PAGE_SIZE = 30;

export function MacNativeCatalogue() {
  const { library, updateLibrary } = useLibrary();
  const { showSuccessToast, showErrorToast } = useToast();

  const [items, setItems] = useState<MacNativeCatalogueItem[]>([]);
  const [searchResults, setSearchResults] = useState<
    MacNativeCatalogueItem[] | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearchingLive, setIsSearchingLive] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<MacNativeSortValue>("recent");
  const [page, setPage] = useState(1);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [addingIds, setAddingIds] = useState<Set<string>>(() => new Set());

  const loadCatalogue = useCallback(
    async (force = false) => {
      if (force) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const res = await window.electron.macNativeGetCatalogue(force);
        setItems(res.items ?? []);
      } catch {
        showErrorToast(
          "Não foi possível carregar o catálogo Mac Native (Appstorrent / TorrentMac)."
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [showErrorToast]
  );

  useEffect(() => {
    void loadCatalogue(false);
  }, [loadCatalogue]);

  // Debounced live search on Appstorrent & TorrentMac when user types >= 3 chars
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 3) {
      setSearchResults(null);
      setIsSearchingLive(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearchingLive(true);
      try {
        const live = await window.electron.macNativeSearchCatalogue(trimmed);
        if (!cancelled) setSearchResults(live);
      } catch {
        // Keep local filtering fallback
      } finally {
        if (!cancelled) setIsSearchingLive(false);
      }
    }, 550);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedSources, sortBy]);

  const baseList = searchResults ?? items;

  const sourceItems = useMemo(() => {
    const appCount = baseList.filter((i) =>
      i.sources.some((s) => s.source === "appstorrent")
    ).length;
    const tmCount = baseList.filter((i) =>
      i.sources.some((s) => s.source === "torrentmac")
    ).length;
    return [
      {
        label: `Appstorrent (${appCount})`,
        value: "appstorrent",
        checked: selectedSources.includes("appstorrent"),
      },
      {
        label: `TorrentMac (${tmCount})`,
        value: "torrentmac",
        checked: selectedSources.includes("torrentmac"),
      },
    ];
  }, [baseList, selectedSources]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = baseList.filter((item) => {
      if (
        q &&
        !item.title.toLowerCase().includes(q) &&
        !item.normalizedTitle.includes(q)
      ) {
        return false;
      }
      if (selectedSources.length > 0) {
        const matches = selectedSources.some((src) =>
          item.sources.some((s) => s.source === src)
        );
        if (!matches) return false;
      }
      return true;
    });

    if (sortBy === "alpha_asc") {
      return [...list].sort((a, b) => a.title.localeCompare(b.title));
    }
    if (sortBy === "alpha_desc") {
      return [...list].sort((a, b) => b.title.localeCompare(a.title));
    }
    return list;
  }, [baseList, searchQuery, selectedSources, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const paginatedItems = useMemo(
    () => filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredItems, page]
  );

  const libraryMacSet = useMemo(() => {
    const set = new Set<string>();
    for (const item of library) {
      if (item.shop === "mac_native") {
        set.add(item.objectId);
      }
    }
    return set;
  }, [library]);

  const toggleSource = (val: string) => {
    setSelectedSources((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
    );
  };

  const handleAddToLibrary = async (item: MacNativeCatalogueItem) => {
    if (addingIds.has(item.objectId) || libraryMacSet.has(item.objectId)) {
      return;
    }
    setAddingIds((prev) => new Set(prev).add(item.objectId));
    try {
      await window.electron.addGameToLibrary(
        "mac_native",
        item.objectId,
        item.title,
        "macOS Native"
      );
      await updateLibrary();
      showSuccessToast(`"${item.title}" adicionado à biblioteca.`);
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.objectId);
        return next;
      });
    }
  };

  return (
    <div className="switch-catalogue">
      <div className="catalogue__header">
        <div className="catalogue__header-row">
          <div className="catalogue__header-summary">
            <span className="catalogue__result-count">
              {filteredItems.length} jogos Mac Native encontrados
            </span>
            <span className="catalogue__filters-hint">
              Fontes integradas: Appstorrent &amp; TorrentMac
              {isSearchingLive ? " · Buscando ao vivo..." : ""}
            </span>
          </div>

          <div className="switch-catalogue__header-controls">
            <TextField
              theme="dark"
              placeholder="Buscar jogo nativo para Mac..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              rightContent={<Search size={14} />}
            />

            <SelectField
              theme="dark"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as MacNativeSortValue)}
              options={[
                { key: "recent", value: "recent", label: "Mais recentes" },
                { key: "alpha_asc", value: "alpha_asc", label: "Título (A–Z)" },
                {
                  key: "alpha_desc",
                  value: "alpha_desc",
                  label: "Título (Z–A)",
                },
              ]}
            />

            <Button
              theme="outline"
              size="small"
              onClick={() => void loadCatalogue(true)}
              disabled={isRefreshing}
            >
              <RefreshCw size={14} className={cn({ spin: isRefreshing })} />
              {isRefreshing ? "Atualizando..." : "Atualizar"}
            </Button>
          </div>
        </div>

        {selectedSources.length > 0 && (
          <div className="catalogue__header-row catalogue__header-row--filters">
            <span className="catalogue__active-filters-label">
              Filtros ativos
            </span>
            <div className="catalogue__filters-wrapper">
              <ul className="catalogue__filters-list">
                {selectedSources.map((src) => (
                  <li key={`mac-src-${src}`}>
                    <FilterItem
                      filter={
                        src === "appstorrent" ? "Appstorrent" : "TorrentMac"
                      }
                      filterType="Fonte"
                      orbColor="#f59e0b"
                      onRemove={() => toggleSource(src)}
                    />
                  </li>
                ))}
              </ul>
            </div>
            <Button
              theme="outline"
              size="small"
              onClick={() => setSelectedSources([])}
            >
              Limpar filtros ({selectedSources.length})
            </Button>
          </div>
        )}
      </div>

      <div className="catalogue__content">
        <div className="catalogue__games-container">
          {isLoading ? (
            <p className="switch-catalogue__empty">
              Carregando jogos nativos de macOS (Appstorrent &amp;
              TorrentMac)...
            </p>
          ) : paginatedItems.length === 0 ? (
            <p className="switch-catalogue__empty">
              Nenhum jogo Mac Native encontrado com os filtros selecionados.
            </p>
          ) : (
            paginatedItems.map((item) => {
              const added = libraryMacSet.has(item.objectId);
              const isAdding = addingIds.has(item.objectId);
              const detailsPath = `/game/mac_native/${encodeURIComponent(
                item.objectId
              )}?title=${encodeURIComponent(item.title)}`;
              const thumb = item.coverUrl || item.iconUrl;

              return (
                <article key={item.id} className="game-item">
                  <Link to={detailsPath} className="game-item__content-link">
                    <div className="game-item__cover-wrapper">
                      {thumb ? (
                        <img
                          className="game-item__cover"
                          src={thumb}
                          alt={item.title}
                          width={200}
                          height={103}
                          loading="lazy"
                        />
                      ) : (
                        <div className="game-item__cover-placeholder">
                          <QuestionIcon size={28} />
                        </div>
                      )}
                    </div>

                    <div className="game-item__details">
                      <span>{item.title}</span>
                      <span className="game-item__genres">
                        {[
                          "macOS Native",
                          item.version ? `v${item.version}` : null,
                          item.fileSize,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>

                      <div className="game-item__repackers">
                        {item.sources.map((src) => (
                          <Badge key={`${item.id}-${src.detailUrl}`}>
                            {src.sourceLabel}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </Link>

                  <button
                    type="button"
                    className={cn("game-item__plus-wrapper", {
                      "game-item__plus-wrapper--added": added,
                    })}
                    onClick={() => void handleAddToLibrary(item)}
                    title={
                      added ? "Já está na biblioteca" : "Adicionar à biblioteca"
                    }
                    aria-label={
                      added ? "Já está na biblioteca" : "Adicionar à biblioteca"
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
              title="Fontes Mac Native"
              color="#f59e0b"
              items={sourceItems}
              onSelect={(value) => toggleSource(String(value))}
              onClear={() => setSelectedSources([])}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
