import { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  PersonIcon,
  PeopleIcon,
  GlobeIcon,
  DeviceDesktopIcon,
  FlameIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { extractPlayModesFromSteamCategories, hasAnyPlayMode } from "@shared";
import { gameDetailsContext } from "@renderer/context";
import { SidebarSection } from "../sidebar-section/sidebar-section";

import "./game-modes-section.scss";

export function GameModesSection() {
  const { t } = useTranslation("game_details");
  const { shopDetails } = useContext(gameDetailsContext);

  const modes = useMemo(() => {
    return extractPlayModesFromSteamCategories(shopDetails?.categories);
  }, [shopDetails?.categories]);

  if (!hasAnyPlayMode(modes)) {
    return null;
  }

  return (
    <SidebarSection title={t("play_modes", "Modos de Jogo")}>
      <div className="game-modes-section">
        <div className="game-modes-section__grid">
          {modes.singlePlayer && (
            <div className="game-modes-section__badge">
              <PersonIcon size={16} />
              <span>{t("single_player", "Um jogador")}</span>
            </div>
          )}
          {modes.multiPlayer && (
            <div className="game-modes-section__badge">
              <PeopleIcon size={16} />
              <span>{t("multiplayer", "Multijogador")}</span>
            </div>
          )}
          {modes.onlineCoop && (
            <div className="game-modes-section__badge">
              <GlobeIcon size={16} />
              <span>{t("online_coop", "Cooperativo online")}</span>
            </div>
          )}
          {modes.offlineCoop && (
            <div className="game-modes-section__badge">
              <DeviceDesktopIcon size={16} />
              <span>
                {t("offline_coop", "Cooperativo local / Tela dividida")}
              </span>
            </div>
          )}
          {modes.pvpOnline && (
            <div className="game-modes-section__badge">
              <FlameIcon size={16} />
              <span>{t("online_pvp", "PvP online")}</span>
            </div>
          )}
          {modes.crossPlatform && (
            <div className="game-modes-section__badge">
              <SyncIcon size={16} />
              <span>{t("cross_platform", "Multiplataforma")}</span>
            </div>
          )}
        </div>
      </div>
    </SidebarSection>
  );
}
