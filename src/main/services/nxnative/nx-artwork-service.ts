import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WindowManager } from "@main/services/window-manager";
import { AppLogHub } from "@main/services/app-log-hub";
import { IgdbService } from "@main/services/igdb-service";
import {
  baseApplicationTitleId,
  extractArtworkUrls,
  normalizeSwitchTitle,
  scoreSwitchTitleMatch,
} from "./nx-core-parsers";
import { NxPathsService } from "./nx-paths";

const execFileAsync = promisify(execFile);

export interface ArtworkQuery {
  titleId?: string | null;
  title?: string | null;
  switchPortedAppPath?: string | null;
  switchPortedIpaPath?: string | null;
  objectId?: string | null;
}

interface ParsedArtworkEntry {
  titleId: string;
  name: string;
  foldedName: string;
  iconUrl: string | null;
  bannerUrl: string | null;
}

interface ArtworkDatabaseIndex {
  byTid: Map<string, ParsedArtworkEntry>;
  byFoldedName: Map<string, ParsedArtworkEntry>;
  entries: ParsedArtworkEntry[];
}

interface OnlineArtworkCacheRecord {
  coverUrl?: string | null;
  heroUrl?: string | null;
  localCoverPath?: string | null;
  localHeroPath?: string | null;
  negativeUntil?: number;
}

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"] as const;
const ONLINE_NEGATIVE_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_VALID_IMAGE_BYTES = 512;

/**
 * Verified Nintendo Switch Title ID -> GameTDB 5-character product codes.
 * Ported directly from GameTDBVerifiedDatabase.swift for 1:1 cover parity.
 */
