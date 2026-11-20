import type {
  DownloadSource,
  NxCloudAvailableGame,
  NxCompatibleGame,
  SwitchGeneration,
} from "@types";
import { DownloadSourceStatus, getDownloadersForUri } from "@shared";
import { downloadSourcesSublevel, nxCloudStreamsSublevel } from "@main/level";
import { AppLogHub } from "@main/services/app-log-hub";
import { NxCompatibilityService } from "./nx-compatibility-service";
import {
  cleanPortalCardTitle,
  decodeBlueRomsDataLink,
  extractBlueRomsDownloadPath,
  extractNswpediaDownloadLinks,
  extractPortalSlugCandidates,
  extractRomsHqDownloadLinks,
  scoreSwitchTitleMatch,
} from "./nx-core-parsers";

const TITLE_ID_REGEX = /\b((?:0100|0400)[0-9A-Fa-f]{12})\b/i;

const KNOWN_SWITCH_HOSTS = [
  "blueroms.ws",
  "romshq.com",
  "nswpedia.com",
  "nsw2u.",
  "ziperto.",
  "nxbrew.",
  "eggnsemulator.",
  "mediafire.com",
  "drive.google.com",
];

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  Accept:
    "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
};

const INTERSTITIAL_TITLE_REGEX =
  /<title>\s*(?:just a moment|attention required|checking your browser|security check|ddos-guard)/i;

const ROMSHQ_FRANCHISE_QUERIES = [
  "zelda",
  "pokemon",
  "mario",
  "xenoblade",
  "fire emblem",
  "dragon quest",
  "final fantasy",
  "kirby",
  "donkey kong",
  "metroid",
  "bayonetta",
  "persona",
  "octopath",
  "splatoon",
  "pikmin",
  "monster hunter",
  "sonic",
  "resident evil",
  "blasphemous",
  "nier",
  "astral chain",
  "shin megami",
  "cult of the lamb",
  "hollow knight",
  "celeste",
  "hades",
  "cuphead",
  "undertale",
  "stardew",
  "animal crossing",
  "luigi",
];

function isCaptchaOrChallengeResponse(status: number, body: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  if (INTERSTITIAL_TITLE_REGEX.test(body)) return true;
  return false;
}

function resolveCandidateUrl(raw: string, baseUrl: string): string {
  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("magnet:")
  ) {
    return raw;
  }
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

export type ResolvedSwitchDownloadLink =
  | { ok: true; url: string; allCandidates?: string[] }
  | { ok: false; fallbackBrowser: boolean; reason: string; url: string };

export class NxCloudScraperService {
  public static get defaultUnderTheHoodSources(): DownloadSource[] {
    const createdAt = new Date(0).toISOString();
    return [
      {
        id: "builtin-blueroms-s2",
        name: "BlueRoms (Switch 2)",
        url: "https://www.blueroms.ws/switch2",
        sourceKind: "switch",
        status: DownloadSourceStatus.Matched,
        downloadCount: 0,
        createdAt,
        isEnabled: true,
      },
      {
        id: "builtin-blueroms-s1",
        name: "BlueRoms (Switch)",
        url: "https://www.blueroms.ws/switch",
        sourceKind: "switch",
        status: DownloadSourceStatus.Matched,
        downloadCount: 0,
        createdAt,
        isEnabled: true,
      },
      {
        id: "builtin-romshq",
        name: "RomsHQ",
        url: "https://romshq.com/games?type=game&scene=62%2C95",
        sourceKind: "switch",
        status: DownloadSourceStatus.Matched,
        downloadCount: 0,
        createdAt,
        isEnabled: true,
      },
      {
        id: "builtin-nswpedia",
        name: "NSWPedia",
        url: "https://nswpedia.com/nintendo-switch-roms",
        sourceKind: "switch",
        status: DownloadSourceStatus.Matched,
        downloadCount: 0,
        createdAt,
        isEnabled: true,
      },
    ];
  }

  public static isLikelySwitchSourceUrl(urlString: string): boolean {
    const lower = urlString.trim().toLowerCase();
    if (lower.startsWith("magnet:")) return true;
    if (KNOWN_SWITCH_HOSTS.some((host) => lower.includes(host))) return true;
    if (
      lower.includes("switch") ||
      lower.includes("/roms") ||
      lower.includes("nsp") ||
      lower.includes("xci")
    ) {
      return !lower.endsWith(".json");
    }
    return false;
  }

