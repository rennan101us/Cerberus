import axios from "axios";
import parseTorrent, { toMagnetURI } from "parse-torrent";
import type { MacNativeCatalogueItem, MacNativeDownloadOption } from "@types";
import { Downloader } from "@shared";
import {
  db,
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { DownloadManager } from "@main/services/download";
import {
  MailRuApi,
  MediafireApi,
  MediafireChallengeError,
} from "@main/services/hosters";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";
import { logger } from "@main/services/logger";
import {
  buildMacNativeObjectId,
  parseAppstorrentDetailHtml,
  parseAppstorrentListingHtml,
  parseTorrentMacDetailHtml,
  parseTorrentMacListingHtml,
  type ParsedMacNativeCard,
} from "./mac-native-parsers";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const CATALOGUE_CACHE_KEY = "mac_native:catalogue:v1";
const CATALOGUE_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const OPTIONS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CachedCatalogue {
  updatedAt: number;
  items: MacNativeCatalogueItem[];
}

async function fetchHtml(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
    },
    timeout: 15000,
    responseType: "text",
  });
  return typeof res.data === "string" ? res.data : String(res.data ?? "");
}

function mergeParsedCards(
  cards: ParsedMacNativeCard[]
): MacNativeCatalogueItem[] {
  const byKey = new Map<string, MacNativeCatalogueItem>();

  for (const card of cards) {
    const objectId = buildMacNativeObjectId(card.normalizedTitle);
    const existing = byKey.get(objectId);

    const sourceEntry = {
      source: card.source,
      sourceLabel: card.sourceLabel,
      detailUrl: card.detailUrl,
      fileSize: card.fileSize,
      version: card.version,
    };

    if (!existing) {
      byKey.set(objectId, {
        id: `mac_native:${objectId}`,
        objectId,
        title: card.title,
        normalizedTitle: card.normalizedTitle,
        version: card.version,
        coverUrl: card.coverUrl,
        iconUrl: card.iconUrl,
        summary: card.summary,
        fileSize: card.fileSize,
        publishedAt: card.publishedAt,
        sources: [sourceEntry],
      });
    } else {
      const alreadyHasDetail = existing.sources.some(
        (s) => s.detailUrl === card.detailUrl
      );
      if (!alreadyHasDetail) {
        existing.sources.push(sourceEntry);
      }
      if (!existing.coverUrl && card.coverUrl)
        existing.coverUrl = card.coverUrl;
      if (!existing.iconUrl && card.iconUrl) existing.iconUrl = card.iconUrl;
      if (!existing.fileSize && card.fileSize)
        existing.fileSize = card.fileSize;
      if (!existing.version && card.version) existing.version = card.version;
      if (!existing.summary && card.summary) existing.summary = card.summary;
      if (!existing.publishedAt && card.publishedAt) {
        existing.publishedAt = card.publishedAt;
      }
    }
  }

  return Array.from(byKey.values());
}

export class MacNativeCatalogueService {
  private static memoryCache: CachedCatalogue | null = null;
  private static optionsCache = new Map<
    string,
    {
      cachedAt: number;
      options: MacNativeDownloadOption[];
      summary: string | null;
    }
  >();
  private static inflightFetch: Promise<CachedCatalogue> | null = null;

