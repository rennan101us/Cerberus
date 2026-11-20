import { net } from "electron";
import type {
  CrossOverGraphicsBackend,
  CrossOverSyncMode,
  MacCompatibilityChipsetSummary,
  MacCompatibilityComment,
  MacCompatibilityRating,
  MacCompatibilityReport,
} from "@types";
import { gamesSublevel, macCompatibilityCacheSublevel } from "@main/level";
import { logger } from "../logger";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FETCH_TIMEOUT_MS = 12_000;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

interface MacGamingDbSearchItem {
  ref: string;
  source: string;
  name: string;
  slug: string;
  releaseYear?: number | null;
}

const normalizeTitle = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[™®©:!?'".,\-_/()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toWikiSlug = (title: string): string => title.trim().replace(/\s+/g, "_");

const fetchTextWithTimeout = async (
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) return null;
    const text = await response.text();
    if (
      text.includes("Just a moment...") &&
      text.includes("challenges.cloudflare.com")
    ) {
      return null;
    }
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const fetchJsonWithTimeout = async <T>(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<T | null> => {
  const text = await fetchTextWithTimeout(url, timeoutMs);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

const parseRatingLabel = (raw?: string | null): MacCompatibilityRating => {
  if (!raw) return "UNKNOWN";
  const upper = raw.toUpperCase().replace(/\s+/g, "_");
  if (
    upper.includes("PERFECT") ||
    upper.includes("PLATINUM") ||
    upper.includes("EXCELLENT")
  ) {
    return "PERFECT";
  }
  if (upper.includes("VERY_GOOD") || upper.includes("GOLD")) {
    return "VERY_GOOD";
  }
  if (upper.includes("GOOD") || upper.includes("SILVER")) {
    return "GOOD";
  }
  if (upper.includes("PLAYABLE") || upper.includes("BRONZE")) {
    return "PLAYABLE";
  }
  if (
    upper.includes("UNPLAYABLE") ||
    upper.includes("GARBAGE") ||
    upper.includes("BROKEN") ||
    upper.includes("DOES_NOT_RUN")
  ) {
    return "UNPLAYABLE";
  }
  return "UNKNOWN";
};

const extractRscStream = (html: string): string => {
  const chunks: string[] = [];
  const regex = /\.rsc\.push\(("[\s\S]*?")\)\s*<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (typeof parsed === "string") {
        chunks.push(parsed);
      }
    } catch {
      // Ignore malformed chunk
    }
  }
  return chunks.join("");
};

const parseRscLines = (rsc: string): Map<string, string> => {
  const map = new Map<string, string>();
  const lines = rsc.split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0 || colonIdx > 8) continue;
    const key = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1);
    map.set(key, val);
  }
  return map;
};

const resolveRscTextValue = (
  val: string,
  lineMap: Map<string, string>
): string => {
  if (val.startsWith("$") && val.length <= 10) {
    const refKey = val.replace(/^\$L?/, "");
    const target = lineMap.get(refKey);
    if (target) {
      const tMatch = target.match(/^T[0-9a-f]+,([\s\S]*)$/);
      if (tMatch) return tMatch[1];
      return target;
    }
  }
  return val;
};

export class CrossOverCompatibilityService {
  private static syncInFlight = false;

  private static getCacheKey(
    title: string,
    steamAppId?: string | null
  ): string {
    if (steamAppId) return `steam:${steamAppId}`;
    return `title:${normalizeTitle(title)}`;
  }

