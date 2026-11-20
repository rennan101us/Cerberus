import { registerEvent } from "../register-event";
import {
  SteamReviewsService,
  type SteamAppReviewsSummary,
} from "@main/services/steam-reviews-service";

registerEvent(
  "getSteamAppReviews",
  async (
    _event,
    appId: string,
    language?: string
  ): Promise<SteamAppReviewsSummary | null> => {
    return SteamReviewsService.getReviews(appId, language);
  }
);