  public static async getCatalogue(
    forceRefresh = false
  ): Promise<{ items: MacNativeCatalogueItem[]; updatedAt: number }> {
    const now = Date.now();

    if (
      !forceRefresh &&
      this.memoryCache &&
      now - this.memoryCache.updatedAt < CATALOGUE_CACHE_TTL_MS
    ) {
      return this.memoryCache;
    }

    if (!forceRefresh) {
      const persisted = (await db
        .get<string, CachedCatalogue | null>(CATALOGUE_CACHE_KEY, {
          valueEncoding: "json",
        })
        .catch(() => null)) as CachedCatalogue | null;
      if (
        persisted &&
        Array.isArray(persisted.items) &&
        persisted.items.length > 0 &&
        now - persisted.updatedAt < CATALOGUE_CACHE_TTL_MS
      ) {
        this.memoryCache = persisted;
        return persisted;
      }
    }

    if (this.inflightFetch) return this.inflightFetch;

    this.inflightFetch = (async () => {
      try {
        const appstorrentPages = [
          "https://appstorrent.ru/games/",
          "https://appstorrent.ru/games/page/2/",
          "https://appstorrent.ru/games/page/3/",
        ];
        const torrentMacPages = [
          "https://www.torrentmac.net/category/games/",
          "https://www.torrentmac.net/category/games/page/2/",
          "https://www.torrentmac.net/category/games/page/3/",
          "https://www.torrentmac.net/category/games/page/4/",
        ];

        const [appstorrentHtmls, torrentMacHtmls] = await Promise.all([
          Promise.all(
            appstorrentPages.map((u) =>
              fetchHtml(u).catch((err) => {
                logger.warn(`[MacNative] Failed to fetch ${u}:`, err);
                return "";
              })
            )
          ),
          Promise.all(
            torrentMacPages.map((u) =>
              fetchHtml(u).catch((err) => {
                logger.warn(`[MacNative] Failed to fetch ${u}:`, err);
                return "";
              })
            )
          ),
        ]);

        const allCards: ParsedMacNativeCard[] = [];
        for (const h of appstorrentHtmls) {
          if (h) allCards.push(...parseAppstorrentListingHtml(h));
        }
        for (const h of torrentMacHtmls) {
          if (h) allCards.push(...parseTorrentMacListingHtml(h));
        }

        const merged = mergeParsedCards(allCards);
        const result: CachedCatalogue = {
          updatedAt: Date.now(),
          items: merged,
        };

        if (merged.length > 0) {
          this.memoryCache = result;
          await db
            .put(CATALOGUE_CACHE_KEY, result, { valueEncoding: "json" })
            .catch(() => {});
        }
        return result;
      } finally {
        this.inflightFetch = null;
      }
    })();

    return this.inflightFetch;
  }

  public static async searchLive(
    query: string
  ): Promise<MacNativeCatalogueItem[]> {
    const trimmed = query.trim();
    const { items: cached } = await this.getCatalogue(false);
    if (!trimmed) return cached;

    const q = trimmed.toLowerCase();
    const localMatches = cached.filter(
      (item) =>
        item.title.toLowerCase().includes(q) || item.normalizedTitle.includes(q)
    );

    // Also perform live search on both sites to discover games beyond page 3/4
    const [appHtml, tmHtml] = await Promise.all([
      fetchHtml(
        `https://appstorrent.ru/index.php?do=search&subaction=search&story=${encodeURIComponent(trimmed)}`
      ).catch(() => ""),
      fetchHtml(
        `https://www.torrentmac.net/?s=${encodeURIComponent(trimmed)}`
      ).catch(() => ""),
    ]);

    const liveCards: ParsedMacNativeCard[] = [];
    if (appHtml) liveCards.push(...parseAppstorrentListingHtml(appHtml));
    if (tmHtml) liveCards.push(...parseTorrentMacListingHtml(tmHtml));

    if (liveCards.length === 0) return localMatches;

    const liveItems = mergeParsedCards(liveCards);

    // Merge into memory cache so opening game details works immediately
    const byId = new Map<string, MacNativeCatalogueItem>();
    for (const item of cached) byId.set(item.objectId, item);
    for (const item of liveItems) {
      const existing = byId.get(item.objectId);
      if (!existing) {
        byId.set(item.objectId, item);
      } else {
        for (const src of item.sources) {
          if (!existing.sources.some((s) => s.detailUrl === src.detailUrl)) {
            existing.sources.push(src);
          }
        }
      }
    }
    const updatedAll = Array.from(byId.values());
    if (this.memoryCache) {
      this.memoryCache = { ...this.memoryCache, items: updatedAll };
      await db
        .put(CATALOGUE_CACHE_KEY, this.memoryCache, { valueEncoding: "json" })
        .catch(() => {});
    }

    const resultIds = new Set<string>([
      ...localMatches.map((i) => i.objectId),
      ...liveItems.map((i) => i.objectId),
    ]);
    return updatedAll.filter((i) => resultIds.has(i.objectId));
  }

  public static async getItemByObjectId(
    objectId: string
  ): Promise<MacNativeCatalogueItem | null> {
    const { items } = await this.getCatalogue(false);
    return items.find((i) => i.objectId === objectId) ?? null;
  }