export const GAME_TDB_VERIFIED_IDS: Record<string, readonly string[]> = {
  "0100000000010000": ["AAACA", "AAACB"],
  "0100000011D90000": ["AX7QA"],
  "010005501E68C000": ["BG9VA"],
  "010012101468C000": ["A3SDA"],
  "010013C00E930000": ["AUSUA"],
  "010014C011146000": ["AY7RA"],
  "010014E00DB56000": ["ATPMB", "ATPMA"],
  "010015100B514000": ["AQMXA"],
  "0100152000022000": ["AABPA", "AABPB"],
  "010016100A186000": ["AK9NA"],
  "0100199023B2E000": ["BQBEB"],
  "01001F5010DFA000": ["AW7KA"],
  "010020400E1C2000": ["AEK3B", "AEK3A"],
  "010020D01AD24000": ["BCCHA"],
  "0100217023F6C000": ["BQQFA"],
  "010028600EBDA000": ["AUZPA"],
  "010029B0118E8000": ["A5FDA"],
  "010029B018432000": ["A8VEA"],
  "01002B00111A2000": ["AXEAA", "AXEAB"],
  "01002B30028F6000": ["ACF3A"],
  "01002CD00A51C000": ["APDEA"],
  "01002DA013484000": ["AZ89A"],
  "01002E7016C46000": ["A6YYA"],
  "0100300012F2A000": ["AZRMA"],
  "0100317013770000": ["A2G7A", "A2G7B"],
  "010031F019294000": ["A923A"],
  "010032E00E6E2000": ["AULSA"],
  "0100346017304000": ["A7G4A"],
  "010036E00FB20000": ["AV3JA", "AV3JB"],
  "010038600B27E000": ["AQDUA"],
  "010038B015560000": ["A43UA"],
  "01003E601E324000": ["BGX2A"],
  "01003FC01670C000": ["A3RVA", "A3RVB", "A3RVC"],
  "010040801A4C8000": ["BBLYA"],
  "0100429011144000": ["AX4CA"],
  "010045C014650000": ["A3RVB", "A3RVA", "A3RVC"],
  "01004A4010FEA000": ["AXB7A"],
  "01004AB00A260000": ["AK63B", "AK63A"],
  "01004D300C5AE000": ["ARZGA"],
  "010051701FB46000": ["BKCRA"],
  "01005270232F2000": ["BPRWA"],
  "0100535012974000": ["AY9RA", "AY9R1"],
  "010054B01AD92000": ["BACCC", "BACCA", "BACCB"],
  "010055D009F78000": ["ANVYA"],
  "010056B015FE8000": ["A532A", "A532B"],
  "010057D006492000": ["AGY7A", "AGY7B", "AGY7E"],
  "01005CA01580E000": ["A42UC", "A42UA"],
  "01006000040C2000": ["AEA2A", "AEA2B"],
  "0100620012D6E000": ["AZLSA"],
  "010062B01525C000": ["A4TQA"],
  "0100633007D48000": ["AKLHA"],
  "010063301BD50000": ["BDPZA"],
  "0100646009FBE000": ["ANXTB"],
  "010067300059A000": ["AV3DA"],
  "010069401ADB8000": ["BACCA", "BACCB", "BACCC"],
  "0100698009C6E000": ["ANKSA"],
  "010069C01AB82000": ["BBXAA", "BBXAB", "BBXAC"],
  "01006A800016E000": ["AAABA"],
  "01006BB00C6F0000": ["AR3NA"],
  "01006C300E9F0000": ["ALC7C", "ALC7E", "ALC7A"],
  "01006F8002326000": ["ACBAA"],
  "01006FE013472000": ["AZ82A"],
  "0100713016CCC000": ["A4EFA", "A4EFB", "A4EFC"],
  "01007300020FA000": ["AB48A"],
  "010074F013262000": ["AZ3HA"],
  "010076F0049A2000": ["AE99A"],
  "01007960049A0000": ["AE98A"],
  "01007BB017812000": ["A7Z4A"],
  "01007EF00011E000": ["AAAAA"],
  "010086A022444000": ["BNQEA"],
  "010089B00D09C000": ["ASRPB", "ASRPA", "ASRPD"],
  "010089C01E9CA000": ["BHK6A"],
  "01008BC024FDE000": ["AMNPA", "AMNPB", "ASB4A"],
  "01008C0016544000": ["A6G7A"],
  "01008CF01BAAC000": ["BDGEA"],
  "01008D7016438000": ["A3RVC", "A3RVA", "A3RVB"],
  "01008DB008C2C000": ["ALZBA"],
  "01008F6008C5E000": ["ALZYA"],
  "010092B0091D0000": ["AMKCC"],
  "01009320084A4000": ["AK9RA"],
  "010093801237C000": ["AYL8A"],
  "0100965017338000": ["A7HLA"],
  "010099C022B96000": ["BN84A"],
  "01009BF0072D4000": ["AJH9A"],
  "01009D901BC56000": ["BDLWA"],
  "0100A00019DE0000": ["BA3FA"],
  "0100A3501946E000": ["A98RA"],
  "0100A3900C3E2000": ["ARUUA"],
  "0100A3D008C5C000": ["ALZXA"],
  "0100A5C00D162000": ["ASVUA", "ASVUG"],
  "0100A6301214E000": ["AYFNA"],
  "0100A83022A22000": ["BN47A"],
  "0100A9D01C446000": ["BD9VA", "BD9VB"],
  "0100ABD01785C000": ["A5FDA"],
  "0100ABF008968000": ["ALZAA"],
  "0100ACD0163D0000": ["A6DPA"],
  "0100AE00096EA000": ["AKUTB"],
  "0100B04011742000": ["AXSEA", "AXSEB"],
  "0100B7C00933A000": ["AMPYA"],
  "0100B8E016F76000": ["A532A"],
  "0100B99019412000": ["A97PA"],
  "0100BA4026E94000": ["BUBLA"],
  "0100BC0018138000": ["A8LUA"],
  "0100BC300CB48000": ["A3CHA"],
  "0100BF00112C0000": ["AJ2AC"],
  "0100C1F0051B6000": ["AFWTA"],
  "0100C2A01A730000": ["BBTCA", "BBTCC", "BBTCB"],
  "0100C49025D3E000": ["BSYBA"],
  "0100C510166F0000": ["A8ZBA"],
  "0100CA9002322000": ["ACATA"],
  "0100CC80140F8000": ["A3AWB"],
  "0100CD801CE5E000": ["BEYKA"],
  "0100CE4010AAC000": ["AUYRA", "AUYRB", "AUYRC"],
  "0100D5B026844000": ["BTU9A"],
  "0100D7C01F254000": ["BJEAA"],
  "0100D9F01D474000": ["BFLTA"],
  "0100DCA0064A6000": ["AG3JA"],
  "0100E44016C22000": ["A6YSA"],
  "0100E65002BB8000": ["ACPGA", "ACPGB"],
  "0100E95004038000": ["ADENB", "ADENA"],
  "0100EC9010258000": ["AWGWE"],
  "0100ECD018EBE000": ["A9QDA"],
  "0100F2C0115B6000": ["AXN7A"],
  "0100F43008C44000": ["ALZLA"],
  "0100F5D01DA3A000": ["BF7QA"],
  "0100FD8022DAA000": ["BPDLA"],
  "0100FF500E34A000": ["AUBQA"],
};

/**
 * Multi-tier Switch 1 & 2 artwork resolver and disk cache service aligned with
 * NxNative_Launcher (switch_titles_artwork.json, GameTDB, AppSupport/covers & artwork,
 * bundle icon extraction, Nintendo Europe Search API, and Steam Store Search API).
 */
export class NxArtworkService {
  private static dbPromise: Promise<ArtworkDatabaseIndex> | null = null;
  private static normIndexPromise: Promise<Map<string, string>> | null = null;
  private static onlineCache: Record<string, OnlineArtworkCacheRecord> | null =
    null;
  private static readonly inFlightEnsures = new Set<string>();

