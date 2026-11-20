import { logger } from "@main/services/logger";

export interface SteamReviewAuthor {
  steamid: string;
  num_games_owned?: number;
  num_reviews?: number;
  playtime_forever?: number;
  playtime_at_review?: number;
}

export interface RawSteamReview {
  recommendationid: string;
  author: SteamReviewAuthor;
  language: string;
  review: string;
  timestamp_created: number;
  voted_up: boolean;
  votes_up: number;
  votes_funny: number;
  weighted_vote_score?: number;
}

export interface SteamAppReviewsSummary {
  appId: string;
  reviewScoreDesc: string;
  totalPositive: number;
  totalNegative: number;
  totalReviews: number;
  positivePercent: number;
  reviews: Array<{
    id: string;
    authorSteamId: string;
    reviewText: string;
    votedUp: boolean;
    votesUp: number;
    playtimeHours: number;
    createdAt: number;
  }>;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<
  string,
  { timestamp: number; data: SteamAppReviewsSummary }
>();

export class SteamReviewsService {
  public static async getReviews(
    appId: string,
    language = "brazilian"
  ): Promise<SteamAppReviewsSummary | null> {
    const cleanAppId = appId.trim();
    if (!cleanAppId || !/^\d+$/.test(cleanAppId)) return null;

    const cacheKey = `${cleanAppId}:${language}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const url = `https://store.steampowered.com/appreviews/${cleanAppId}?json=1&language=${encodeURIComponent(
        language
      )}&filter=all&num_per_page=10`;

      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });

      if (!res.ok) {
        logger.warn(
          `[SteamReviews] Failed to fetch reviews for app ${cleanAppId}: HTTP ${res.status}`
        );
        return null;
      }

      const json = (await res.json()) as {
        success?: number;
        query_summary?: {
          review_score_desc?: string;
          total_positive?: number;
          total_negative?: number;
          total_reviews?: number;
        };
        reviews?: RawSteamReview[];
      };

      if (!json || json.success !== 1) {
        return null;
      }

      const summary = json.query_summary;
      const totalPos = summary?.total_positive ?? 0;
      const totalNeg = summary?.total_negative ?? 0;
      const totalReviews = summary?.total_reviews ?? totalPos + totalNeg;
      const positivePercent =
        totalReviews > 0 ? Math.round((totalPos / totalReviews) * 100) : 0;

      const reviewsList = (json.reviews || []).slice(0, 10).map((r) => ({
        id: r.recommendationid,
        authorSteamId: r.author.steamid,
        reviewText: r.review?.trim() || "",
        votedUp: Boolean(r.voted_up),
        votesUp: r.votes_up ?? 0,
        playtimeHours:
          Math.round(((r.author.playtime_forever ?? 0) / 60) * 10) / 10,
        createdAt: r.timestamp_created * 1000,
      }));

      const result: SteamAppReviewsSummary = {
        appId: cleanAppId,
        reviewScoreDesc: summary?.review_score_desc || "Análises de usuários",
        totalPositive: totalPos,
        totalNegative: totalNeg,
        totalReviews,
        positivePercent,
        reviews: reviewsList,
      };

      cache.set(cacheKey, { timestamp: Date.now(), data: result });
      return result;
    } catch (err) {
      logger.error(
        `[SteamReviews] Error fetching reviews for app ${cleanAppId}`,
        err
      );
      return null;
    }
  }
}
