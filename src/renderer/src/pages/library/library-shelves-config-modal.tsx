import { useState } from "react";
import { Modal, Button } from "@renderer/components";
import {
  ChevronUpIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeClosedIcon,
} from "@primer/octicons-react";
import {
  DEFAULT_LIBRARY_SHELVES_ORDER,
  SHELF_DEFINITIONS,
  getStoredShelvesHidden,
  getStoredShelvesOrder,
  saveStoredShelvesHidden,
  saveStoredShelvesOrder,
  type LibraryShelfId,
} from "./library-shelves-data";
import "./library-shelves-config-modal.scss";

interface LibraryShelvesConfigModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function LibraryShelvesConfigModal({
  visible,
  onClose,
  onSaved,
}: Readonly<LibraryShelvesConfigModalProps>) {
  const [order, setOrder] = useState<LibraryShelfId[]>(getStoredShelvesOrder);
  const [hidden, setHidden] = useState<LibraryShelfId[]>(
    getStoredShelvesHidden
  );

  const handleMove = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= order.length) return;
    const nextOrder = [...order];
    const [removed] = nextOrder.splice(index, 1);
    nextOrder.splice(nextIndex, 0, removed);
    setOrder(nextOrder);
  };

  const handleToggleHidden = (shelfId: LibraryShelfId) => {
    if (hidden.includes(shelfId)) {
      setHidden(hidden.filter((id) => id !== shelfId));
    } else {
      setHidden([...hidden, shelfId]);
    }
  };

  const handleReset = () => {
    setOrder([...DEFAULT_LIBRARY_SHELVES_ORDER]);
    setHidden([]);
  };

  const handleSave = () => {
    saveStoredShelvesOrder(order);
    saveStoredShelvesHidden(hidden);
    onSaved();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title="Organizar Sessões da Biblioteca"
      onClose={onClose}
    >
      <div className="library-shelves-config">
        <p className="library-shelves-config__description">
          Ajuste a ordem das categorias horizontais (estilo Netflix) ou oculte
          as que não deseja ver.
        </p>

        <div className="library-shelves-config__list">
          {order.map((shelfId, index) => {
            const def = SHELF_DEFINITIONS[shelfId];
            if (!def) return null;
            const isHidden = hidden.includes(shelfId);

            return (
              <div
                key={shelfId}
                className={`library-shelves-config__item ${
                  isHidden ? "library-shelves-config__item--hidden" : ""
                }`}
              >
                <span className="library-shelves-config__item-title">
                  {def.defaultLabel}
                </span>

                <div className="library-shelves-config__item-actions">
                  <button
                    type="button"
                    className="library-shelves-config__icon-btn"
                    disabled={index === 0}
                    onClick={() => handleMove(index, -1)}
                    title="Mover para cima"
                  >
                    <ChevronUpIcon size={16} />
                  </button>

                  <button
                    type="button"
                    className="library-shelves-config__icon-btn"
                    disabled={index === order.length - 1}
                    onClick={() => handleMove(index, 1)}
                    title="Mover para baixo"
                  >
                    <ChevronDownIcon size={16} />
                  </button>

                  <button
                    type="button"
                    className={`library-shelves-config__icon-btn ${
                      !isHidden
                        ? "library-shelves-config__icon-btn--active"
                        : ""
                    }`}
                    onClick={() => handleToggleHidden(shelfId)}
                    title={isHidden ? "Mostrar sessão" : "Ocultar sessão"}
                  >
                    {isHidden ? (
                      <EyeClosedIcon size={16} />
                    ) : (
                      <EyeIcon size={16} />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="library-shelves-config__footer">
          <Button theme="outline" onClick={handleReset}>
            Restaurar Padrão
          </Button>

          <Button theme="primary" onClick={handleSave}>
            Salvar Alterações
          </Button>
        </div>
      </div>
    </Modal>
  );
}