  private static async fetchMacGamingDbData(
    gameTitle: string,
    steamAppId?: string | null
  ): Promise<{
    found: boolean;
    url: string;
    rating: MacCompatibilityRating;
    summaryText: string | null;
    medianFps: number | null;
    crossoverReportCount: number;
    totalReportCount: number;
    latestCrossoverVersion: string | null;
    chipsets: MacCompatibilityChipsetSummary[];
    comments: MacCompatibilityComment[];
  }> {
    const searchUrl = `https://macgamingdb.app/?playMethod=CROSSOVER&search=${encodeURIComponent(gameTitle)}`;
    const fallback = {
      found: false,
      url: searchUrl,
      rating: "UNKNOWN" as MacCompatibilityRating,
      summaryText: null,
      medianFps: null,
      crossoverReportCount: 0,
      totalReportCount: 0,
      latestCrossoverVersion: null,
      chipsets: [] as MacCompatibilityChipsetSummary[],
      comments: [] as MacCompatibilityComment[],
    };

    try {
      const inputPayload = JSON.stringify({
        "0": { json: { query: gameTitle } },
      });
      const trpcUrl = `https://macgamingdb.app/api/trpc/game.search?batch=1&input=${encodeURIComponent(inputPayload)}`;
      const searchRes =
        await fetchJsonWithTimeout<
          Array<{ result?: { data?: { json?: MacGamingDbSearchItem[] } } }>
        >(trpcUrl);

      const items = searchRes?.[0]?.result?.data?.json ?? [];
      if (!items.length) return fallback;

      const normalizedTarget = normalizeTitle(gameTitle);
      const matched =
        (steamAppId
          ? items.find(
              (item) =>
                item.source === "steam" && item.ref === String(steamAppId)
            )
          : undefined) ??
        items.find((item) => normalizeTitle(item.name) === normalizedTarget) ??
        items.find(
          (item) =>
            normalizeTitle(item.name).includes(normalizedTarget) ||
            normalizedTarget.includes(normalizeTitle(item.name))
        );

      if (!matched?.slug) return fallback;

      const gameUrl = `https://macgamingdb.app/games/${matched.slug}`;
      const html = await fetchTextWithTimeout(gameUrl);
      if (!html) {
        return {
          ...fallback,
          found: true,
          url: gameUrl,
        };
      }

      const rsc = extractRscStream(html);
      const lineMap = parseRscLines(rsc);

      // Parse overall CrossOver median FPS & summary text
      let summaryText: string | null = null;
      let medianFps: number | null = null;
      let crossoverReportCount = 0;
      let totalReportCount = 0;
      let rating: MacCompatibilityRating = "UNKNOWN";

      const crossoverSummaryMatch = rsc.match(
        /(\w+(?:\s+\w+)?)\s+through\s+CrossOver\s+at\s+a\s+median\s+(\d+)\s*fps\s*\((\d+)\s+reports?\)/i
      );
      if (crossoverSummaryMatch) {
        const qualityWord = crossoverSummaryMatch[1];
        medianFps = Number(crossoverSummaryMatch[2]);
        crossoverReportCount = Number(crossoverSummaryMatch[3]);
        rating = parseRatingLabel(qualityWord);
        summaryText = `Red Wine: roda ${qualityWord.toLowerCase()} com mediana de ${medianFps} FPS (${crossoverReportCount} relatos no Apple Silicon).`;
      }

      const totalReportsMatch = rsc.match(/"(\d+)\s+reports?"/i);
      if (totalReportsMatch) {
        totalReportCount = Number(totalReportsMatch[1]);
      }

      // Extract CrossOver specific report cards from RSC lines
      const comments: MacCompatibilityComment[] = [];
      const chipsetCounts = new Map<
        string,
        { reports: number; fpsSamples: number[] }
      >();
      let latestCrossoverVersion: string | null = null;

      for (const [, lineVal] of lineMap.entries()) {
        if (
          !lineVal.includes('"data-slot":"card"') ||
          !lineVal.includes('"CrossOver"')
        ) {
          continue;
        }

        const versionMatch = lineVal.match(/"children":\["v","([^"]+)"\]/);
        const crossoverVersion = versionMatch ? `v${versionMatch[1]}` : null;
        if (crossoverVersion && !latestCrossoverVersion) {
          latestCrossoverVersion = crossoverVersion;
        }

        // Resolve chipset from referenced picture chunk ($xx)
        let chipset: string | null = null;
        const picRefs = [...lineVal.matchAll(/"children":"\$(\w+)"/g)].map(
          (m) => m[1]
        );
        for (const ref of picRefs) {
          const refLine = lineMap.get(ref);
          if (refLine && refLine.includes("/images/chipsets/")) {
            const altMatch = refLine.match(/"alt":"([^"]+)"/);
            if (altMatch) {
              chipset = altMatch[1];
              break;
            }
          }
        }

        // Extract FPS from card badges or text
        const fpsMatch =
          lineVal.match(/"children":\["?(\d+)\s*FPS"?\]/i) ??
          lineVal.match(/(\d+)\s*FPS/i);
        const fpsNum = fpsMatch ? Number(fpsMatch[1]) : null;

        // Extract performance rating badge text
        const ratingBadgeMatch = lineVal.match(
          /"children":"(Perfect|Very Good|Good|Playable|Unplayable|Runs Great|Excellent)"/i
        );
        const cardRating = ratingBadgeMatch
          ? parseRatingLabel(ratingBadgeMatch[1])
          : rating;

        // Extract graphics backend mention
        let graphicsBackend: string | null = null;
        if (/D3DMetal/i.test(lineVal)) graphicsBackend = "D3DMetal";
        else if (/DXMT/i.test(lineVal)) graphicsBackend = "DXMT";
        else if (/DXVK/i.test(lineVal)) graphicsBackend = "DXVK";

        // Resolve linked Review Note block ($Lxx)
        let noteText = "";
        const lazyRefs = [...lineVal.matchAll(/"\$L(\w+)"/g)].map((m) => m[1]);
        for (const ref of lazyRefs) {
          const refLine = lineMap.get(ref);
          if (refLine && refLine.includes('"notes":')) {
            const notesMatch = refLine.match(/"notes":"((?:\\.|[^"\\])*)"/);
            if (notesMatch) {
              try {
                const decoded = JSON.parse(`"${notesMatch[1]}"`) as string;
                noteText = resolveRscTextValue(decoded, lineMap).trim();
              } catch {
                noteText = notesMatch[1];
              }
            }
          }
        }