  public static async resolveDownloadOptions(
    objectId: string,
    fallbackTitle?: string
  ): Promise<{
    options: MacNativeDownloadOption[];
    summary: string | null;
  }> {
    const cached = this.optionsCache.get(objectId);
    if (cached && Date.now() - cached.cachedAt < OPTIONS_CACHE_TTL_MS) {
      return { options: cached.options, summary: cached.summary };
    }

    let item = await this.getItemByObjectId(objectId);
    if (!item && fallbackTitle) {
      const searched = await this.searchLive(fallbackTitle);
      item =
        searched.find((i) => i.objectId === objectId) ?? searched[0] ?? null;
    }

    if (!item) {
      return { options: [], summary: null };
    }

    const allOptions: MacNativeDownloadOption[] = [];
    let bestSummary: string | null = item.summary;

    await Promise.all(
      item.sources.map(async (src) => {
        try {
          const html = await fetchHtml(src.detailUrl);
          if (src.source === "appstorrent") {
            const parsed = parseAppstorrentDetailHtml(
              html,
              src.detailUrl,
              item!.title
            );
            allOptions.push(...parsed.options);
            if (!bestSummary && parsed.summary) bestSummary = parsed.summary;
          } else {
            const parsed = parseTorrentMacDetailHtml(
              html,
              src.detailUrl,
              item!.title
            );
            allOptions.push(...parsed.options);
            if (!bestSummary && parsed.summary) bestSummary = parsed.summary;
          }
        } catch (err) {
          logger.warn(
            `[MacNative] Failed to resolve detail page ${src.detailUrl}:`,
            err
          );
        }
      })
    );

    const priority = (o: MacNativeDownloadOption): number => {
      if (o.isTorrent) return 1;
      if (o.hoster === "Direct CDN") return 2;
      if (o.hoster === "Mail.ru Cloud") return 3;
      if (o.hoster === "MediaFire") return 4;
      if (o.hoster === "Gofile" || o.hoster === "Pixeldrain") return 5;
      return 6;
    };
    allOptions.sort((a, b) => priority(a) - priority(b));

    this.optionsCache.set(objectId, {
      cachedAt: Date.now(),
      options: allOptions,
      summary: bestSummary,
    });

    return { options: allOptions, summary: bestSummary };
  }