  /** Convert an absolute local filesystem path into a safe Electron `local:` URI. */
  public static toLocalUrl(filePath: string): string {
    return `local:${encodeURI(filePath).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
  }

  /** Clear in-memory caches (useful after manual settings/path changes). */
  public static clearCache(): void {
    this.dbPromise = null;
    this.normIndexPromise = null;
    this.onlineCache = null;
  }

  private static sanitizeKey(value: string): string {
    const folded = normalizeSwitchTitle(value) || value;
    const cleaned = folded
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (cleaned.length > 0 && cleaned.length <= 64) return cleaned;
    return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
  }

  private static resolveCanonicalKey(query: ArtworkQuery): string | null {
    const rawTid = query.titleId?.trim().toUpperCase();
    if (rawTid) {
      return baseApplicationTitleId(rawTid) ?? rawTid;
    }
    const title = query.title?.trim();
    if (title) return this.sanitizeKey(title);
    const objId = query.objectId?.trim();
    if (objId) return this.sanitizeKey(objId);
    return null;
  }

  private static isUsableFile(filePath: string): boolean {
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile() && stat.size > MIN_VALID_IMAGE_BYTES;
    } catch {
      return false;
    }
  }

  /** Load and index `switch_titles_artwork.json` from all candidate AppSupport/NxNative dirs. */
  public static async loadArtworkDatabase(): Promise<ArtworkDatabaseIndex> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = (async () => {
      const byTid = new Map<string, ParsedArtworkEntry>();
      const byFoldedName = new Map<string, ParsedArtworkEntry>();
      const entries: ParsedArtworkEntry[] = [];

      const searchDirs = await NxPathsService.getArtworkSearchDirectories();
      const candidates: string[] = [];
      for (const dir of searchDirs) {
        candidates.push(path.join(dir, "switch_titles_artwork.json"));
        candidates.push(
          path.join(dir, "artwork", "switch_titles_artwork.json")
        );
        candidates.push(path.join(dir, "covers", "switch_titles_artwork.json"));
      }
      candidates.push(
        "/Volumes/SSD FN501 PRO/Emulations/NativePort/nxnative/docs/images/switch_titles_artwork.json"
      );

      for (const filePath of candidates) {
        if (!fs.existsSync(filePath)) continue;
        try {
          const raw = JSON.parse(
            await fsp.readFile(filePath, "utf8")
          ) as Record<string, Record<string, unknown>>;
          for (const [tidRaw, item] of Object.entries(raw)) {
            if (!item || typeof item !== "object") continue;
            const titleId = tidRaw.trim().toUpperCase();
            const urls = extractArtworkUrls(item);
            if (!urls.icon && !urls.banner) continue;
            const name =
              typeof item.name === "string" ? item.name.trim() : titleId;
            const foldedName = normalizeSwitchTitle(name);
            const parsed: ParsedArtworkEntry = {
              titleId,
              name,
              foldedName,
              iconUrl: urls.icon,
              bannerUrl: urls.banner,
            };
            byTid.set(titleId, parsed);
            if (foldedName && !byFoldedName.has(foldedName)) {
              byFoldedName.set(foldedName, parsed);
            }
            entries.push(parsed);
          }
          AppLogHub.info(
            "nxnative",
            `Loaded ${entries.length} Switch artwork entries from ${filePath}`
          );
          break;
        } catch (err) {
          AppLogHub.warn(
            "nxnative",
            `Failed reading ${filePath}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      return { byTid, byFoldedName, entries };
    })();
    return this.dbPromise;
  }

  private static async loadNormTitleIndex(): Promise<Map<string, string>> {
    if (this.normIndexPromise) return this.normIndexPromise;
    this.normIndexPromise = (async () => {
      const map = new Map<string, string>();
      const dirs = await NxPathsService.getArtworkSearchDirectories();
      for (const dir of dirs) {
        const candidate = path.join(dir, "titles_norm_index_v1.tsv");
        if (!fs.existsSync(candidate)) continue;
        try {
          const text = await fsp.readFile(candidate, "utf8");
          for (const line of text.split(/\r?\n/)) {
            if (!line) continue;
            const tab = line.indexOf("\t");
            if (tab <= 0) continue;
            const tid = line.slice(0, tab).trim().toUpperCase();
            const norm = normalizeSwitchTitle(line.slice(tab + 1));
            if (tid && norm && !map.has(norm)) {
              map.set(norm, tid);
            }
          }
          break;
        } catch {
          // Ignore malformed TSV index
        }
      }
      return map;
    })();
    return this.normIndexPromise;
  }

  private static async getOnlineCachePath(): Promise<string> {
    const appSupport = await NxPathsService.getAppSupportDirectory();
    return path.join(appSupport, "artwork", "online_artwork_cache.json");
  }

  private static async loadOnlineCache(): Promise<
    Record<string, OnlineArtworkCacheRecord>
  > {
    if (this.onlineCache) return this.onlineCache;
    try {
      const cachePath = await this.getOnlineCachePath();
      if (fs.existsSync(cachePath)) {
        const parsed = JSON.parse(await fsp.readFile(cachePath, "utf8"));
        if (parsed && typeof parsed === "object") {
          this.onlineCache = parsed as Record<string, OnlineArtworkCacheRecord>;
          return this.onlineCache;
        }
      }
    } catch {
      // Ignore corrupt cache file
    }
    this.onlineCache = {};
    return this.onlineCache;
  }

  private static async saveOnlineCache(): Promise<void> {
    if (!this.onlineCache) return;
    try {
      const cachePath = await this.getOnlineCachePath();
      await fsp.mkdir(path.dirname(cachePath), { recursive: true });
      await fsp.writeFile(cachePath, JSON.stringify(this.onlineCache, null, 2));
    } catch {
      // Non-fatal
    }
  }

  private static async findLocalCachedAsset(
    keys: string[],
    suffixes: string[],
    subdirs: string[] = ["covers", "artwork", "banners", ""]
  ): Promise<string | null> {
    const dirs = await NxPathsService.getArtworkSearchDirectories();

    for (const key of keys) {
      if (!key) continue;
      const variants = Array.from(
        new Set([key, key.toUpperCase(), key.toLowerCase()])
      );
      for (const dir of dirs) {
        for (const sub of subdirs) {
          const baseDir = sub ? path.join(dir, sub) : dir;
          if (!fs.existsSync(baseDir)) continue;
          for (const variant of variants) {
            for (const suffix of suffixes) {
              for (const ext of IMAGE_EXTS) {
                const candidate = path.join(
                  baseDir,
                  `${variant}${suffix}${ext}`
                );
                if (this.isUsableFile(candidate)) {
                  return candidate;
                }
              }
            }
          }
        }
      }
    }
    return null;
  }

  private static findBundleResourceAsset(
    appPath: string | null | undefined,
    kind: "cover" | "hero"
  ): string | null {
    if (!appPath) return null;
    const resourcesDir = path.join(appPath, "Contents", "Resources");
    if (!fs.existsSync(resourcesDir)) return null;
    const stems =
      kind === "hero"
        ? ["banner", "hero", "splash", "background"]
        : ["cover", "artwork", "icon"];
    for (const stem of stems) {
      for (const ext of IMAGE_EXTS) {
        const candidate = path.join(resourcesDir, `${stem}${ext}`);
        if (this.isUsableFile(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  private static async resolveEntryForQuery(
    query: ArtworkQuery
  ): Promise<ParsedArtworkEntry | null> {
    const db = await this.loadArtworkDatabase();
    const rawTid = query.titleId?.trim().toUpperCase();
    const baseTid = rawTid ? (baseApplicationTitleId(rawTid) ?? rawTid) : null;

    if (baseTid && db.byTid.has(baseTid)) {
      return db.byTid.get(baseTid) ?? null;
    }
    if (rawTid && db.byTid.has(rawTid)) {
      return db.byTid.get(rawTid) ?? null;
    }

    const title = query.title?.trim();
    if (!title) return null;

    const folded = normalizeSwitchTitle(title);
    if (folded && db.byFoldedName.has(folded)) {
      return db.byFoldedName.get(folded) ?? null;
    }

    let best: ParsedArtworkEntry | null = null;
    let bestScore = 0;
    for (const entry of db.entries) {
      const score = scoreSwitchTitleMatch(title, entry.name);
      if (score >= 0.78 && score > bestScore) {
        bestScore = score;
        best = entry;
        if (score >= 0.99) break;
      }
    }
    return best;
  }

  /** Build candidate GameTDB URLs for a verified Title ID. */
  public static getGameTdbCandidateUrls(titleId?: string | null): string[] {
    if (!titleId) return [];
    const upper = titleId.trim().toUpperCase();
    const baseTid = baseApplicationTitleId(upper) ?? upper;
    const codes =
      GAME_TDB_VERIFIED_IDS[baseTid] ?? GAME_TDB_VERIFIED_IDS[upper];
    if (!codes?.length) return [];
    const urls: string[] = [];
    for (const code of codes) {
      urls.push(`https://art.gametdb.com/switch/coverHQ/US/${code}.jpg`);
      urls.push(`https://art.gametdb.com/switch/coverHQ/EN/${code}.jpg`);
      urls.push(`https://art.gametdb.com/switch/cover/US/${code}.jpg`);
      urls.push(`https://art.gametdb.com/switch/coverM/US/${code}.jpg`);
    }
    return urls;
  }

  private static async extractIconFromBundles(
    cacheKey: string,
    query: ArtworkQuery
  ): Promise<string | null> {
    const appSupport = await NxPathsService.getAppSupportDirectory();
    const coversDir = path.join(appSupport, "covers");
    const targetPng = path.join(coversDir, `${cacheKey}_icon.png`);
    if (this.isUsableFile(targetPng)) return targetPng;

    if (query.switchPortedAppPath) {
      const resourcesDir = path.join(
        query.switchPortedAppPath,
        "Contents",
        "Resources"
      );
      if (fs.existsSync(resourcesDir)) {
        const directIcns = path.join(resourcesDir, "AppIcon.icns");
        let icnsPath = fs.existsSync(directIcns) ? directIcns : null;
        if (!icnsPath) {
          try {
            const firstIcns = fs
              .readdirSync(resourcesDir)
              .find((entry) => entry.toLowerCase().endsWith(".icns"));
            if (firstIcns) icnsPath = path.join(resourcesDir, firstIcns);
          } catch {
            // Ignore unreadable Resources directory
          }
        }
        if (icnsPath) {
          try {
            await fsp.mkdir(coversDir, { recursive: true });
            await execFileAsync(
              "/usr/bin/sips",
              ["-s", "format", "png", icnsPath, "--out", targetPng],
              { timeout: 5000 }
            );
            if (this.isUsableFile(targetPng)) return targetPng;
          } catch {
            // Fall through to IPA check
          }
        }
      }
    }

    if (query.switchPortedIpaPath && fs.existsSync(query.switchPortedIpaPath)) {
      try {
        const { stdout } = await execFileAsync(
          "/usr/bin/unzip",
          ["-Z1", query.switchPortedIpaPath],
          { timeout: 6000, maxBuffer: 2 * 1024 * 1024 }
        );
        const iconEntries = stdout
          .split(/\r?\n/)
          .filter((entry) =>
            /^Payload\/[^/]+\.app\/.*AppIcon.*\.png$/i.test(entry)
          )
          .sort((a, b) => b.length - a.length);
        const bestEntry = iconEntries[0];
        if (bestEntry) {
          const { stdout: pngBuf } = await execFileAsync(
            "/usr/bin/unzip",
            ["-p", query.switchPortedIpaPath, bestEntry],
            { timeout: 6000, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 }
          );
          if (pngBuf.length > MIN_VALID_IMAGE_BYTES) {
            await fsp.mkdir(coversDir, { recursive: true });
            await fsp.writeFile(targetPng, pngBuf);
            return targetPng;
          }
        }
      } catch {
        // Non-fatal
      }
    }

    return null;
  }

  private static async inferTitleIdForQuery(
    query: ArtworkQuery,
    entry: ParsedArtworkEntry | null
  ): Promise<string | null> {
    if (query.titleId) {
      const upper = query.titleId.trim().toUpperCase();
      return baseApplicationTitleId(upper) ?? upper;
    }
    if (entry?.titleId) return entry.titleId;
    const title = query.title?.trim();
    if (!title) return null;
    const folded = normalizeSwitchTitle(title);
    if (!folded) return null;
    const normMap = await this.loadNormTitleIndex();
    if (normMap.has(folded)) return normMap.get(folded) ?? null;
    return null;
  }

  /**
   * 9-level cover resolution for a Switch 1 / 2 game:
   * 1. Disk cache (`covers/` & `artwork/` across AppSupport search dirs)
   * 2. Online cache local file
   * 3. `.app` bundled cover/icon image
   * 4. `switch_titles_artwork.json` matched by Base TID
   * 5. `switch_titles_artwork.json` matched by token-scored title (`>= 0.78`)
   * 6. `GAME_TDB_VERIFIED_IDS` direct coverHQ URL
   * 7. Online cache remote URL (Nintendo Europe / Steam)
   * 8. Local extracted `.app` `AppIcon.icns` / `.ipa` AppIcon cached as `<key>_icon.png`
   * 9. Banner fallback / null
   */
  public static async resolveCoverForGame(
    query: ArtworkQuery
  ): Promise<string | null> {
    const entry = await this.resolveEntryForQuery(query);
    const effectiveTid = await this.inferTitleIdForQuery(query, entry);
    const keyCandidates = Array.from(
      new Set(
        [
          effectiveTid,
          query.titleId?.trim().toUpperCase(),
          query.title ? this.sanitizeKey(query.title) : null,
          query.objectId ? this.sanitizeKey(query.objectId) : null,
        ].filter((v): v is string => Boolean(v))
      )
    );

    const diskCover = await this.findLocalCachedAsset(keyCandidates, [""]);
    if (diskCover) return this.toLocalUrl(diskCover);

    const online = await this.loadOnlineCache();
    for (const k of keyCandidates) {
      const rec = online[k];
      if (rec?.localCoverPath && this.isUsableFile(rec.localCoverPath)) {
        return this.toLocalUrl(rec.localCoverPath);
      }
    }

    const bundleCover = this.findBundleResourceAsset(
      query.switchPortedAppPath,
      "cover"
    );
    if (bundleCover) return this.toLocalUrl(bundleCover);

    if (entry?.iconUrl) return entry.iconUrl;
    if (entry?.bannerUrl) return entry.bannerUrl;

    const gametdbUrls = this.getGameTdbCandidateUrls(effectiveTid);
    if (gametdbUrls.length > 0) return gametdbUrls[0];

    for (const k of keyCandidates) {
      const rec = online[k];
      if (rec?.coverUrl) return rec.coverUrl;
    }

    const canonicalKey = keyCandidates[0] ?? this.resolveCanonicalKey(query);
    if (canonicalKey) {
      const cachedExtractedIcon = await this.findLocalCachedAsset(
        keyCandidates,
        ["_icon"]
      );
      if (cachedExtractedIcon) return this.toLocalUrl(cachedExtractedIcon);
      const extracted = await this.extractIconFromBundles(canonicalKey, query);
      if (extracted) return this.toLocalUrl(extracted);
    }

    return null;
  }

  /**
   * Fast batch cover resolution across disk cache, online cache, artwork JSON and GameTDB.
   * Scans candidate directories once so Switch 1 & 2 catalog lists get local/remote covers immediately.
   */
  public static async resolveCoversForBatch(
    games: Array<{ titleId: string; title: string }>
  ): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    if (!games.length) return results;

    const [dirs, online, artworkDb] = await Promise.all([
      NxPathsService.getArtworkSearchDirectories(),
      this.loadOnlineCache(),
      this.loadArtworkDatabase(),
    ]);

    const diskByStem = new Map<string, string>();
    const validExts = new Set<string>(IMAGE_EXTS);
    const subdirs = ["covers", "artwork", "banners", ""];

    for (const dir of dirs) {
      for (const sub of subdirs) {
        const baseDir = sub ? path.join(dir, sub) : dir;
        if (!fs.existsSync(baseDir)) continue;
        try {
          for (const entry of fs.readdirSync(baseDir)) {
            const ext = path.extname(entry).toLowerCase();
            if (!validExts.has(ext)) continue;
            const stem = path.basename(entry, ext).toUpperCase();
            if (stem.endsWith("_HERO") || stem.endsWith("_BANNER")) continue;
            const fullPath = path.join(baseDir, entry);
            if (!diskByStem.has(stem) && this.isUsableFile(fullPath)) {
              diskByStem.set(stem, fullPath);
            }
          }
        } catch {
          // ignore unreadable dir
        }
      }
    }

    for (const game of games) {
      const upperTid = game.titleId.trim().toUpperCase();
      const baseTid = baseApplicationTitleId(upperTid) ?? upperTid;
      const sanitizedTitle = game.title
        ? this.sanitizeKey(game.title).toUpperCase()
        : "";
      const keys = [baseTid, upperTid, sanitizedTitle].filter(Boolean);

      let resolved: string | null = null;
      for (const key of keys) {
        const diskPath = diskByStem.get(key);
        if (diskPath) {
          resolved = this.toLocalUrl(diskPath);
          break;
        }
      }

      if (!resolved) {
        for (const key of keys) {
          const rec = online[key] ?? online[key.toLowerCase()];
          if (rec?.localCoverPath && this.isUsableFile(rec.localCoverPath)) {
            resolved = this.toLocalUrl(rec.localCoverPath);
            break;
          }
        }
      }

      if (!resolved) {
        const dbEntry =
          artworkDb.byTid.get(baseTid) ??
          artworkDb.byTid.get(upperTid) ??
          (game.title
            ? artworkDb.byFoldedName.get(normalizeSwitchTitle(game.title))
            : undefined);
        if (dbEntry?.iconUrl) resolved = dbEntry.iconUrl;
        else if (dbEntry?.bannerUrl) resolved = dbEntry.bannerUrl;
      }

      if (!resolved) {
        for (const key of keys) {
          const rec = online[key] ?? online[key.toLowerCase()];
          if (rec?.coverUrl) {
            resolved = rec.coverUrl;
            break;
          }
        }
      }

      if (!resolved) {
        const tdb = this.getGameTdbCandidateUrls(baseTid);
        if (tdb.length > 0) resolved = tdb[0];
      }

      results.set(upperTid, resolved);
    }

    return results;
  }

  /** Resolve wide hero/banner artwork for a Switch 1 / 2 game with cover fallback. */
  public static async resolveHeroForGame(
    query: ArtworkQuery
  ): Promise<string | null> {
    const entry = await this.resolveEntryForQuery(query);
    const effectiveTid = await this.inferTitleIdForQuery(query, entry);
    const keyCandidates = Array.from(
      new Set(
        [
          effectiveTid,
          query.titleId?.trim().toUpperCase(),
          query.title ? this.sanitizeKey(query.title) : null,
          query.objectId ? this.sanitizeKey(query.objectId) : null,
        ].filter((v): v is string => Boolean(v))
      )
    );

    const diskHero =
      (await this.findLocalCachedAsset(keyCandidates, ["_hero", "_banner"])) ??
      (await this.findLocalCachedAsset(
        keyCandidates,
        [""],
        ["artwork", "banners"]
      ));
    if (diskHero) {
      return this.toLocalUrl(diskHero);
    }

    const online = await this.loadOnlineCache();
    for (const k of keyCandidates) {
      const rec = online[k];
      if (rec?.localHeroPath && this.isUsableFile(rec.localHeroPath)) {
        return this.toLocalUrl(rec.localHeroPath);
      }
    }

    const bundleHero = this.findBundleResourceAsset(
      query.switchPortedAppPath,
      "hero"
    );
    if (bundleHero) return this.toLocalUrl(bundleHero);

    if (entry?.bannerUrl) return entry.bannerUrl;

    for (const k of keyCandidates) {
      const rec = online[k];
      if (rec?.heroUrl) return rec.heroUrl;
    }

    return this.resolveCoverForGame(query);
  }

  private static detectImageExtension(
    buffer: Buffer,
    contentType: string | null,
    url: string
  ): ".jpg" | ".png" | ".webp" | null {
    if (buffer.length < MIN_VALID_IMAGE_BYTES) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return ".jpg";
    }
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return ".png";
    }
    if (
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return ".webp";
    }
    const lowerCt = (contentType || "").toLowerCase();
    if (lowerCt.includes("image/jpeg") || lowerCt.includes("image/jpg")) {
      return ".jpg";
    }
    if (lowerCt.includes("image/png")) return ".png";
    if (lowerCt.includes("image/webp")) return ".webp";
    if (lowerCt.startsWith("image/") && /\.png(\?|$)/i.test(url)) return ".png";
    if (lowerCt.startsWith("image/")) return ".jpg";
    return null;
  }

  private static async downloadImageToFile(
    url: string,
    targetBasePath: string
  ): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "CerberusLauncher/1.0 NxArtwork",
          Accept: "image/*,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      const buf = Buffer.from(arr);
      const ext = this.detectImageExtension(
        buf,
        res.headers.get("content-type"),
        url
      );
      if (!ext) return null;
      await fsp.mkdir(path.dirname(targetBasePath), { recursive: true });
      const outPath = `${targetBasePath}${ext}`;
      await fsp.writeFile(outPath, buf);
      return outPath;
    } catch {
      return null;
    }
  }

  private static async queryNintendoEuropeArtwork(
    title: string
  ): Promise<{ coverUrl: string | null; heroUrl: string | null }> {
    const clean = title
      .replace(/™|®|©/g, "")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .trim();
    if (clean.length < 2) return { coverUrl: null, heroUrl: null };
    try {
      const url = `https://searching.nintendo-europe.com/en/select?q=${encodeURIComponent(clean)}&fq=type:GAME&rows=8&wt=json`;
      const res = await fetch(url, {
        headers: { "User-Agent": "CerberusLauncher/1.0" },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) return { coverUrl: null, heroUrl: null };
      const data = (await res.json()) as {
        response?: {
          docs?: Array<{
            title?: string;
            image_url_sq_s?: string;
            image_url?: string;
            image_url_h2x1_s?: string;
          }>;
        };
      };
      const docs = data?.response?.docs ?? [];
      let bestDoc: (typeof docs)[number] | null = null;
      let bestScore = 0;
      for (const doc of docs) {
        if (!doc.title) continue;
        const score = scoreSwitchTitleMatch(clean, doc.title);
        if (score >= 0.65 && score > bestScore) {
          bestScore = score;
          bestDoc = doc;
        }
      }
      if (!bestDoc) return { coverUrl: null, heroUrl: null };
      const normalizeHttps = (raw?: string): string | null => {
        if (!raw) return null;
        return raw.startsWith("//") ? `https:${raw}` : raw;
      };
      return {
        coverUrl:
          normalizeHttps(bestDoc.image_url_sq_s) ??
          normalizeHttps(bestDoc.image_url),
        heroUrl:
          normalizeHttps(bestDoc.image_url_h2x1_s) ??
          normalizeHttps(bestDoc.image_url),
      };
    } catch {
      return { coverUrl: null, heroUrl: null };
    }
  }

  private static async querySteamStoreArtwork(
    title: string
  ): Promise<{ coverUrl: string | null; heroUrl: string | null }> {
    const clean = title
      .replace(/™|®|©/g, "")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .trim();
    if (clean.length < 2) return { coverUrl: null, heroUrl: null };
    try {
      const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(clean)}&l=english&cc=US`;
      const res = await fetch(url, {
        headers: { "User-Agent": "CerberusLauncher/1.0" },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) return { coverUrl: null, heroUrl: null };
      const data = (await res.json()) as {
        items?: Array<{ id?: number; name?: string; tiny_image?: string }>;
      };
      const items = data?.items ?? [];
      let bestId: number | null = null;
      let bestScore = 0;
      for (const item of items) {
        if (!item.name || !item.id) continue;
        const score = scoreSwitchTitleMatch(clean, item.name);
        if (score >= 0.72 && score > bestScore) {
          bestScore = score;
          bestId = item.id;
        }
      }
      if (!bestId) return { coverUrl: null, heroUrl: null };
      return {
        coverUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${bestId}/library_600x900.jpg`,
        heroUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${bestId}/library_hero.jpg`,
      };
    } catch {
      return { coverUrl: null, heroUrl: null };
    }
  }

  /**
   * Background-download and disk-cache missing covers/heroes for Switch 1 / 2 titles
   * up to `concurrency` parallel downloads, then notify open windows to refresh.
   */
  public static async ensureCoversForGames(
    games: ArtworkQuery[],
    concurrency = 4
  ): Promise<number> {
    if (!games.length) return 0;

    const appSupport = await NxPathsService.getAppSupportDirectory();
    const coversDir = path.join(appSupport, "covers");
    const online = await this.loadOnlineCache();
    const now = Date.now();

    const queue: Array<{ key: string; query: ArtworkQuery }> = [];
    const seenKeys = new Set<string>();

    for (const game of games) {
      const entry = await this.resolveEntryForQuery(game);
      const effectiveTid = await this.inferTitleIdForQuery(game, entry);
      const key = effectiveTid || this.resolveCanonicalKey(game);
      if (!key || seenKeys.has(key) || this.inFlightEnsures.has(key)) {
        continue;
      }

      const existingLocal = await this.findLocalCachedAsset(
        [key, game.title ? this.sanitizeKey(game.title) : ""].filter(Boolean),
        [""]
      );
      if (existingLocal) continue;

      const negUntil = online[key]?.negativeUntil ?? 0;
      if (negUntil > now) continue;

      seenKeys.add(key);
      this.inFlightEnsures.add(key);
      queue.push({
        key,
        query: { ...game, titleId: effectiveTid ?? game.titleId },
      });
    }

    if (!queue.length) return 0;

    let updatedCount = 0;
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(concurrency, queue.length));

    const worker = async () => {
      while (cursor < queue.length) {
        const current = queue[cursor++];
        if (!current) break;
        const { key, query } = current;
        try {
          const entry = await this.resolveEntryForQuery(query);
          const coverCandidates: string[] = [];
          const heroCandidates: string[] = [];

          if (entry?.iconUrl) coverCandidates.push(entry.iconUrl);
          coverCandidates.push(...this.getGameTdbCandidateUrls(query.titleId));
          if (entry?.bannerUrl) heroCandidates.push(entry.bannerUrl);

          let localCoverPath: string | null = null;
          for (const url of coverCandidates) {
            localCoverPath = await this.downloadImageToFile(
              url,
              path.join(coversDir, key)
            );
            if (localCoverPath) break;
          }

          let onlineUrls: { coverUrl: string | null; heroUrl: string | null } =
            { coverUrl: null, heroUrl: null };
          if (!localCoverPath && query.title) {
            onlineUrls = await this.queryNintendoEuropeArtwork(query.title);
            if (!onlineUrls.coverUrl) {
              onlineUrls = await this.querySteamStoreArtwork(query.title);
            }
            if (!onlineUrls.coverUrl) {
              const isSwitch2 =
                key.startsWith("0400") ||
                Boolean(query.titleId?.trim().toUpperCase().startsWith("0400"));
              const igdb = await IgdbService.fetchGameDetailsByTitle(
                query.title,
                isSwitch2 ? "switch2" : "switch1"
              ).catch(() => null);
              if (igdb?.coverUrl) {
                onlineUrls = {
                  coverUrl: igdb.coverUrl,
                  heroUrl: igdb.heroUrl ?? null,
                };
              }
            }
            if (onlineUrls.coverUrl) {
              localCoverPath = await this.downloadImageToFile(
                onlineUrls.coverUrl,
                path.join(coversDir, key)
              );
            }
            if (onlineUrls.heroUrl) {
              heroCandidates.unshift(onlineUrls.heroUrl);
            }
          }

          let localHeroPath: string | null = null;
          for (const hUrl of heroCandidates) {
            localHeroPath = await this.downloadImageToFile(
              hUrl,
              path.join(coversDir, `${key}_hero`)
            );
            if (localHeroPath) break;
          }

          if (!localCoverPath) {
            localCoverPath = await this.extractIconFromBundles(key, query);
          }

          if (localCoverPath || localHeroPath || onlineUrls.coverUrl) {
            online[key] = {
              coverUrl: onlineUrls.coverUrl ?? entry?.iconUrl ?? null,
              heroUrl: onlineUrls.heroUrl ?? entry?.bannerUrl ?? null,
              localCoverPath,
              localHeroPath,
            };
            updatedCount++;
          } else {
            online[key] = {
              negativeUntil: Date.now() + ONLINE_NEGATIVE_TTL_MS,
            };
          }
        } catch {
          // Continue processing other titles
        } finally {
          this.inFlightEnsures.delete(key);
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    await this.saveOnlineCache();

    if (updatedCount > 0) {
      WindowManager.sendToAppWindows("on-nx-library-updated", {
        source: "artwork-cache",
        updatedCount,
      });
    }

    return updatedCount;
  }
}
