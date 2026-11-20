import { useContext, useEffect, useState } from "react";
import type {
  HowLongToBeatCategory,
  SteamAppDetails,
} from "@types";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/button/button";
import { StarRating } from "@renderer/components/star-rating/star-rating";

import { gameDetailsContext } from "@renderer/context";
import {
  useFormat,
} from "@renderer/hooks";
import {
  DownloadIcon,
  PeopleIcon,
  StarIcon,
} from "@primer/octicons-react";
import { HowLongToBeatSection } from "./how-long-to-beat-section";
import { LaunchboxDetailsSection } from "./launchbox-details-section";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./sidebar.scss";
import { GameLanguageSection } from "./game-language-section";
import { ControllerSupportSection } from "./controller-support-section";
import { GameModesSection } from "./game-modes-section";
import { RedWineRecommendedSection } from "./red-wine-recommended-section";

export function Sidebar() {
  const [howLongToBeat, setHowLongToBeat] = useState<{
    isLoading: boolean;
    data: HowLongToBeatCategory[] | null;
  }>({ isLoading: true, data: null });

  const [activeRequirement, setActiveRequirement] =
    useState<keyof SteamAppDetails["pc_requirements"]>("minimum");

  const {
    game,
    gameTitle,
    shopDetails,
    objectId,
    shop,
    catalogueGame,
    stats,
  } = useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");
  const { numberFormatter } = useFormat();

  const isSwitchGame = shop === "switch1" || shop === "switch2";
  const isMacNativeGame = shop === "mac_native";
  const hasVerifiedSteamCatalogue =
    catalogueGame.shop === "steam" && Boolean(catalogueGame.objectId);

  useEffect(() => {
    if (
      objectId &&
      ((!isSwitchGame && !isMacNativeGame) || hasVerifiedSteamCatalogue) &&
      catalogueGame.objectId
    ) {
      setHowLongToBeat({ isLoading: true, data: null });

      // Directly fetch from API without checking cache
      window.electron.hydraApi
        .get<HowLongToBeatCategory[] | null>(
          `/games/${catalogueGame.shop}/${catalogueGame.objectId}/how-long-to-beat`,
          {
            needsAuth: false,
          }
        )
        .then((howLongToBeatData) => {
          setHowLongToBeat({
            isLoading: false,
            data: Array.isArray(howLongToBeatData) ? howLongToBeatData : null,
          });
        })
        .catch(() => {
          setHowLongToBeat({ isLoading: false, data: null });
        });
    } else {
      setHowLongToBeat({ isLoading: false, data: null });
    }
  }, [
    objectId,
    isSwitchGame,
    hasVerifiedSteamCatalogue,
    catalogueGame.shop,
    catalogueGame.objectId,
  ]);

  const requirementHtml = isSwitchGame
    ? shopDetails?.mac_requirements?.[activeRequirement] ||
      shopDetails?.pc_requirements?.[activeRequirement]
    : shopDetails?.pc_requirements?.[activeRequirement];

  const isLaunchboxGame = shop === "launchbox";

  return (
    <aside className="content-sidebar">
      {!isSwitchGame && !isMacNativeGame && !isLaunchboxGame && (
        <RedWineRecommendedSection
          gameTitle={gameTitle}
          shop={shop}
          objectId={objectId}
          game={game}
          pcRequirements={shopDetails?.pc_requirements}
        />
      )}

      {stats && (
        <SidebarSection title={t("stats")}>
          <div className="stats__section">
            <div className="stats__category">
              <p className="stats__category-title">
                <DownloadIcon size={18} />
                {t("download_count")}
              </p>
              <p>{numberFormatter.format(stats?.downloadCount)}</p>
            </div>

            <div className="stats__category">
              <p className="stats__category-title">
                <PeopleIcon size={18} />
                {t("player_count")}
              </p>
              <p>{numberFormatter.format(stats?.playerCount)}</p>
            </div>

            <div className="stats__category">
              <p className="stats__category-title">
                <StarIcon size={18} />
                {t("rating_count")}
              </p>
              <StarRating
                rating={
                  stats?.averageScore === 0
                    ? null
                    : (stats?.averageScore ?? null)
                }
                size={16}
              />
            </div>
          </div>
        </SidebarSection>
      )}

      {shop === "launchbox" && (
        <LaunchboxDetailsSection
          platform={shopDetails?.platform}
          genres={shopDetails?.genres?.map((g) => g.name)}
          skus={shopDetails?.skus}
        />
      )}

      <HowLongToBeatSection
        howLongToBeatData={howLongToBeat.data}
        isLoading={howLongToBeat.isLoading}
      />

      {shop !== "custom" && <ControllerSupportSection />}

      <GameModesSection />

      {shop !== "launchbox" && shop !== "custom" && (
        <SidebarSection title={t("requirements")}>
          <div className="requirement__button-container">
            <Button
              className="requirement__button"
              onClick={() => setActiveRequirement("minimum")}
              theme={activeRequirement === "minimum" ? "primary" : "outline"}
            >
              {t("minimum")}
            </Button>

            <Button
              className="requirement__button"
              onClick={() => setActiveRequirement("recommended")}
              theme={
                activeRequirement === "recommended" ? "primary" : "outline"
              }
            >
              {t("recommended")}
            </Button>
          </div>

          <div
            className="requirement__details"
            dangerouslySetInnerHTML={{
              __html:
                requirementHtml ||
                t(`no_${activeRequirement}_requirements`, {
                  gameTitle,
                }),
            }}
          />
        </SidebarSection>
      )}

      {shop !== "custom" && <GameLanguageSection />}
    </aside>
  );
}
