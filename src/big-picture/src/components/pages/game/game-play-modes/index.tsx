import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  extractPlayModesFromSteamCategories,
  hasAnyPlayMode,
} from "@shared";
import type { ShopDetails } from "@types";
import {
  PersonIcon,
  PeopleIcon,
  GlobeIcon,
  DeviceDesktopIcon,
  FlameIcon,
  SyncIcon,
} from "@primer/octicons-react";
import type { FocusOverrides } from "../../../../services";
import { FocusItem, Typography } from "../../../common";
import "./styles.scss";

export interface GamePlayModesBoxProps {
  shopDetails: ShopDetails;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationOrder?: number;
}

export function GamePlayModesBox({
  shopDetails,
  focusId,
  focusNavigationOverrides,
  focusNavigationOrder,
}: Readonly<GamePlayModesBoxProps>) {
  const { t } = useTranslation("game_details");

  const modes = useMemo(() => {
    return extractPlayModesFromSteamCategories(shopDetails?.categories);
  }, [shopDetails?.categories]);

  if (!hasAnyPlayMode(modes)) {
    return null;
  }

  const title = t("play_modes", "Modos de Jogo");

  return (
    <FocusItem
      id={focusId}
      navigationOverrides={focusNavigationOverrides}
      navigationOrder={focusNavigationOrder}
      asChild
    >
      <section
        className="game-page__sidebar-section game-page__play-modes"
        aria-label={title}
      >
        <div className="game-page__play-modes-title">
          <Typography>{title}</Typography>
        </div>

        <div className="game-page__play-modes-list">
          {modes.singlePlayer && (
            <div className="game-page__play-modes-item">
              <PersonIcon size={16} />
              <Typography>{t("single_player", "Um jogador")}</Typography>
            </div>
          )}
          {modes.multiPlayer && (
            <div className="game-page__play-modes-item">
              <PeopleIcon size={16} />
              <Typography>{t("multiplayer", "Multijogador")}</Typography>
            </div>
          )}
          {modes.onlineCoop && (
            <div className="game-page__play-modes-item">
              <GlobeIcon size={16} />
              <Typography>{t("online_coop", "Cooperativo online")}</Typography>
            </div>
          )}
          {modes.offlineCoop && (
            <div className="game-page__play-modes-item">
              <DeviceDesktopIcon size={16} />
              <Typography>
                {t("offline_coop", "Cooperativo local / Tela dividida")}
              </Typography>
            </div>
          )}
          {modes.pvpOnline && (
            <div className="game-page__play-modes-item">
              <FlameIcon size={16} />
              <Typography>{t("online_pvp", "PvP online")}</Typography>
            </div>
          )}
          {modes.crossPlatform && (
            <div className="game-page__play-modes-item">
              <SyncIcon size={16} />
              <Typography>{t("cross_platform", "Multiplataforma")}</Typography>
            </div>
          )}
        </div>
      </section>
    </FocusItem>
  );
}
