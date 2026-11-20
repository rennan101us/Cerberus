import crypto from "node:crypto";
import axios from "axios";
import type {
  IgdbSimilarGameSummary,
  SteamGenre,
  SteamMovie,
  SteamScreenshot,
  UserPreferences,
} from "@types";
import { db, levelKeys } from "@main/level";
import { logger } from "@main/services/logger";

export const IGDB_PLATFORM_IDS = {
  PC: 6,
  MAC: 14,
  SWITCH_1: 130,
  SWITCH_2: 508,
} as const;

// AES-256-GCM encrypted built-in IGDB credentials (never stored in plain text or exposed to renderer)
const ENCRYPTED_IGDB_CLIENT_ID =
  "a1b2c3d4e5f60718293a4b5c:f8088c8ee2040f0fa49476dede1e6a8e:34e21a0df395750f7d6ca89ab97ae4889d73b670875fbd5bc87c910dfa4d";
const ENCRYPTED_IGDB_CLIENT_SECRET =
  "f1e2d3c4b5a69788695a4b3c:53efbf5ea829360dd78ddc122b10219e:369382741805bca0865bb34fa910ab63beb7ac5ce9bd98e3a0a2fc87a2ad";

function decryptIgdbVaultValue(payload: string): string {
  try {
    const [ivHex, authTagHex, encryptedHex] = payload.split(":");
    if (!ivHex || !authTagHex || !encryptedHex) return "";
    const key = crypto.scryptSync(
      "cerberus-igdb-vault-v1",
      "cerberus-salt-2026",
      32
    );
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

const IGDB_TOKEN_KEY = "igdb:oauth:token";
const IGDB_GAME_CACHE_PREFIX = "igdb:game:v1:";
const GAME_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CachedOAuthToken {
  accessToken: string;
  expiresAt: number;
  clientId: string;
}

interface RawIgdbGame {
  id: number;
  name: string;
  summary?: string;
  storyline?: string;
  first_release_date?: number;
  aggregated_rating?: number;
  rating?: number;
  platforms?: number[];
  cover?: { id: number; image_id: string };
  artworks?: Array<{
    id: number;
    image_id: string;
    width?: number;
    height?: number;
  }>;
  screenshots?: Array<{
    id: number;
    image_id: string;
    width?: number;
    height?: number;
  }>;
  videos?: Array<{ id: number; name?: string; video_id: string }>;
  genres?: Array<{ id: number; name: string }>;
  involved_companies?: Array<{
    developer?: boolean;
    publisher?: boolean;
    company?: { id: number; name: string };
  }>;
  language_supports?: Array<{
    language?: { name: string };
    language_support_type?: { name: string };
  }>;
  similar_games?: Array<{
    id: number;
    name: string;
    cover?: { image_id: string };
    platforms?: number[];
  }>;
}

export interface IgdbEnrichedGameDetails {
  igdbId: number;
  name: string;
  summary: string;
  storyline: string;
  aboutHtml: string;
  releaseDate: string;
  developers: string[];
  publishers: string[];
  genres: SteamGenre[];
  coverUrl: string | null;
  heroUrl: string | null;
  screenshots: SteamScreenshot[];
  movies: SteamMovie[];
  supportedLanguages: string;
  rating: number | null;
  similarGames: IgdbSimilarGameSummary[];
}

interface CachedIgdbEntry {
  cachedAt: number;
  data: IgdbEnrichedGameDetails | null;
}

function igdbImageUrl(
  imageId: string | undefined | null,
  size: "t_cover_big_2x" | "t_1080p" | "t_screenshot_big" | "t_720p"
): string | null {
  if (!imageId) return null;
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}

function normalizeTitle(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/\b(nintendo switch 2 edition|switch 2 edition|definitive edition|deluxe edition|complete edition|mac|macos|arm64|universal)\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleSimilarityScore(query: string, candidate: string): number {
  const qNorm = normalizeTitle(query);
  const cNorm = normalizeTitle(candidate);
  if (!qNorm || !cNorm) return 0;
  if (qNorm === cNorm) return 100;
  if (cNorm.startsWith(qNorm) || qNorm.startsWith(cNorm)) {
    const ratio = Math.min(qNorm.length, cNorm.length) / Math.max(qNorm.length, cNorm.length);
    return Math.round(70 + ratio * 25);
  }
  const qWords = new Set(qNorm.split(/\s+/).filter(Boolean));
  const cWords = new Set(cNorm.split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const w of qWords) {
    if (cWords.has(w)) overlap++;
  }
  if (overlap === 0) return 0;
  const jaccard = overlap / new Set([...qWords, ...cWords]).size;
  const recall = overlap / qWords.size;
  return Math.round((jaccard * 0.55 + recall * 0.45) * 90);
}

function formatReleaseDate(unixSec?: number): string {
  if (!unixSec || !Number.isFinite(unixSec)) return "";
  try {
    const d = new Date(unixSec * 1000);
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSupportedLanguages(
  supports?: RawIgdbGame["language_supports"]
): string {
  if (!Array.isArray(supports) || supports.length === 0) return "";

  const langMap = new Map<string, { audio: boolean; text: boolean }>();
  for (const item of supports) {
    const langName = item.language?.name?.trim();
    if (!langName) continue;
    const typeName = (item.language_support_type?.name || "").toLowerCase();
    const cur = langMap.get(langName) || { audio: false, text: false };
    if (typeName.includes("audio")) cur.audio = true;
    else cur.text = true;
    langMap.set(langName, cur);
  }

  if (langMap.size === 0) return "";

  const parts: string[] = [];
  let hasAudio = false;
  for (const [name, flags] of langMap.entries()) {
    if (flags.audio) {
      hasAudio = true;
      parts.push(`${name}<strong>*</strong>`);
    } else {
      parts.push(name);
    }
  }
  return hasAudio
    ? `${parts.join(", ")}<br><strong>*</strong>idiomas com suporte completo de áudio`
    : parts.join(", ");
}

function pickBestHeroUrl(raw: RawIgdbGame): string | null {
  const artworks = raw.artworks ?? [];
  const landscapeArt = artworks.find(
    (a) => (a.width ?? 0) > (a.height ?? 0) && a.image_id
  );
  if (landscapeArt) return igdbImageUrl(landscapeArt.image_id, "t_1080p");

  const screenshots = raw.screenshots ?? [];
  const landscapeShot = screenshots.find(
    (s) => (s.width ?? 0) >= (s.height ?? 0) && s.image_id
  );
  if (landscapeShot) return igdbImageUrl(landscapeShot.image_id, "t_1080p");

  if (artworks[0]?.image_id) {
    return igdbImageUrl(artworks[0].image_id, "t_1080p");
  }
  if (screenshots[0]?.image_id) {
    return igdbImageUrl(screenshots[0].image_id, "t_1080p");
  }
  return igdbImageUrl(raw.cover?.image_id, "t_1080p");
}

function mapRawIgdbGame(raw: RawIgdbGame): IgdbEnrichedGameDetails {
  const developers = Array.from(
    new Set(
      (raw.involved_companies ?? [])
        .filter((ic) => ic.developer && ic.company?.name)
        .map((ic) => ic.company!.name)
    )
  );
  const publishers = Array.from(
    new Set(
      (raw.involved_companies ?? [])
        .filter((ic) => ic.publisher && ic.company?.name)
        .map((ic) => ic.company!.name)
    )
  );

  const genres: SteamGenre[] = (raw.genres ?? []).map((g) => ({
    id: String(g.id),
    name: g.name,
  }));

  const screenshots: SteamScreenshot[] = (raw.screenshots ?? [])
    .filter((s) => Boolean(s.image_id))
    .slice(0, 14)
    .map((s) => ({
      id: s.id,
      path_thumbnail: igdbImageUrl(s.image_id, "t_screenshot_big")!,
      path_full: igdbImageUrl(s.image_id, "t_1080p")!,
    }));

  const movies: SteamMovie[] = (raw.videos ?? [])
    .filter((v) => Boolean(v.video_id))
    .slice(0, 6)
    .map((v, idx) => ({
      id: v.id || idx + 1,
      youtube_id: v.video_id,
      thumbnail: `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`,
      name: v.name || `Trailer ${idx + 1}`,
      highlight: idx === 0,
    }));

  const summary = (raw.summary ?? "").trim();
  const storyline = (raw.storyline ?? "").trim();
  const paragraphs: string[] = [];
  if (summary) {
    paragraphs.push(`<p>${escapeHtml(summary).replace(/\n/g, "<br/>")}</p>`);
  }
  if (storyline && storyline !== summary) {
    paragraphs.push(
      `<h3>História</h3><p>${escapeHtml(storyline).replace(/\n/g, "<br/>")}</p>`
    );
  }

  const similarGames: IgdbSimilarGameSummary[] = (raw.similar_games ?? [])
    .filter((g) => Boolean(g.name))
    .slice(0, 12)
    .map((g) => ({
      id: g.id,
      name: g.name,
      coverUrl: igdbImageUrl(g.cover?.image_id, "t_cover_big_2x"),
    }));

  const ratingVal =
    typeof raw.aggregated_rating === "number"
      ? Math.round(raw.aggregated_rating)
      : typeof raw.rating === "number"
        ? Math.round(raw.rating)
        : null;

  return {
    igdbId: raw.id,
    name: raw.name,
    summary,
    storyline,
    aboutHtml: paragraphs.join(""),
    releaseDate: formatReleaseDate(raw.first_release_date),
    developers,
    publishers,
    genres,
    coverUrl: igdbImageUrl(raw.cover?.image_id, "t_cover_big_2x"),
    heroUrl: pickBestHeroUrl(raw),
    screenshots,
    movies,
    supportedLanguages: formatSupportedLanguages(raw.language_supports),
    rating: ratingVal,
    similarGames,
  };
}

export class IgdbService {
  private static memoryToken: CachedOAuthToken | null = null;
  private static memoryCache = new Map<string, CachedIgdbEntry>();
  private static pendingRequests = new Map<
    string,
    Promise<IgdbEnrichedGameDetails | null>
  >();
  private static lastRequestTime = 0;
  private static rateQueue: Promise<void> = Promise.resolve();

  public static async getCredentials(): Promise<{
    clientId: string;
    clientSecret: string;
    isCustom: boolean;
  }> {
    const prefs = (await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null)) as UserPreferences | null;

    const customId = prefs?.igdbClientId?.trim() || "";
    const customSecret = prefs?.igdbClientSecret?.trim() || "";

    if (customId && customSecret) {
      return { clientId: customId, clientSecret: customSecret, isCustom: true };
    }

    const envId = process.env.IGDB_CLIENT_ID?.trim() || "";
    const envSecret = process.env.IGDB_CLIENT_SECRET?.trim() || "";
    if (envId && envSecret) {
      return { clientId: envId, clientSecret: envSecret, isCustom: false };
    }

    return {
      clientId: decryptIgdbVaultValue(ENCRYPTED_IGDB_CLIENT_ID),
      clientSecret: decryptIgdbVaultValue(ENCRYPTED_IGDB_CLIENT_SECRET),
      isCustom: false,
    };
  }

  public static async saveCredentials(
    clientId: string,
    clientSecret: string
  ): Promise<void> {
    const prefs =
      ((await db
        .get<string, UserPreferences | null>(levelKeys.userPreferences, {
          valueEncoding: "json",
        })
        .catch(() => null)) as UserPreferences | null) ?? {};

    await db.put(
      levelKeys.userPreferences,
      {
        ...prefs,
        igdbClientId: clientId.trim() || null,
        igdbClientSecret: clientSecret.trim() || null,
      },
      { valueEncoding: "json" }
    );
    this.memoryToken = null;
    await db.del(IGDB_TOKEN_KEY).catch(() => {});
  }

  private static async enqueueRateLimit(): Promise<void> {
    const next = this.rateQueue.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, 270 - (now - this.lastRequestTime));
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      }
      this.lastRequestTime = Date.now();
    });
    this.rateQueue = next.catch(() => {});
    return next;
  }

  private static async getAccessToken(forceRefresh = false): Promise<{
    clientId: string;
    accessToken: string;
  } | null> {
    const { clientId, clientSecret } = await this.getCredentials();
    if (!clientId || !clientSecret) return null;

    const now = Date.now();
    const safetyWindowMs = 5 * 60 * 1000;

    if (
      !forceRefresh &&
      this.memoryToken &&
      this.memoryToken.clientId === clientId &&
      this.memoryToken.expiresAt - safetyWindowMs > now
    ) {
      return {
        clientId,
        accessToken: this.memoryToken.accessToken,
      };
    }

    if (!forceRefresh) {
      const persisted = (await db
        .get<string, CachedOAuthToken | null>(IGDB_TOKEN_KEY, {
          valueEncoding: "json",
        })
        .catch(() => null)) as CachedOAuthToken | null;
      if (
        persisted &&
        persisted.clientId === clientId &&
        persisted.expiresAt - safetyWindowMs > now
      ) {
        this.memoryToken = persisted;
        return { clientId, accessToken: persisted.accessToken };
      }
    }

    try {
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      });
      const res = await axios.post<{
        access_token: string;
        expires_in: number;
      }>("https://id.twitch.tv/oauth2/token", params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 12000,
      });

      const tokenObj: CachedOAuthToken = {
        accessToken: res.data.access_token,
        expiresAt: now + (res.data.expires_in || 3600) * 1000,
        clientId,
      };
      this.memoryToken = tokenObj;
      await db
        .put(IGDB_TOKEN_KEY, tokenObj, { valueEncoding: "json" })
        .catch(() => {});

      return { clientId, accessToken: tokenObj.accessToken };
    } catch (err) {
      logger.warn("[IGDB] Failed to acquire Twitch OAuth2 token:", err);
      return null;
    }
  }

  private static async postIgdb<T>(
    endpoint: string,
    apicalypseQuery: string
  ): Promise<T | null> {
    const auth = await this.getAccessToken(false);
    if (!auth) return null;

    await this.enqueueRateLimit();

    const execute = async (token: string) => {
      const res = await axios.post<T>(
        `https://api.igdb.com/v4/${endpoint}`,
        apicalypseQuery,
        {
          headers: {
            "Client-ID": auth.clientId,
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "text/plain",
          },
          timeout: 12000,
        }
      );
      return res.data;
    };

    try {
      return await execute(auth.accessToken);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (status === 401) {
        const refreshed = await this.getAccessToken(true);
        if (refreshed) {
          try {
            return await execute(refreshed.accessToken);
          } catch (retryErr) {
            logger.warn(`[IGDB] Retry failed for ${endpoint}:`, retryErr);
            return null;
          }
        }
      }
      logger.warn(`[IGDB] Request failed for ${endpoint}:`, err);
      return null;
    }
  }

  public static async testConnection(): Promise<{
    ok: boolean;
    message: string;
    clientIdMasked: string;
  }> {
    const { clientId } = await this.getCredentials();
    const masked =
      clientId.length > 8
        ? `${clientId.slice(0, 4)}••••${clientId.slice(-4)}`
        : clientId;
    const auth = await this.getAccessToken(true);
    if (!auth) {
      return {
        ok: false,
        message: "Falha ao autenticar na Twitch OAuth2. Verifique Client ID e Secret.",
        clientIdMasked: masked,
      };
    }

    const res = await this.postIgdb<Array<{ id: number; name: string }>>(
      "platforms",
      "fields id,name; where id = (130, 508, 14); limit 5;"
    );
    if (!res || res.length === 0) {
      return {
        ok: false,
        message: "Token obtido, mas a consulta à API IGDB v4 falhou.",
        clientIdMasked: masked,
      };
    }
    return {
      ok: true,
      message: `Conectado à API IGDB v4 (${res.map((p) => p.name).join(", ")})`,
      clientIdMasked: masked,
    };
  }

  public static async clearCache(): Promise<void> {
    this.memoryCache.clear();
    try {
      for await (const key of db.keys({
        gte: IGDB_GAME_CACHE_PREFIX,
        lte: `${IGDB_GAME_CACHE_PREFIX}\xff`,
      })) {
        await db.del(key).catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  public static async fetchGameDetailsByTitle(
    title: string,
    targetHint: "switch1" | "switch2" | "mac_native" | "any" = "any"
  ): Promise<IgdbEnrichedGameDetails | null> {
    const cleanQuery = title
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s*\[[^\]]*\]\s*/g, " ")
      .replace(/\s+v?\d+(?:\.\d+)+\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleanQuery || cleanQuery.length < 2) return null;

    const cacheKey = `${targetHint}:${normalizeTitle(cleanQuery)}`;
    const now = Date.now();

    const mem = this.memoryCache.get(cacheKey);
    if (mem) {
      const ttl = mem.data ? GAME_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
      if (now - mem.cachedAt < ttl) return mem.data;
    }

    const persisted = (await db
      .get<string, CachedIgdbEntry | null>(
        `${IGDB_GAME_CACHE_PREFIX}${cacheKey}`,
        { valueEncoding: "json" }
      )
      .catch(() => null)) as CachedIgdbEntry | null;

    if (persisted) {
      const ttl = persisted.data ? GAME_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
      if (now - persisted.cachedAt < ttl) {
        this.memoryCache.set(cacheKey, persisted);
        return persisted.data;
      }
    }

    const inflight = this.pendingRequests.get(cacheKey);
    if (inflight) return inflight;

    const promise = (async (): Promise<IgdbEnrichedGameDetails | null> => {
      try {
        const escaped = cleanQuery.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const fields = [
          "id",
          "name",
          "summary",
          "storyline",
          "first_release_date",
          "aggregated_rating",
          "rating",
          "platforms",
          "cover.image_id",
          "artworks.image_id",
          "artworks.width",
          "artworks.height",
          "screenshots.image_id",
          "screenshots.width",
          "screenshots.height",
          "videos.name",
          "videos.video_id",
          "genres.name",
          "involved_companies.developer",
          "involved_companies.publisher",
          "involved_companies.company.name",
          "language_supports.language.name",
          "language_supports.language_support_type.name",
          "similar_games.name",
          "similar_games.cover.image_id",
          "similar_games.platforms",
        ].join(",");

        let preferredPlatforms: number[] = [];
        if (targetHint === "switch2") {
          preferredPlatforms = [IGDB_PLATFORM_IDS.SWITCH_2, IGDB_PLATFORM_IDS.SWITCH_1];
        } else if (targetHint === "switch1") {
          preferredPlatforms = [IGDB_PLATFORM_IDS.SWITCH_1, IGDB_PLATFORM_IDS.SWITCH_2];
        } else if (targetHint === "mac_native") {
          preferredPlatforms = [IGDB_PLATFORM_IDS.MAC, IGDB_PLATFORM_IDS.PC];
        }

        // First try searching with platform filter for higher accuracy
        let candidates: RawIgdbGame[] = [];
        if (preferredPlatforms.length > 0) {
          const filteredQuery = `search "${escaped}"; fields ${fields}; where platforms = (${preferredPlatforms.join(",")}); limit 10;`;
          candidates =
            (await this.postIgdb<RawIgdbGame[]>("games", filteredQuery)) ?? [];
        }

        // Fallback to unfiltered search if platform-filtered returned empty
        if (candidates.length === 0) {
          const broadQuery = `search "${escaped}"; fields ${fields}; limit 10;`;
          candidates =
            (await this.postIgdb<RawIgdbGame[]>("games", broadQuery)) ?? [];
        }

        if (candidates.length === 0) {
          const entry: CachedIgdbEntry = { cachedAt: Date.now(), data: null };
          this.memoryCache.set(cacheKey, entry);
          await db
            .put(`${IGDB_GAME_CACHE_PREFIX}${cacheKey}`, entry, {
              valueEncoding: "json",
            })
            .catch(() => {});
          return null;
        }

        const primaryPlatformId = preferredPlatforms[0];
        let best: RawIgdbGame | null = null;
        let bestScore = -1;

        for (const cand of candidates) {
          let score = titleSimilarityScore(cleanQuery, cand.name);
          if (score < 48) continue;

          if (
            primaryPlatformId &&
            Array.isArray(cand.platforms) &&
            cand.platforms.includes(primaryPlatformId)
          ) {
            score += 18;
          } else if (
            preferredPlatforms.some((pid) => cand.platforms?.includes(pid))
          ) {
            score += 10;
          }

          if (cand.cover?.image_id) score += 5;
          if ((cand.artworks?.length ?? 0) > 0) score += 4;
          if ((cand.videos?.length ?? 0) > 0) score += 3;
          if ((cand.screenshots?.length ?? 0) > 0) score += 3;

          if (score > bestScore) {
            bestScore = score;
            best = cand;
          }
        }

        const mapped = best ? mapRawIgdbGame(best) : null;
        const entry: CachedIgdbEntry = { cachedAt: Date.now(), data: mapped };
        this.memoryCache.set(cacheKey, entry);
        await db
          .put(`${IGDB_GAME_CACHE_PREFIX}${cacheKey}`, entry, {
            valueEncoding: "json",
          })
          .catch(() => {});
        return mapped;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    })();

    this.pendingRequests.set(cacheKey, promise);
    return promise;
  }
}
