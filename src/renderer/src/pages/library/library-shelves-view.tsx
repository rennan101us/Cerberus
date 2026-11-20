import { useMemo, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SlidersIcon,
} from "@primer/octicons-react";
import type { LibraryGame } from "@types";
import { LibraryGameCard } from "./library-game-card";
import {
  buildLibraryShelves,
  getStoredShelvesHidden,
  getStoredShelvesOrder,
  type ComputedShelf,
} from "./library-shelves-data";
import { LibraryShelvesConfigModal } from "./library-shelves-config-modal";
import "./library-shelves-view.scss";

interface LibraryShelvesViewProps {
  games: LibraryGame[];
  onContextMenu: (
    game: LibraryGame,
    position: { x: number; y: number }
  ) => void;
}

interface ShelfRowProps {
  shelf: ComputedShelf<LibraryGame>;
  onContextMenu: (
    game: LibraryGame,
    position: { x: number; y: number }
  ) => void;
}

function ShelfRow({ shelf, onContextMenu }: Readonly<ShelfRowProps>) {
  const trackRef = useRef<HTMLDivElement>(null);

  const handleScroll = (direction: -1 | 1) => {
    if (!trackRef.current) return;
    const scrollAmount = trackRef.current.clientWidth * 0.75;
    trackRef.current.scrollBy({
      left: direction * scrollAmount,
      behavior: "smooth",
    });
  };

  return (
    <section className="library-shelf-row" aria-label={shelf.label}>
      <header className="library-shelf-row__header">
        <h2 className="library-shelf-row__title">{shelf.label}</h2>
        <span className="library-shelf-row__count">{shelf.games.length}</span>
      </header>

      <div className="library-shelf-row__track-container">
        <button
          type="button"
          className="library-shelf-row__nav-btn library-shelf-row__nav-btn--left"
          onClick={() => handleScroll(-1)}
          aria-label={`Rolar ${shelf.label} para a esquerda`}
        >
          <ChevronLeftIcon size={24} />
        </button>

        <div className="library-shelf-row__track" ref={trackRef}>
          {shelf.games.map((game) => (
            <div key={game.id} className="library-shelf-row__card-wrapper">
              <LibraryGameCard game={game} onContextMenu={onContextMenu} />
            </div>
          ))}
        </div>

        <button
          type="button"
          className="library-shelf-row__nav-btn library-shelf-row__nav-btn--right"
          onClick={() => handleScroll(1)}
          aria-label={`Rolar ${shelf.label} para a direita`}
        >
          <ChevronRightIcon size={24} />
        </button>
      </div>
    </section>
  );
}

export function LibraryShelvesView({
  games,
  onContextMenu,
}: Readonly<LibraryShelvesViewProps>) {
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [version, setVersion] = useState(0);

  const shelves = useMemo(
    () =>
      buildLibraryShelves(
        games,
        getStoredShelvesOrder(),
        getStoredShelvesHidden()
      ),
    [games, version]
  );

  return (
    <div className="library-shelves-view">
      <div className="library-shelves-view__top-bar">
        <button
          type="button"
          className="library-shelves-view__config-btn"
          onClick={() => setConfigModalOpen(true)}
        >
          <SlidersIcon size={14} />
          <span>Organizar Sessões</span>
        </button>
      </div>

      {shelves.length === 0 ? (
        <div className="library-shelves-view__empty">
          <p>Nenhum jogo encontrado com os filtros atuais.</p>
        </div>
      ) : (
        shelves.map((shelf) => (
          <ShelfRow
            key={shelf.id}
            shelf={shelf}
            onContextMenu={onContextMenu}
          />
        ))
      )}

      {configModalOpen && (
        <LibraryShelvesConfigModal
          visible={configModalOpen}
          onClose={() => setConfigModalOpen(false)}
          onSaved={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