  public static normalizeTitle(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/\.(nsp|xci|nsz|nup|zip|7z|rar)$/i, "")
      .replace(/\[[^\]]+\]/g, "")
      .replace(/\([^)]+\)/g, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  private static buildCompatIndexes(compatibleGames: NxCompatibleGame[]) {
    const byTid = new Map<string, NxCompatibleGame>();
    const byNorm = new Map<string, NxCompatibleGame>();
    for (const game of compatibleGames) {
      byTid.set(game.titleId.toUpperCase(), game);
      const norm = this.normalizeTitle(game.title);
      if (norm) byNorm.set(norm, game);
    }
    return { byTid, byNorm, list: compatibleGames };
  }

  private static findBestCompatMatch(
    candidateText: string,
    byTid: Map<string, NxCompatibleGame>,
    byNorm: Map<string, NxCompatibleGame>,
    foundTid?: string | null
  ): NxCompatibleGame | undefined {
    if (foundTid) {
      const exactTid = byTid.get(foundTid.toUpperCase());
      if (exactTid) return exactTid;
    }
    if (!candidateText) return undefined;
    const norm = this.normalizeTitle(candidateText);
    if (norm && byNorm.has(norm)) {
      return byNorm.get(norm);
    }

    let best: NxCompatibleGame | undefined;
    let bestScore = 0;
    for (const game of byTid.values()) {
      const score = scoreSwitchTitleMatch(candidateText, game.title);
      if (score >= 0.72 && score > bestScore) {
        bestScore = score;
        best = game;
        if (score >= 0.99) break;
      }
    }
    return best;
  }

  public static async syncSingleSource(
    source: DownloadSource,
    compatibleGames?: NxCompatibleGame[]
  ): Promise<{
    updatedSource: DownloadSource;
    matches: Record<string, NxCloudAvailableGame>;
  }> {
    const games =
      compatibleGames ??
      (await NxCompatibilityService.getCompatibleGames(false)).games;
    const { byTid, byNorm } = this.buildCompatIndexes(games);

    const matches: Record<string, NxCloudAvailableGame> = {};
    let lastError: string | null = null;

    const urlStr = source.url.trim();
    AppLogHub.info(
      "sources",
      `Sincronizando fonte Switch: ${source.name} (${urlStr})`
    );

    try {
      if (urlStr.startsWith("magnet:")) {
        this.resolveDirectMagnet(urlStr, source, byTid, byNorm, matches);
      } else {
        const parsedUrl = new URL(urlStr);
        if (this.isMediaFireFolder(parsedUrl)) {
          const folderKey = this.extractMediaFireFolderKey(parsedUrl);
          if (folderKey) {
            await this.resolveMediaFireFolder(
              folderKey,
              source,
              byTid,
              byNorm,
              matches
            );
          }
        } else if (this.isGoogleDriveFile(parsedUrl)) {
          const fileId = this.extractGoogleDriveFileId(parsedUrl);
          if (fileId) {
            await this.resolveGoogleDriveFile(
              fileId,
              urlStr,
              source,
              byTid,
              byNorm,
              matches
            );
          }
        } else {
          const urlsToFetch = this.expandPortalUrls(parsedUrl);
          const batchSize = 6;
          for (let i = 0; i < urlsToFetch.length; i += batchSize) {
            const batch = urlsToFetch.slice(i, i + batchSize);
            await Promise.all(
              batch.map(async (targetUrl) => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 12000);
                try {
                  const resp = await fetch(targetUrl, {
                    headers: FETCH_HEADERS,
                    signal: controller.signal,
                  });
                  clearTimeout(timer);
                  if (!resp.ok) {
                    if (Object.keys(matches).length === 0) {
                      lastError = `HTTP ${resp.status}`;
                    }
                    return;
                  }
                  const text = await resp.text();
                  this.parsePayload(
                    text,
                    targetUrl,
                    source,
                    byTid,
                    byNorm,
                    matches
                  );
                } catch (err) {
                  clearTimeout(timer);
                  if (Object.keys(matches).length === 0) {
                    lastError =
                      err instanceof Error ? err.message : String(err);
                  }
                }
              })
            );
          }
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    const matchedTitleIds = Object.keys(matches);
    const hasFreshMatches = matchedTitleIds.length > 0;
    const preservedTitleIds =
      !hasFreshMatches && source.matchedTitleIds?.length
        ? source.matchedTitleIds
        : matchedTitleIds;
    const preservedCount =
      !hasFreshMatches && (source.downloadCount ?? 0) > 0
        ? source.downloadCount
        : matchedTitleIds.length;

    const updatedSource: DownloadSource = {
      ...source,
      sourceKind: "switch",
      isEnabled: source.isEnabled ?? true,
      downloadCount: preservedCount,
      matchedTitleIds: preservedTitleIds,
      status:
        lastError && preservedCount === 0
          ? DownloadSourceStatus.Failed
          : DownloadSourceStatus.Matched,
      lastSyncAt: new Date().toISOString(),
      lastError: hasFreshMatches ? null : lastError,
    };

    AppLogHub.append(
      hasFreshMatches ? "success" : "warning",
      "sources",
      `Fonte Switch "${source.name}": ${matchedTitleIds.length} jogos compatíveis encontrados${lastError && !hasFreshMatches ? ` (${lastError})` : ""}.`
    );

    return { updatedSource, matches };
  }

  public static async syncAllSwitchSources(): Promise<{
    sources: DownloadSource[];
    totalMatches: number;
  }> {
    const { games } = await NxCompatibilityService.getCompatibleGames(false);
    const allSources = await downloadSourcesSublevel.values().all();
    const userSwitchSources = allSources.filter(
      (s) => s.sourceKind === "switch"
    );
    const userSourceIds = new Set(userSwitchSources.map((s) => s.id));

    // Include built-in under-the-hood sources (1:1 with NxNative_Launcher CloudScraperService)
    const sourcesToProcess: DownloadSource[] = [...userSwitchSources];
    for (const def of this.defaultUnderTheHoodSources) {
      const defHost = new URL(def.url).hostname.replace(/^www\./, "");
      const alreadyCovered = sourcesToProcess.some((s) => {
        try {
          const h = new URL(s.url).hostname.replace(/^www\./, "");
          if (defHost === "blueroms.ws") {
            return (
              h === "blueroms.ws" &&
              s.url.toLowerCase().includes(def.url.split("/").pop() || "")
            );
          }
          return h === defHost;
        } catch {
          return s.url === def.url;
        }
      });
      if (!alreadyCovered) {
        sourcesToProcess.push(def);
      }
    }

    const streamsByTid = new Map<string, NxCloudAvailableGame[]>();
    // Seed with existing cached streams so a transient network reset on one source doesn't wipe prior streams
    try {
      const disabledIds = new Set(
        userSwitchSources.filter((s) => s.isEnabled === false).map((s) => s.id)
      );
      for await (const [tid, items] of nxCloudStreamsSublevel.iterator()) {
        const activeItems = (items || []).filter(
          (item) => !disabledIds.has(item.sourceId)
        );
        if (activeItems.length > 0) {
          streamsByTid.set(tid.toUpperCase(), activeItems);
        }
      }
    } catch {
      // ignore if empty
    }

    const updatedSources: DownloadSource[] = [];

    for (const src of sourcesToProcess) {
      if (src.isEnabled === false) {
        if (userSourceIds.has(src.id)) {
          updatedSources.push(src);
        }
        continue;
      }
      const { updatedSource, matches } = await this.syncSingleSource(
        src,
        games
      );
      if (userSourceIds.has(src.id)) {
        await downloadSourcesSublevel.put(updatedSource.id, updatedSource);
        updatedSources.push(updatedSource);
      }

      for (const [tid, item] of Object.entries(matches)) {
        const key = tid.toUpperCase();
        const existing = streamsByTid.get(key) || [];
        const existingIdx = existing.findIndex(
          (x) =>
            x.downloadURL === item.downloadURL || x.sourceId === item.sourceId
        );
        if (existingIdx >= 0) {
          existing[existingIdx] = item;
        } else {
          existing.push(item);
        }
        streamsByTid.set(key, existing);
      }
    }

    for (const [tid, items] of streamsByTid.entries()) {
      await nxCloudStreamsSublevel.put(tid, items);
    }

    return {
      sources: updatedSources,
      totalMatches: streamsByTid.size,
    };
  }

  public static async getStreamsForTitleId(
    titleId: string
  ): Promise<NxCloudAvailableGame[]> {
    try {
      const items = await nxCloudStreamsSublevel.get(titleId.toUpperCase());
      return items || [];
    } catch {
      return [];
    }
  }

  /**
   * Resolves cached + live streams for a Switch game across configured and built-in
   * Switch portals (BlueRoms, RomsHQ, NSWPedia).
   */
  public static async resolveStreamsForSingleGame(
    titleId: string,
    title: string,
    generation: SwitchGeneration
  ): Promise<NxCloudAvailableGame[]> {
    const upperTid = titleId.toUpperCase();
    const cached = await this.getStreamsForTitleId(upperTid);

    const cleanQuery = title
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleanQuery) return cached;

    const allSources = await downloadSourcesSublevel.values().all();
    const configuredSwitchSources = allSources.filter(
      (s) => s.sourceKind === "switch" && s.isEnabled !== false
    );

    const sourcesToQuery: DownloadSource[] = [...configuredSwitchSources];
    for (const def of this.defaultUnderTheHoodSources) {
      const defHost = new URL(def.url).hostname.replace(/^www\./, "");
      const hasHost = sourcesToQuery.some((s) =>
        s.url.toLowerCase().includes(defHost)
      );
      if (!hasHost) {
        sourcesToQuery.push(def);
      }
    }

    const searchTargets: Array<{ source: DownloadSource; searchUrl: string }> =
      [];
    const seenSearchUrls = new Set<string>();
    const pushSearch = (source: DownloadSource, searchUrl: string) => {
      if (seenSearchUrls.has(searchUrl)) return;
      seenSearchUrls.add(searchUrl);
      searchTargets.push({ source, searchUrl });
    };

    const q = encodeURIComponent(cleanQuery);
    const subtitle = cleanQuery.includes(":")
      ? cleanQuery.split(":").slice(1).join(" ").trim()
      : "";

    for (const src of sourcesToQuery) {
      const lower = src.url.toLowerCase();
      if (lower.includes("blueroms.ws")) {
        pushSearch(src, "https://www.blueroms.ws/switch2");
        pushSearch(src, "https://www.blueroms.ws/switch");
        pushSearch(src, `https://www.blueroms.ws/search?q=${q}`);
      } else if (lower.includes("romshq.com")) {
        pushSearch(src, `https://romshq.com/search/${q}`);
        if (subtitle.length >= 3) {
          pushSearch(
            src,
            `https://romshq.com/search/${encodeURIComponent(subtitle)}`
          );
        }
        if (generation === "switch2") {
          pushSearch(src, "https://romshq.com/roms/switch-2");
        }
      } else if (lower.includes("nswpedia.com")) {
        pushSearch(src, `https://nswpedia.com/?s=${q}`);
        if (subtitle.length >= 3) {
          pushSearch(
            src,
            `https://nswpedia.com/?s=${encodeURIComponent(subtitle)}`
          );
        }
        pushSearch(src, "https://nswpedia.com/nintendo-switch-roms");
      } else {
        pushSearch(src, src.url);
      }
    }

    const syntheticCompat: NxCompatibleGame = {
      id: upperTid,
      title,
      titleId: upperTid,
      generation,
      versionTested: "",
      sdk: "nxnative",
      engine: "",
      graphicsApi: "",
      readmeRelPath: "",
      githubUrl: "",
      macReq: "",
      iosReq: "",
      androidReq: "",
      androidGpuTier: "",
      storageReq: "",
      minRamGB: 8,
      minChipTier: "",
      isNew: false,
      addedTimestamp: 0,
      isMacSupported: true,
      isIosSupported: generation === "switch1",
      isIpadOsSupported: generation === "switch1",
      isAndroidSupported: false,
      coverUrl: null,
      genres: [],
      cloudSources: [],
    };
    const byTid = new Map([[upperTid, syntheticCompat]]);
    const byNorm = new Map([[this.normalizeTitle(title), syntheticCompat]]);

    const mergedStreams: NxCloudAvailableGame[] = [...cached];
    const seenUrls = new Set<string>(cached.map((c) => c.downloadURL));

    await Promise.all(
      searchTargets.map(async ({ source, searchUrl }) => {
        try {
          const resp = await fetch(searchUrl, {
            headers: FETCH_HEADERS,
            signal: AbortSignal.timeout(10000),
          });
          if (!resp.ok) return;
          const text = await resp.text();
          const localMatches: Record<string, NxCloudAvailableGame> = {};
          this.parsePayload(
            text,
            searchUrl,
            source,
            byTid,
            byNorm,
            localMatches
          );
          const item = localMatches[upperTid];
          if (item && !seenUrls.has(item.downloadURL)) {
            seenUrls.add(item.downloadURL);
            mergedStreams.push(item);
          }
        } catch {
          // Non-fatal single source failure
        }
      })
    );

    if (mergedStreams.length > 0 && /^[0-9A-F]{16}$/.test(upperTid)) {
      await nxCloudStreamsSublevel.put(upperTid, mergedStreams).catch(() => {});
    }

    return mergedStreams;
  }

  /**
   * Resolves a portal/landing page URL (BlueRoms, NSWPedia, RomsHQ) into a
   * concrete direct HTTP URL, supported hoster URI, or magnet link (1:1 with NxNative_Launcher DownloadEngineService).
   */
  public static async resolveFinalDownloadLink(
    streamUrl: string
  ): Promise<ResolvedSwitchDownloadLink> {
    const trimmed = streamUrl.trim();
    if (!trimmed) {
      return {
        ok: false,
        fallbackBrowser: false,
        reason: "empty_url",
        url: streamUrl,
      };
    }

    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith("magnet:") ||
      getDownloadersForUri(trimmed).length > 0 ||
      /\.(nsp|nsz|nzs|xci|xcz|nup|zip|7z|rar|torrent)(\?|#|$)/i.test(lower)
    ) {
      return { ok: true, url: trimmed };
    }

    const fetchPage = async (url: string) => {
      const urlsToTry = [url];
      if (url.includes("://blueroms.ws/")) {
        urlsToTry.unshift(
          url.replace("://blueroms.ws/", "://www.blueroms.ws/")
        );
      }
      let lastErr: unknown;
      for (const candidateUrl of urlsToTry) {
        try {
          const resp = await fetch(candidateUrl, {
            headers: FETCH_HEADERS,
            signal: AbortSignal.timeout(12000),
          });
          const text = await resp.text();
          return { status: resp.status, text, finalUrl: candidateUrl };
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    };

    try {
      const first = await fetchPage(trimmed);

      // 1. BlueRoms 2-hop resolution (game page -> /download/... -> base64 data-link magnet)
      if (lower.includes("blueroms.ws")) {
        const directB64 = decodeBlueRomsDataLink(first.text);
        if (directB64) {
          return {
            ok: true,
            url: resolveCandidateUrl(directB64, first.finalUrl),
          };
        }
        const dlPath = extractBlueRomsDownloadPath(first.text);
        if (dlPath) {
          const dlUrl = resolveCandidateUrl(dlPath, first.finalUrl);
          const second = await fetchPage(dlUrl);
          const decoded = decodeBlueRomsDataLink(second.text);
          if (decoded) {
            return {
              ok: true,
              url: resolveCandidateUrl(decoded, second.finalUrl),
            };
          }
          const generic = extractRomsHqDownloadLinks(
            second.text,
            second.finalUrl
          );
          if (generic.length > 0) {
            return { ok: true, url: generic[0], allCandidates: generic };
          }
          if (isCaptchaOrChallengeResponse(second.status, second.text)) {
            return {
              ok: false,
              fallbackBrowser: true,
              reason: "captcha_or_challenge",
              url: dlUrl,
            };
          }
        }
      }

      // 2. NSWPedia 3-hop resolution (game page -> /download/<slug> -> /download/<slug>/download_list -> id="download-link")
      if (lower.includes("nswpedia.com")) {
        const extracted = extractNswpediaDownloadLinks(
          first.text,
          first.finalUrl
        );
        if (extracted.directLinks.length > 0) {
          return {
            ok: true,
            url: resolveCandidateUrl(extracted.directLinks[0], first.finalUrl),
            allCandidates: extracted.directLinks,
          };
        }

        // Check downloadListPages directly if present on Hop 1
        for (const listUrl of extracted.downloadListPages.slice(0, 2)) {
          const listResp = await fetchPage(listUrl);
          const listExtracted = extractNswpediaDownloadLinks(
            listResp.text,
            listResp.finalUrl
          );
          if (listExtracted.directLinks.length > 0) {
            return {
              ok: true,
              url: resolveCandidateUrl(
                listExtracted.directLinks[0],
                listResp.finalUrl
              ),
              allCandidates: listExtracted.directLinks,
            };
          }
          const listHosters = extractRomsHqDownloadLinks(
            listResp.text,
            listResp.finalUrl
          );
          if (listHosters.length > 0) {
            return {
              ok: true,
              url: listHosters[0],
              allCandidates: listHosters,
            };
          }
        }

        // Follow Hop 2 (/download/<slug>) and then Hop 3 (/download/<slug>/download_list)
        for (const dlPageUrl of extracted.downloadPages.slice(0, 2)) {
          const dlResp = await fetchPage(dlPageUrl);
          const dlExtracted = extractNswpediaDownloadLinks(
            dlResp.text,
            dlResp.finalUrl
          );
          if (dlExtracted.directLinks.length > 0) {
            return {
              ok: true,
              url: resolveCandidateUrl(
                dlExtracted.directLinks[0],
                dlResp.finalUrl
              ),
              allCandidates: dlExtracted.directLinks,
            };
          }

          for (const listUrl of dlExtracted.downloadListPages.slice(0, 3)) {
            const listResp = await fetchPage(listUrl);
            const listExtracted = extractNswpediaDownloadLinks(
              listResp.text,
              listResp.finalUrl
            );
            if (listExtracted.directLinks.length > 0) {
              return {
                ok: true,
                url: resolveCandidateUrl(
                  listExtracted.directLinks[0],
                  listResp.finalUrl
                ),
                allCandidates: listExtracted.directLinks,
              };
            }
            const listHosters = extractRomsHqDownloadLinks(
              listResp.text,
              listResp.finalUrl
            );
            if (listHosters.length > 0) {
              return {
                ok: true,
                url: listHosters[0],
                allCandidates: listHosters,
              };
            }
          }

          const dlHosters = extractRomsHqDownloadLinks(
            dlResp.text,
            dlResp.finalUrl
          );
          if (dlHosters.length > 0) {
            return { ok: true, url: dlHosters[0], allCandidates: dlHosters };
          }
        }
      }

      // 3. RomsHQ & general hoster/magnet/ROM extraction
      const candidates = extractRomsHqDownloadLinks(first.text, first.finalUrl);
      if (candidates.length > 0) {
        return {
          ok: true,
          url: candidates[0],
          allCandidates: candidates,
        };
      }

      if (isCaptchaOrChallengeResponse(first.status, first.text)) {
        return {
          ok: false,
          fallbackBrowser: true,
          reason: "captcha_or_challenge",
          url: trimmed,
        };
      }

      return {
        ok: false,
        fallbackBrowser: true,
        reason: "no_direct_link_found",
        url: trimmed,
      };
    } catch {
      return {
        ok: false,
        fallbackBrowser: true,
        reason: "network_or_timeout",
        url: trimmed,
      };
    }
  }

  private static expandPortalUrls(url: URL): string[] {
    const urls: string[] = [];
    const addUrl = (u: string) => {
      if (!urls.includes(u)) urls.push(u);
    };
    const host = url.hostname.toLowerCase();

    if (host.includes("blueroms.ws")) {
      addUrl("https://www.blueroms.ws/switch2");
      addUrl("https://www.blueroms.ws/switch");
      addUrl("https://blueroms.ws/switch2");
      addUrl("https://blueroms.ws/switch");
      addUrl(url.toString());
      return urls;
    }

    if (host.includes("romshq.com")) {
      addUrl("https://romshq.com/roms/switch-2");
      addUrl("https://romshq.com/trending");
      addUrl("https://romshq.com/roms/nintendo-switch");
      addUrl("https://romshq.com/roms/nintendo-switch?page=2");
      for (const q of ROMSHQ_FRANCHISE_QUERIES) {
        addUrl(`https://romshq.com/search/${encodeURIComponent(q)}`);
      }
      return urls;
    }

    if (host.includes("nswpedia.com")) {
      const subCategories = [
        "https://nswpedia.com/nintendo-switch-roms",
        "https://nswpedia.com/nintendo-switch-roms/adventure",
        "https://nswpedia.com/nintendo-switch-roms/action",
        "https://nswpedia.com/nintendo-switch-roms/rpg",
        "https://nswpedia.com/nintendo-switch-roms/arcade",
        "https://nswpedia.com/nintendo-switch-roms/platformer",
        "https://nswpedia.com/nintendo-switch-roms/fighting",
        "https://nswpedia.com/nintendo-switch-roms/racing",
        "https://nswpedia.com/nintendo-switch-roms/simulation",
        "https://nswpedia.com/nintendo-switch-roms/strategy",
        "https://nswpedia.com/nintendo-switch-roms/sports",
      ];
      for (const sub of subCategories) {
        addUrl(sub);
      }
      addUrl(url.toString());
      return urls;
    }

    addUrl(url.toString());
    return urls;
  }

  private static resolveDirectMagnet(
    magnet: string,
    source: DownloadSource,
    byTid: Map<string, NxCompatibleGame>,
    byNorm: Map<string, NxCompatibleGame>,
    matches: Record<string, NxCloudAvailableGame>
  ): void {
    const dnMatch = /dn=([^&]+)/i.exec(magnet);
    let displayName = source.name;
    if (dnMatch && dnMatch[1]) {
      try {
        displayName = decodeURIComponent(dnMatch[1].replace(/\+/g, " "));
      } catch {
        displayName = dnMatch[1];
      }
    }

    const tidMatch = TITLE_ID_REGEX.exec(`${displayName} ${magnet}`);
    const foundTid = tidMatch?.[1]?.toUpperCase();
    const target =
      (foundTid && byTid.get(foundTid)) ||
      byNorm.get(this.normalizeTitle(displayName));

    if (target) {
      matches[target.titleId] = {
        titleId: target.titleId,
        gameTitle: target.title,
        matchedVersion: target.versionTested,
        downloadURL: magnet,
        isTorrent: true,
        fileSizeFormatted: "",
        sourceId: source.id,
        sourceName: source.name,
      };
    }
  }

  public static parsePayload(
    payload: string,
    baseUrl: string,
    source: DownloadSource,
    byTid: Map<string, NxCompatibleGame>,
    byNorm: Map<string, NxCompatibleGame>,
    matches: Record<string, NxCloudAvailableGame>
  ): void {
    // 1. Try JSON manifest (Switch JSON or Hydra-like JSON)
    const trimmed = payload.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const json = JSON.parse(trimmed) as unknown;
        const items: Record<string, unknown>[] = Array.isArray(json)
          ? (json as Record<string, unknown>[])
          : json &&
              typeof json === "object" &&
              Array.isArray((json as Record<string, unknown>).games)
            ? ((json as Record<string, unknown>).games as Record<
                string,
                unknown
              >[])
            : json &&
                typeof json === "object" &&
                Array.isArray((json as Record<string, unknown>).downloads)
              ? ((json as Record<string, unknown>).downloads as Record<
                  string,
                  unknown
                >[])
              : [];

        let foundAny = false;
        for (const dict of items) {
          const title = String(dict.title || dict.name || "");
          const tid = String(
            dict.titleId || dict.title_id || dict.id || ""
          ).toUpperCase();
          const uris = Array.isArray(dict.uris) ? dict.uris : [];
          const url = String(
            dict.url || dict.downloadUrl || dict.magnet || uris[0] || ""
          );
          const version = String(dict.version || "");
          const size = String(dict.size || dict.fileSize || "");
          if (!url) continue;

          const target =
            (tid && byTid.get(tid)) || byNorm.get(this.normalizeTitle(title));
          if (target) {
            foundAny = true;
            matches[target.titleId] = {
              titleId: target.titleId,
              gameTitle: target.title,
              matchedVersion: version || target.versionTested,
              downloadURL: url,
              isTorrent: url.startsWith("magnet:") || url.endsWith(".torrent"),
              fileSizeFormatted: size,
              sourceId: source.id,
              sourceName: source.name,
            };
          }
        }
        if (foundAny) return;
      } catch {
        // Fallback to HTML parsing
      }
    }

    // 2. HTML / Portal / Open directory scraping
    const anchorRegex =
      /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchorRegex.exec(payload)) !== null) {
      const link = match[1].trim();
      const innerHtml = match[2];
      const cleanText = cleanPortalCardTitle(innerHtml);

      const lowerLink = link.toLowerCase();
      const isGameFile =
        lowerLink.endsWith(".nsp") ||
        lowerLink.endsWith(".xci") ||
        lowerLink.endsWith(".nsz") ||
        lowerLink.endsWith(".nup") ||
        lowerLink.endsWith(".zip") ||
        lowerLink.endsWith(".7z") ||
        lowerLink.startsWith("magnet:?xt=");
      const isGamePortal =
        lowerLink.includes("/game/") ||
        lowerLink.includes("/rom/") ||
        lowerLink.includes("/switch/") ||
        lowerLink.includes("/switch2/") ||
        lowerLink.includes("/games/") ||
        lowerLink.includes("/nintendo-switch-roms/");

      if (!isGameFile && !isGamePortal) continue;

      let resolvedUrl = link;
      if (
        !link.startsWith("http://") &&
        !link.startsWith("https://") &&
        !link.startsWith("magnet:")
      ) {
        try {
          resolvedUrl = new URL(link, baseUrl).toString();
        } catch {
          resolvedUrl = link;
        }
      }

      const tidMatch = TITLE_ID_REGEX.exec(`${link} ${cleanText}`);
      const foundTid = tidMatch?.[1]?.toUpperCase();

      let target = cleanText
        ? this.findBestCompatMatch(cleanText, byTid, byNorm, foundTid)
        : foundTid
          ? byTid.get(foundTid)
          : undefined;

      if (!target) {
        const slugCandidates = extractPortalSlugCandidates(link);
        for (const slugCandidate of slugCandidates) {
          target = this.findBestCompatMatch(slugCandidate, byTid, byNorm);
          if (target) break;
        }
      }

      if (target && !matches[target.titleId]) {
        const isTorrent =
          resolvedUrl.startsWith("magnet:") ||
          resolvedUrl.endsWith(".torrent") ||
          baseUrl.includes("blueroms.ws") ||
          resolvedUrl.includes("blueroms.ws");

        const sizeMatch = /(\d+(?:\.\d+)?\s*(?:GB|MB))/i.exec(innerHtml);
        const fileSizeFormatted = sizeMatch ? sizeMatch[1].toUpperCase() : "";

        matches[target.titleId] = {
          titleId: target.titleId,
          gameTitle: target.title,
          matchedVersion: target.versionTested,
          downloadURL: resolvedUrl,
          isTorrent,
          fileSizeFormatted,
          sourceId: source.id,
          sourceName: source.name,
        };
      }
    }
  }

  private static isMediaFireFolder(url: URL): boolean {
    return (
      url.hostname.includes("mediafire.com") &&
      url.pathname.includes("/folder/")
    );
  }

  private static extractMediaFireFolderKey(url: URL): string | null {
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("folder");
    return idx >= 0 && idx + 1 < parts.length ? parts[idx + 1] : null;
  }

  private static async resolveMediaFireFolder(
    folderKey: string,
    source: DownloadSource,
    byTid: Map<string, NxCompatibleGame>,
    byNorm: Map<string, NxCompatibleGame>,
    matches: Record<string, NxCloudAvailableGame>
  ): Promise<void> {
    const apiUrl = `https://www.mediafire.com/api/1.4/folder/get_content.php?folder_key=${folderKey}&content_type=files&response_format=json`;
    const resp = await fetch(apiUrl, { headers: FETCH_HEADERS });
    if (!resp.ok) return;
    const json = (await resp.json()) as {
      response?: {
        folder_content?: {
          files?: Array<{
            filename?: string;
            quickkey?: string;
            size?: string;
            links?: { normal_download?: string };
          }>;
        };
      };
    };
    const files = json.response?.folder_content?.files || [];
    for (const file of files) {
      const filename = file.filename || "";
      if (!/\.(nsp|xci|nsz|nup|zip)$/i.test(filename)) continue;

      const downloadLink =
        file.links?.normal_download ||
        `https://www.mediafire.com/file/${file.quickkey || ""}/${filename}/file`;
      const bytes = Number.parseInt(file.size || "", 10);
      const sizeFormatted = Number.isFinite(bytes)
        ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
        : "";

      const tidMatch = TITLE_ID_REGEX.exec(filename);
      const target =
        (tidMatch?.[1] && byTid.get(tidMatch[1].toUpperCase())) ||
        byNorm.get(this.normalizeTitle(filename));

      if (target) {
        matches[target.titleId] = {
          titleId: target.titleId,
          gameTitle: target.title,
          matchedVersion: target.versionTested,
          downloadURL: downloadLink,
          isTorrent: false,
          fileSizeFormatted: sizeFormatted,
          sourceId: source.id,
          sourceName: source.name,
        };
      }
    }
  }

  private static isGoogleDriveFile(url: URL): boolean {
    return (
      url.hostname.includes("drive.google.com") &&
      (url.pathname.includes("/file/d/") || url.searchParams.has("id"))
    );
  }

  private static extractGoogleDriveFileId(url: URL): string | null {
    const m = /(?:\b\/file\/d\/|id=)([a-zA-Z0-9_-]{25,})/.exec(url.toString());
    return m?.[1] || url.searchParams.get("id");
  }

  private static async resolveGoogleDriveFile(
    fileId: string,
    originalUrl: string,
    source: DownloadSource,
    byTid: Map<string, NxCompatibleGame>,
    byNorm: Map<string, NxCompatibleGame>,
    matches: Record<string, NxCloudAvailableGame>
  ): Promise<void> {
    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    const resp = await fetch(originalUrl, { headers: FETCH_HEADERS });
    if (!resp.ok) return;
    const html = await resp.text();
    const titleMatch = /<title>(.*?) - Google Drive<\/title>/i.exec(html);
    const filename = titleMatch?.[1]?.trim() || source.name;
    const tidMatch = TITLE_ID_REGEX.exec(filename);
    const target =
      (tidMatch?.[1] && byTid.get(tidMatch[1].toUpperCase())) ||
      byNorm.get(this.normalizeTitle(filename));

    if (target) {
      matches[target.titleId] = {
        titleId: target.titleId,
        gameTitle: target.title,
        matchedVersion: target.versionTested,
        downloadURL: directUrl,
        isTorrent: false,
        fileSizeFormatted: "",
        sourceId: source.id,
        sourceName: source.name,
      };
    }
  }
}
