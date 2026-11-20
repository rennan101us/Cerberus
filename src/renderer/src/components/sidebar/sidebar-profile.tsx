import { PencilIcon } from "@primer/octicons-react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAppDispatch, useAppSelector, useToast } from "@renderer/hooks";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "react-tooltip";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { Avatar } from "../avatar/avatar";
import { logger } from "@renderer/logger";
import { setUserPreferences } from "@renderer/features";
import "./sidebar-profile.scss";

export interface SidebarProfileProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function SidebarProfile({
  isCollapsed = false,
  onToggleCollapse,
}: Readonly<SidebarProfileProps>) {
  const dispatch = useAppDispatch();
  const { showSuccessToast } = useToast();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [systemUsername, setSystemUsername] = useState<string>("");

  useEffect(() => {
    window.electron
      .getSystemUsername?.()
      .then((name) => {
        if (name) setSystemUsername(name);
      })
      .catch(() => {});
  }, []);

  const effectivePlayerName =
    userPreferences?.playerName?.trim() || systemUsername || "Jogador";

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(effectivePlayerName);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditingName) {
      setNameInput(effectivePlayerName);
    }
  }, [effectivePlayerName, isEditingName]);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  const savePlayerName = async () => {
    const trimmed = nameInput.trim() || systemUsername || "Jogador";
    setIsEditingName(false);
    setNameInput(trimmed);

    if (trimmed === (userPreferences?.playerName?.trim() || "")) {
      return;
    }

    try {
      await window.electron.updateUserPreferences({ playerName: trimmed });
      if (userPreferences) {
        dispatch(setUserPreferences({ ...userPreferences, playerName: trimmed }));
      }
      showSuccessToast(`Nome do jogador alterado para "${trimmed}"`);
    } catch (error) {
      logger.error("Failed to save player name", error);
    }
  };

  const handleProfileClick = () => {
    if (isEditingName) return;
    if (isCollapsed && onToggleCollapse) {
      onToggleCollapse();
    }
    setIsEditingName(true);
  };

  const handleTitleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingName(true);
  };

  const gameRunningDetails = () => {
    if (!gameRunning) return null;

    if (gameRunning.iconUrl) {
      return (
        <img
          className="sidebar-profile__game-running-icon"
          alt={gameRunning.title}
          width={24}
          src={gameRunning.iconUrl}
        />
      );
    }

    return <SteamLogo />;
  };

  return (
    <div
      className={`sidebar-profile${isCollapsed ? " sidebar-profile--collapsed" : ""}`}
    >
      {isCollapsed && onToggleCollapse && (
        <button
          type="button"
          className="sidebar-profile__drawer-toggle"
          onClick={onToggleCollapse}
          data-tooltip-id="sidebar-drawer-toggle-tooltip"
          data-tooltip-content="Expandir menu lateral"
          aria-label="Expandir menu lateral"
        >
          <PanelLeftOpen size={18} />
        </button>
      )}

      <div
        role="button"
        tabIndex={0}
        className={`sidebar-profile__button${isCollapsed ? " sidebar-profile__button--collapsed" : ""}`}
        onClick={handleProfileClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isEditingName) {
            handleProfileClick();
          }
        }}
        data-tooltip-id={isCollapsed ? "sidebar-profile-tooltip" : undefined}
        data-tooltip-content={
          isCollapsed
            ? gameRunning
              ? `${effectivePlayerName} — Jogando ${gameRunning.title}`
              : `${effectivePlayerName} (Clique para editar)`
            : undefined
        }
      >
        <div className="sidebar-profile__button-content">
          <span className="sidebar-profile__avatar">
            <Avatar
              size={isCollapsed ? 32 : 35}
              src={null}
              alt={effectivePlayerName}
            />
            {isCollapsed && gameRunning && (
              <span
                className="sidebar-profile__running-dot"
                title={gameRunning.title}
              />
            )}
          </span>

          {!isCollapsed && (
            <>
              <div className="sidebar-profile__button-information">
                {isEditingName ? (
                  <input
                    ref={nameInputRef}
                    type="text"
                    className="sidebar-profile__name-input"
                    value={nameInput}
                    maxLength={32}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setNameInput(e.target.value)}
                    onBlur={() => void savePlayerName()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        void savePlayerName();
                      } else if (e.key === "Escape") {
                        setIsEditingName(false);
                        setNameInput(effectivePlayerName);
                      }
                    }}
                  />
                ) : (
                  <div
                    className="sidebar-profile__title-row"
                    onClick={handleTitleClick}
                    title="Clique para alterar seu nome de jogador"
                  >
                    <p className="sidebar-profile__button-title">
                      {effectivePlayerName}
                    </p>
                    <PencilIcon
                      size={12}
                      className="sidebar-profile__edit-icon"
                    />
                  </div>
                )}

                {gameRunning && (
                  <div className="sidebar-profile__button-game-running-title">
                    <small>{gameRunning.title}</small>
                  </div>
                )}
              </div>

              {gameRunningDetails()}
            </>
          )}
        </div>
      </div>

      {!isCollapsed && onToggleCollapse && (
        <button
          type="button"
          className="sidebar-profile__drawer-toggle"
          onClick={onToggleCollapse}
          data-tooltip-id="sidebar-drawer-toggle-tooltip"
          data-tooltip-content="Recolher menu lateral"
          aria-label="Recolher menu lateral"
        >
          <PanelLeftClose size={18} />
        </button>
      )}

      <Tooltip id="sidebar-drawer-toggle-tooltip" place="right" />
      <Tooltip id="sidebar-profile-tooltip" place="right" />
    </div>
  );
}