  public static async startDownload(params: {
    objectId: string;
    title: string;
    option: MacNativeDownloadOption;
    downloadPath?: string;
  }): Promise<{
    ok: boolean;
    error?: string;
    fallbackBrowser?: boolean;
    url?: string;
  }> {
    const { objectId, title, option } = params;
    const lowerUrl = option.url.toLowerCase();

    // Mega.nz encrypted links require browser/client decryption
    if (lowerUrl.includes("mega.nz/")) {
      return {
        ok: false,
        fallbackBrowser: true,
        url: option.url,
        error: `${option.hoster} requer abertura no navegador.`,
      };
    }

    let uriToDownload = option.url;
    let downloader: Downloader = Downloader.DirectHttp;
    let resolvedFolderName: string | null = null;
    let resolvedFileSize: number | null = null;

    if (option.isTorrent) {
      if (lowerUrl.startsWith("magnet:")) {
        uriToDownload = option.url;
        downloader = Downloader.Torrent;
      } else {
        try {
          const res = await axios.get<ArrayBuffer>(option.url, {
            headers: {
              "User-Agent": BROWSER_UA,
              Referer: option.detailUrl,
            },
            responseType: "arraybuffer",
            timeout: 15000,
          });
          const parsed = await parseTorrent(Buffer.from(res.data));
          uriToDownload = toMagnetURI(parsed);
          downloader = Downloader.Torrent;
        } catch (err) {
          logger.warn("[MacNative] Failed to parse .torrent file:", err);
          return {
            ok: false,
            fallbackBrowser: true,
            url: option.url,
            error: "Não foi possível ler o arquivo .torrent diretamente.",
          };
        }
      }
    } else if (MailRuApi.isMailRuPublicUrl(option.url)) {
      try {
        const resolved = await MailRuApi.resolveDownload(option.url);
        resolvedFolderName = resolved.fileName ?? null;
        resolvedFileSize = resolved.fileSize ?? null;
        uriToDownload = option.url;
        downloader = Downloader.DirectHttp;
      } catch (err) {
        logger.warn("[MacNative] Mail.ru direct resolution failed:", err);
        return {
          ok: false,
          fallbackBrowser: true,
          url: option.url,
          error:
            "Não foi possível obter link direto do Mail.ru para este arquivo. A página foi aberta no navegador.",
        };
      }
    } else if (lowerUrl.includes("mediafire.com/")) {
      try {
        await MediafireApi.getDownloadUrl(option.url);
        downloader = Downloader.Mediafire;
      } catch (err) {
        logger.warn("[MacNative] MediaFire pre-resolution failed:", err);
        if (err instanceof MediafireChallengeError) {
          return {
            ok: false,
            fallbackBrowser: true,
            url: option.url,
            error:
              "O MediaFire exigiu verificação anti-bot (Cloudflare) para este arquivo. A página foi aberta no navegador.",
          };
        }
        return {
          ok: false,
          fallbackBrowser: true,
          url: option.url,
          error:
            "Não foi possível extrair o link direto do MediaFire. A página foi aberta no navegador.",
        };
      }
    } else if (lowerUrl.includes("gofile.io/")) {
      downloader = Downloader.Gofile;
    } else if (lowerUrl.includes("pixeldrain.com/")) {
      downloader = Downloader.PixelDrain;
    } else {
      downloader = Downloader.DirectHttp;
    }

    const gameKey = levelKeys.game("mac_native", objectId);
    const existingGame = await gamesSublevel
      .get(gameKey)
      .catch(() => undefined);
    const catalogItem = await this.getItemByObjectId(objectId);

    if (!existingGame) {
      await gamesSublevel.put(gameKey, {
        title,
        iconUrl: catalogItem?.iconUrl ?? catalogItem?.coverUrl ?? null,
        libraryHeroImageUrl: catalogItem?.coverUrl ?? null,
        logoImageUrl: null,
        objectId,
        shop: "mac_native",
        remoteId: null,
        isDeleted: false,
        playTimeInMilliseconds: 0,
        lastTimePlayed: null,
        platform: "macOS Native",
        addedToLibraryAt: new Date(),
      });
    } else if (existingGame.isDeleted) {
      await gamesSublevel.put(gameKey, { ...existingGame, isDeleted: false });
    }

    const existingAssets = await gamesShopAssetsSublevel
      .get(gameKey)
      .catch(() => undefined);
    if (!existingAssets && catalogItem) {
      await gamesShopAssetsSublevel.put(gameKey, {
        objectId,
        shop: "mac_native",
        title: catalogItem.title,
        iconUrl: catalogItem.iconUrl ?? catalogItem.coverUrl,
        libraryImageUrl: catalogItem.coverUrl ?? catalogItem.iconUrl,
        libraryHeroImageUrl: catalogItem.coverUrl,
        logoImageUrl: null,
        logoPosition: null,
        coverImageUrl: catalogItem.coverUrl,
        downloadSources: catalogItem.sources.map((s) => s.sourceLabel),
        updatedAt: Date.now(),
      });
    }

    const downloadPath = params.downloadPath || (await getDownloadsPath());

    const downloadEntry = {
      shop: "mac_native" as const,
      objectId,
      uri: uriToDownload,
      downloader,
      folderName: resolvedFolderName,
      fileSize: resolvedFileSize,
      progress: 0,
      downloadPath,
      status: "active" as const,
      bytesDownloaded: 0,
      queued: true,
      timestamp: Date.now(),
      shouldSeed: false,
      extracting: false,
      automaticallyExtract: true,
      automaticallyDeleteArchiveFiles: false,
    };

    await downloadsSublevel.put(gameKey, downloadEntry);

    try {
      await DownloadManager.startDownload(downloadEntry);
      return { ok: true };
    } catch (err) {
      logger.error("[MacNative] DownloadManager.startDownload failed:", err);
      await downloadsSublevel.del(gameKey).catch(() => {});
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Falha ao iniciar download Mac Native.",
      };
    }
  }
}