        // Track chipset counts
        if (chipset) {
          const existing = chipsetCounts.get(chipset) ?? {
            reports: 0,
            fpsSamples: [],
          };
          existing.reports += 1;
          if (fpsNum) existing.fpsSamples.push(fpsNum);
          chipsetCounts.set(chipset, existing);
        }

        // Only add meaningful comments or structured CrossOver reports
        if (noteText || chipset || crossoverVersion) {
          const idMatch =
            lineVal.match(/"reviewId":"([^"]+)"/) ??
            lineVal.match(/^\["\$","div","([^",]+)/);
          const commentId =
            idMatch?.[1] ??
            `mgdb-${comments.length}-${crossoverVersion ?? "cx"}`;

          comments.push({
            id: commentId,
            source: "macgamingdb",
            chipset,
            crossoverVersion,
            rating: cardRating !== "UNKNOWN" ? cardRating : null,
            fps: fpsNum ? `${fpsNum} FPS` : null,
            graphicsBackend,
            text:
              noteText ||
              `Relatório verificado no Apple Silicon${chipset ? ` (${chipset})` : ""}${crossoverVersion ? ` com Red Wine ${crossoverVersion}` : ""}${fpsNum ? ` atingindo ~${fpsNum} FPS` : ""}.`,
            url: gameUrl,
          });
        }
      }

      if (crossoverReportCount === 0 && comments.length > 0) {
        crossoverReportCount = comments.length;
      }

      if (rating === "UNKNOWN" && comments.length > 0) {
        const firstRated = comments.find((c) => c.rating);
        if (firstRated?.rating) {
          rating = parseRatingLabel(String(firstRated.rating));
        } else if (medianFps && medianFps >= 55) {
          rating = "VERY_GOOD";
        } else if (medianFps && medianFps >= 30) {
          rating = "PLAYABLE";
        }
      }

      const chipsets: MacCompatibilityChipsetSummary[] = Array.from(
        chipsetCounts.entries()
      )
        .map(([chipset, info]) => {
          const sortedFps = [...info.fpsSamples].sort((a, b) => a - b);
          const med = sortedFps.length
            ? sortedFps[Math.floor(sortedFps.length / 2)]
            : null;
          return {
            chipset,
            reports: info.reports,
            medianFps: med,
          };
        })
        .sort((a, b) => b.reports - a.reports)
        .slice(0, 6);

      return {
        found: true,
        url: gameUrl,
        rating,
        summaryText,
        medianFps,
        crossoverReportCount,
        totalReportCount: Math.max(totalReportCount, crossoverReportCount),
        latestCrossoverVersion,
        chipsets,
        comments: comments.slice(0, 15),
      };
    } catch (error) {
      logger.warn(
        `[CrossOverCompatibility] MacGamingDB lookup failed for '${gameTitle}'`,
        error
      );
      return fallback;
    }
  }

  private static async fetchCodeWeaversData(gameTitle: string): Promise<{
    found: boolean;
    url: string;
    ratingLabel: string | null;
    rating: MacCompatibilityRating;
  }> {
    const searchUrl = `https://www.codeweavers.com/compatibility?name=${encodeURIComponent(gameTitle)}`;
    try {
      const html = await fetchTextWithTimeout(searchUrl, 8_000);
      if (!html) {
        return {
          found: false,
          url: searchUrl,
          ratingLabel: null,
          rating: "UNKNOWN",
        };
      }

      const normalizedTarget = normalizeTitle(gameTitle);
      const linkRegex =
        /<a\s+href="(\/compatibility\/crossover\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
      let match: RegExpExecArray | null;
      let bestUrl: string | null = null;

      while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        const text = match[2].trim();
        const normText = normalizeTitle(text);
        if (normText === normalizedTarget) {
          bestUrl = `https://www.codeweavers.com${href}`;
          break;
        }
        if (
          !bestUrl &&
          (normText.includes(normalizedTarget) ||
            normalizedTarget.includes(normText))
        ) {
          bestUrl = `https://www.codeweavers.com${href}`;
        }
      }

      if (!bestUrl) {
        return {
          found: false,
          url: searchUrl,
          ratingLabel: null,
          rating: "UNKNOWN",
        };
      }

      // Try to extract star rating from row surrounding the link in search table
      const slugPart = bestUrl.replace("https://www.codeweavers.com", "");
      const rowIdx = html.indexOf(slugPart);
      let ratingLabel: string | null = null;
      let rating: MacCompatibilityRating = "UNKNOWN";

      if (rowIdx !== -1) {
        const snippet = html.slice(rowIdx, rowIdx + 600);
        const starsMatch = snippet.match(/(\d)\s*(?:out of 5|stars?)/i);
        const medalMatch = snippet.match(
          /\b(Platinum|Gold|Silver|Bronze|Garbage)\b/i
        );
        if (medalMatch) {
          ratingLabel = medalMatch[1];
          rating = parseRatingLabel(medalMatch[1]);
        } else if (starsMatch) {
          const stars = Number(starsMatch[1]);
          ratingLabel = `${stars}/5 Estrelas`;
          if (stars >= 5) rating = "PERFECT";
          else if (stars === 4) rating = "VERY_GOOD";
          else if (stars === 3) rating = "GOOD";
          else if (stars === 2) rating = "PLAYABLE";
          else rating = "UNPLAYABLE";
        }
      }

      return {
        found: true,
        url: bestUrl,
        ratingLabel,
        rating,
      };
    } catch {
      return {
        found: false,
        url: searchUrl,
        ratingLabel: null,
        rating: "UNKNOWN",
      };
    }
  }

  private static async fetchAppleGamingWikiData(gameTitle: string): Promise<{
    found: boolean;
    url: string;
    ratingLabel: string | null;
    rating: MacCompatibilityRating;
    comment: MacCompatibilityComment | null;
  }> {
    const wikiSlug = toWikiSlug(gameTitle);
    const wikiUrl = `https://www.applegamingwiki.com/wiki/${encodeURIComponent(wikiSlug)}`;
    const apiUrl = `https://www.applegamingwiki.com/w/api.php?action=query&titles=${encodeURIComponent(wikiSlug)}&prop=revisions&rvslots=main&rvprop=content&format=json`;

    try {
      const res = await fetchJsonWithTimeout<{
        query?: {
          pages?: Record<
            string,
            {
              missing?: string;
              revisions?: Array<{ slots?: { main?: { "*"?: string } } }>;
            }
          >;
        };
      }>(apiUrl, 8_000);

      const pages = res?.query?.pages;
      if (!pages) {
        return {
          found: false,
          url: wikiUrl,
          ratingLabel: null,
          rating: "UNKNOWN",
          comment: null,
        };
      }

      const firstPage = Object.values(pages)[0];
      if (!firstPage || "missing" in firstPage) {
        return {
          found: false,
          url: wikiUrl,
          ratingLabel: null,
          rating: "UNKNOWN",
          comment: null,
        };
      }

      const wikitext = firstPage.revisions?.[0]?.slots?.main?.["*"] ?? "";
      const cxMatch = wikitext.match(/\|\s*crossover\s*=\s*([a-zA-Z0-9\s]+)/i);
      const cxNotesMatch = wikitext.match(
        /\|\s*crossover\s+notes\s*=\s*([^\n|}]+)/i
      );

      const ratingLabel = cxMatch?.[1]?.trim() ?? null;
      const rating = parseRatingLabel(ratingLabel);
      const cleanNotes = cxNotesMatch?.[1]
        ?.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
        ?.replace(/''+/g, "")
        ?.trim();

      return {
        found: true,
        url: wikiUrl,
        ratingLabel,
        rating,
        comment: cleanNotes
          ? {
              id: `agw-${wikiSlug}`,
              source: "applegamingwiki",
              rating: rating !== "UNKNOWN" ? rating : null,
              text: cleanNotes,
              url: wikiUrl,
            }
          : null,
      };
    } catch {
      return {
        found: false,
        url: wikiUrl,
        ratingLabel: null,
        rating: "UNKNOWN",
        comment: null,
      };
    }
  }

  private static inferRecommendedSettings(
    comments: MacCompatibilityComment[]
  ): MacCompatibilityReport["recommendedSettings"] {
    const joinedText = comments
      .map((c) => c.text)
      .join(" ")
      .toLowerCase();

    let graphicsBackend: CrossOverGraphicsBackend = "d3dmetal";
    const syncMode: CrossOverSyncMode = "msync";
    let rosettaAvx = true;
    const notes: string[] = [];

    const dxmtMentions = (joinedText.match(/\bdxmt\b/g) ?? []).length;
    const d3dMentions = (joinedText.match(/\bd3dmetal\b|\bgptk\b/g) ?? [])
      .length;
    const dxvkMentions = (joinedText.match(/\bdxvk\b/g) ?? []).length;

    if (dxmtMentions > d3dMentions && dxmtMentions > 0) {
      graphicsBackend = "dxmt";
      notes.push(
        "DXMT recomendado pelos relatos da comunidade para melhor estabilidade em DirectX 11."
      );
    } else if (dxvkMentions > d3dMentions && dxvkMentions > 1) {
      graphicsBackend = "dxvk";
      notes.push("DXVK reportado como mais estável para este título.");
    } else {
      graphicsBackend = "d3dmetal";
      notes.push(
        "D3DMetal (Apple Game Porting Toolkit) + MSync recomendados para máxima compatibilidade DirectX 11/12."
      );
    }

    if (joinedText.includes("metalfx") || joinedText.includes("dlss")) {
      notes.push(
        "Ative MetalFX, FSR ou DLSS (Quality) nas opções gráficas para estabilizar a taxa de quadros."
      );
    }
    if (joinedText.includes("frame gen")) {
      notes.push(
        "Se houver stutter com Frame Generation, prefira limitar o FPS internamente no jogo."
      );
    }
    if (joinedText.includes("avx")) {
      rosettaAvx = true;
      notes.push("Extensão Rosetta AVX recomendada para execução estável.");
    }

    return {
      graphicsBackend,
      syncMode,
      rosettaAvx,
      notes,
    };
  }

  public static async getCompatibilityReport(options: {
    gameTitle: string;
    steamAppId?: string | null;
    forceRefresh?: boolean;
  }): Promise<MacCompatibilityReport> {
    const { gameTitle, steamAppId, forceRefresh = false } = options;
    const cacheKey = this.getCacheKey(gameTitle, steamAppId);

    if (!forceRefresh) {
      const cached = await macCompatibilityCacheSublevel
        .get(cacheKey)
        .catch(() => null);
      if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
        return cached;
      }
    }

    const [mgdb, cw, agw] = await Promise.all([
      this.fetchMacGamingDbData(gameTitle, steamAppId),
      this.fetchCodeWeaversData(gameTitle),
      this.fetchAppleGamingWikiData(gameTitle),
    ]);

    const comments: MacCompatibilityComment[] = [...mgdb.comments];
    if (agw.comment) {
      comments.unshift(agw.comment);
    }

    const overallRating: MacCompatibilityRating =
      mgdb.rating !== "UNKNOWN"
        ? mgdb.rating
        : cw.rating !== "UNKNOWN"
          ? cw.rating
          : agw.rating;

    const report: MacCompatibilityReport = {
      gameTitle,
      steamAppId: steamAppId ?? null,
      overallRating,
      summaryText: mgdb.summaryText,
      medianFps: mgdb.medianFps,
      crossoverReportCount: mgdb.crossoverReportCount,
      totalReportCount: mgdb.totalReportCount,
      latestCrossoverVersion: mgdb.latestCrossoverVersion,
      chipsets: mgdb.chipsets,
      recommendedSettings: this.inferRecommendedSettings(comments),
      sources: {
        macgamingdb: {
          id: "macgamingdb",
          name: "MacGamingDB",
          url: mgdb.url,
          ratingLabel:
            mgdb.rating !== "UNKNOWN" ? mgdb.rating.replace("_", " ") : null,
          found: mgdb.found,
        },
        codeweavers: {
          id: "codeweavers",
          name: "Base Red Wine",
          url: cw.url,
          ratingLabel: cw.ratingLabel,
          found: cw.found,
        },
        applegamingwiki: {
          id: "applegamingwiki",
          name: "AppleGamingWiki",
          url: agw.url,
          ratingLabel: agw.ratingLabel,
          found: agw.found,
        },
      },
      comments,
      updatedAt: Date.now(),
    };

    await macCompatibilityCacheSublevel.put(cacheKey, report).catch((err) => {
      logger.warn("[CrossOverCompatibility] Failed to save cache entry", err);
    });

    return report;
  }

  /**
   * Periodically refreshes stale macOS compatibility reports for library games in background.
   */
  public static async syncLibraryCompatibility(maxPerRun = 5): Promise<void> {
    if (process.platform !== "darwin" || this.syncInFlight) return;
    this.syncInFlight = true;

    try {
      const games = await gamesSublevel.values().all();
      let updated = 0;

      for (const game of games) {
        if (updated >= maxPerRun) break;
        if (game.isDeleted || !game.title) continue;

        const steamAppId = game.shop === "steam" ? game.objectId : null;
        const cacheKey = this.getCacheKey(game.title, steamAppId);
        const cached = await macCompatibilityCacheSublevel
          .get(cacheKey)
          .catch(() => null);

        if (!cached || Date.now() - cached.updatedAt >= CACHE_TTL_MS) {
          await this.getCompatibilityReport({
            gameTitle: game.title,
            steamAppId,
            forceRefresh: true,
          });
          updated += 1;
        }
      }

      if (updated > 0) {
        logger.info(
          `[CrossOverCompatibility] Background sync refreshed ${updated} game compatibility report(s).`
        );
      }
    } catch (error) {
      logger.warn("[CrossOverCompatibility] Background sync error", error);
    } finally {
      this.syncInFlight = false;
    }
  }
}
