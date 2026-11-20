import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { NxCompatibleGame } from "@types";
import {
  nxCloudStreamsSublevel,
  nxCompatibilityCacheSublevel,
} from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { AppLogHub } from "@main/services/app-log-hub";
import { NxArtworkService } from "./nx-artwork-service";
import { extractArtworkUrls, scoreSwitchTitleMatch } from "./nx-core-parsers";
import { NxPathsService } from "./nx-paths";

const SEEDDS_README_URL =
  "https://raw.githubusercontent.com/seedds/nxnative/main/dm/games/README.md";
const NX2ANDROID_README_URL =
  "https://raw.githubusercontent.com/shirai91/nx2android/main/README.md";

const FALLBACK_RECENT_TIMESTAMPS: Record<string, number> = {
  "0100A3900C3E2000": 1793207710,
  "01002E7016C46000": 1793201662,
  "01001F5010DFA000": 1793195846,
  "0100965017338000": 1793195495,
  "0100FF500E34A000": 1793183436,
  "0100B8A026F14000": 1793180603,
  "0100606026F12000": 1793180600,
  "010062B01525C000": 1793176619,
  "0100B8E016F76000": 1793158157,
  "010056B015FE8000": 1793158150,
  "010067300059A000": 1793147162,
  "0100BC300CB48000": 1793142784,
  "0100D5B026844000": 1793128039,
  "0100698009C6E000": 1793127142,
  "010040801A4C8000": 1793123718,
  "010032E00E6E2000": 1793123433,
  "0100E95004038000": 1793102788,
  "010045C014650000": 1793098225,
  "0100CE4010AAC000": 1793097474,
  "0100A3D008C5C000": 1793085542,
  "01006000040C2000": 1793070812,
  "010074F013262000": 1793059085,
  "0100317013770000": 1793056426,
  "01004D300C5AE000": 1793040665,
  "01009D901BC56000": 1793031222,
};

interface AndroidCompatEntry {
  title: string;
  versionSummary: string;
  gpuTier: string;
  androidReq: string;
}

interface ArtworkEntry {
  name?: string;
  icon?: string;
  banner?: string;
  iconUrl?: string;
  bannerUrl?: string;
  category?: string[];
}

export class NxCompatibilityService {
  private static cachedGames: NxCompatibleGame[] = [];
  private static artworkDb: Record<string, ArtworkEntry> | null = null;
  private static localTsvTitleMap: Map<string, string> | null = null;
  private static verifiedSteamAppIdCache = new Map<string, string | null>();

  public static strictAlphaNum(raw: string): string {
    return raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  private static stripRegionalSuffix(title: string): string {
    return title
      .replace(
        /(,?\s*(Asian|Japanese|Chinese)\s+release|\s*\((Asian|Japan|Japanese|Chinese)(\s+release)?\))/gi,
        ""
      )
      .trim();
  }

  private static async loadArtworkDatabase(): Promise<
    Record<string, ArtworkEntry>
  > {
    if (this.artworkDb) return this.artworkDb;
    const searchDirs = await NxPathsService.getArtworkSearchDirectories();
    const nxRepo = await NxPathsService.resolveNxnativePath();
    const candidates: string[] = [];
    for (const dir of searchDirs) {
      candidates.push(path.join(dir, "switch_titles_artwork.json"));
      candidates.push(path.join(dir, "artwork", "switch_titles_artwork.json"));
      candidates.push(path.join(dir, "covers", "switch_titles_artwork.json"));
    }
    candidates.push(
      path.join(nxRepo.path, "docs", "images", "switch_titles_artwork.json"),
      "/Volumes/SSD FN501 PRO/Emulations/NativePort/nxnative/docs/images/switch_titles_artwork.json"
    );
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        try {
          const parsed = JSON.parse(
            fs.readFileSync(filePath, "utf8")
          ) as Record<string, ArtworkEntry>;
          this.artworkDb = parsed;
          return parsed;
        } catch {
          // ignore corrupted file
        }
      }
    }
    this.artworkDb = {};
    return this.artworkDb;
  }

  private static resolveArtworkCoverFromMap(
    titleId: string,
    artworkDb: Record<string, ArtworkEntry>
  ): { art: ArtworkEntry | undefined; coverUrl: string | null } {
    const art =
      artworkDb[titleId] ||
      artworkDb[titleId.toUpperCase()] ||
      artworkDb[titleId.toLowerCase()];
    const urls = extractArtworkUrls(art as Record<string, unknown> | undefined);
    const gameTdbFallback =
      NxArtworkService.getGameTdbCandidateUrls(titleId)[0] ?? null;
    return {
      art,
      coverUrl: urls.icon || urls.banner || gameTdbFallback,
    };
  }

  private static loadAddedTimestamps(
    nxnativePath: string
  ): Record<string, number> {
    const result: Record<string, number> = { ...FALLBACK_RECENT_TIMESTAMPS };
    if (!nxnativePath || !fs.existsSync(path.join(nxnativePath, ".git"))) {
      return result;
    }

    try {
      const output = execFileSync(
        "/usr/bin/git",
        [
          "-C",
          nxnativePath,
          "log",
          "--diff-filter=A",
          "--name-only",
          "--format=TS:%ct",
          "--",
          "dm/games/*/game.tsv",
        ],
        { encoding: "utf8", timeout: 5000, maxBuffer: 5 * 1024 * 1024 }
      );
      let currentTs = 0;
      for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.startsWith("TS:")) {
          currentTs = Number.parseInt(line.slice(3), 10) || 0;
        } else if (
          line.startsWith("dm/games/") &&
          line.endsWith("/game.tsv") &&
          currentTs > 0
        ) {
          const parts = line.split("/");
          if (parts.length >= 3) {
            const tid = parts[2].toUpperCase();
            if (!result[tid] || currentTs > result[tid]) {
              result[tid] = currentTs;
            }
          }
        }
      }
    } catch {
      // Fallback timestamps remain active
    }
    return result;
  }

  private static resolveSpecs(
    titleId: string,
    engine: string,
    versionTested: string,
    nxnativePath?: string
  ): {
    macReq: string;
    iosReq: string;
    storageReq: string;
    minRamGB: number;
    minChipTier: string;
  } {
    const tid = titleId.toUpperCase();
    const isSwitch2 = tid.startsWith("0400");
    const engLower = engine.toLowerCase();
    const verLower = versionTested.toLowerCase();
    const isUnreal = engLower.includes("unreal");

    const candidateGameDirs = [
      nxnativePath ? path.join(nxnativePath, "dm", "games", tid) : "",
      `/Volumes/SSD FN501 PRO/Emulations/NativePort/nxnative/dm/games/${tid}`,
    ].filter(Boolean);

    const baseDir = candidateGameDirs.find((d) => fs.existsSync(d)) || "";
    const tsvPath = baseDir ? path.join(baseDir, "game.tsv") : "";
    const readmePath = baseDir ? path.join(baseDir, "README.md") : "";

    let memReserve = 0x100000000n;
    let appPool = 0xcd500000n;
    let sysResource = 0n;
    let foundTsv = false;

    if (tsvPath && fs.existsSync(tsvPath)) {
      try {
        const tsvContent = fs.readFileSync(tsvPath, "utf8");
        foundTsv = true;
        for (const rawLine of tsvContent.split(/\r?\n/)) {
          const trimmed = rawLine.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const parts = trimmed.split("\t");
          if (parts.length < 2) continue;
          const key = parts[0].trim();
          const valStr = parts[1].split("#")[0].trim();
          const cleanHex = valStr.toLowerCase().replace(/^0x/, "");
          try {
            if (key === "mem_reserve") {
              memReserve = BigInt(`0x${cleanHex}`);
            } else if (key === "app_pool") {
              appPool = BigInt(`0x${cleanHex}`);
            } else if (key === "sys_resource") {
              sysResource = valStr.toLowerCase().startsWith("0x")
                ? BigInt(`0x${cleanHex}`)
                : BigInt(valStr);
            }
          } catch {
            // ignore unparsable row
          }
        }
      } catch {
        // ignore read error
      }
    }

    let storageReq = "HD: ~6 GB";
    let maxResidentGB: number | null = null;
    if (readmePath && fs.existsSync(readmePath)) {
      try {
        const rmContent = fs.readFileSync(readmePath, "utf8");
        const storageMatch = rmContent.match(
          /(?:IPA|RomFS|app|game)[^\n\r]{0,35}?(?:at about|is about|about|is)?\s*([0-9]+(?:\.[0-9]+)?)\s*GB/i
        );
        if (storageMatch?.[1]) {
          storageReq = `HD: ~${storageMatch[1]} GB`;
        }

        const resMatches = rmContent.matchAll(
          /([0-9]+(?:\.[0-9]+)?)\s*GB\s*(?:resident|of GPU)/gi
        );
        for (const m of resMatches) {
          const val = Number.parseFloat(m[1]);
          if (Number.isFinite(val)) {
            maxResidentGB = Math.max(maxResidentGB ?? 0, val);
          }
        }
      } catch {
        // ignore
      }
    }

    if (isSwitch2) {
      const s2Storage =
        storageReq === "HD: ~6 GB" ? "HD: ~10-16 GB" : storageReq;
      return {
        macReq: "Mac: 16 GB RAM (Apple M1+ • macOS 26.6+ Tahoe)",
        iosReq: "iPad M1+ / iPhone A18 Pro (Switch 2 Experimental)",
        storageReq: s2Storage,
        minRamGB: 16,
        minChipTier: "M1 / A18 Pro",
      };
    }

    let minRamGB = 8;
    if (foundTsv) {
      if (maxResidentGB !== null && maxResidentGB <= 1.35) {
        minRamGB = 4;
      } else if (
        appPool <= 0x40000000n ||
        (memReserve < 0x100000000n && sysResource === 0n)
      ) {
        minRamGB = 4;
      } else if (memReserve === 0x100000000n && sysResource === 0n) {
        if (maxResidentGB !== null && maxResidentGB >= 2.6) {
          minRamGB = 8;
        } else if (
          tid === "01007EF00011E000" ||
          tid === "0100E95004038000" ||
          tid === "0100FF500E34A000"
        ) {
          minRamGB = 8;
        } else {
          minRamGB = 6;
        }
      } else if (
        memReserve >= 0x140000000n ||
        sysResource >= 0x2000000n ||
        (isUnreal && sysResource > 0n)
      ) {
        if (appPool <= 0x80000000n) {
          minRamGB = 8;
        } else if (
          maxResidentGB !== null &&
          maxResidentGB <= 2.55 &&
          !isUnreal
        ) {
          minRamGB = 8;
        } else if (
          tid === "010015100B514000" ||
          tid === "0100ECD018EBE000" ||
          tid === "01009D901BC56000" ||
          tid === "010086A022444000"
        ) {
          minRamGB = 8;
        } else {
          minRamGB = 16;
        }
      } else {
        minRamGB = 8;
      }
    } else if (
      isUnreal ||
      engLower.includes("re engine") ||
      tid === "0100F2C0115B6000" ||
      verLower.includes("16gb")
    ) {
      minRamGB = 16;
    } else if (
      engLower.includes("unity") ||
      engLower.includes("godot") ||
      engLower.includes("monogame")
    ) {
      minRamGB = 4;
    }

    const a18OptimizedTitles = new Set([
      "0100FF500E34A000", // Xenoblade Chronicles: Definitive Edition
      "0100E95004038000", // Xenoblade Chronicles 2
      "0100B04011742000", // Monster Hunter Rise
      "0100965017338000", // Super Mario Party Jamboree
      "01001F5010DFA000", // Pokémon Legends: Arceus
      "0100A3D008C5C000", // Pokémon Scarlet
      "01006A800016E000", // Super Smash Bros. Ultimate
      "01004A4010FEA000", // Bayonetta 3
      "01002B00111A2000", // Hyrule Warriors: Age of Calamity
      "0100A3501946E000", // OCTOPATH TRAVELER II
      "01006C300E9F0000", // DRAGON QUEST XI S
    ]);

    let macReq: string;
    let iosReq: string;
    let minChipTier: string;

    switch (minRamGB) {
      case 4:
        macReq = "Mac: 4 GB+ RAM (Apple M1–M4 • macOS 26.6+ Tahoe)";
        iosReq = "iPhone A17 Pro+ / iPad M1+ (8 GB • iOS/iPadOS 26.0+)";
        minChipTier = "M1+ / A17 Pro+";
        if (storageReq === "HD: ~6 GB") storageReq = "HD: ~2-4 GB";
        break;
      case 6:
        macReq = "Mac: 6 GB+ RAM (Apple M1–M4 • macOS 26.6+ Tahoe)";
        iosReq = "iPhone A17 Pro+ / iPad M1+ (8 GB • iOS/iPadOS 26.0+)";
        minChipTier = "M1+ / A17 Pro+";
        break;
      case 8:
        macReq = "Mac: 8 GB+ RAM (Apple M1–M4 • macOS 26.6+ Tahoe)";
        if (
          isUnreal ||
          a18OptimizedTitles.has(tid) ||
          (maxResidentGB ?? 0) >= 2.75
        ) {
          iosReq = "iPhone A18+ / iPad M2+ (8 GB • iOS/iPadOS 26.0+)";
          minChipTier = "M1+ / A18+";
        } else {
          iosReq = "iPhone A17 Pro+ / iPad M1+ (8 GB • iOS/iPadOS 26.0+)";
          minChipTier = "M1+ / A17 Pro+";
        }
        if (storageReq === "HD: ~6 GB") storageReq = "HD: ~8-12 GB";
        break;
      default:
        macReq =
          "Mac: 16 GB+ RAM (Apple M1 Pro/Max ou M1–M4 16GB • macOS 26.6+ Tahoe)";
        iosReq = "iPhone A18 Pro / iPad M2+ (8 GB+ • iOS/iPadOS 26.0+)";
        minChipTier = "M1+ (16GB) / A18 Pro";
        if (storageReq === "HD: ~6 GB") storageReq = "HD: ~12-16 GB";
        break;
    }

    return {
      macReq,
      iosReq,
      storageReq,
      minRamGB,
      minChipTier,
    };
  }

  public static parseNxnativeMarkdown(
    markdown: string,
    addedTimestamps: Record<string, number>,
    artworkDb: Record<string, ArtworkEntry>,
    nxnativePath?: string
  ): NxCompatibleGame[] {
    const items: NxCompatibleGame[] = [];
    const sortedTs = Object.values(addedTimestamps).sort((a, b) => b - a);
    const newThreshold =
      sortedTs.length >= 15 ? sortedTs[14] : sortedTs[sortedTs.length - 1] || 1;

    const regex =
      /^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*`?([0-9A-Fa-f]{16})`?\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/gm;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(markdown)) !== null) {
      const title = match[1].trim();
      const relPath = match[2].trim();
      const titleId = match[3].trim().toUpperCase();
      const versionTested = match[4].trim();
      const sdk = match[5].trim();
      const engine = match[6].trim();
      const graphicsApi = match[7].trim();

      const isSwitch2 = titleId.startsWith("0400");
      const verLower = versionTested.toLowerCase();
      const iosBlocked =
        verLower.includes("ios address space") ||
        verLower.includes("mac only") ||
        verLower.includes("mac-only");

      const specs = this.resolveSpecs(
        titleId,
        engine,
        versionTested,
        nxnativePath
      );
      const addedTs = addedTimestamps[titleId] || 0;
      const { art, coverUrl } = this.resolveArtworkCoverFromMap(
        titleId,
        artworkDb
      );

      const githubUrl =
        relPath.startsWith("http://") || relPath.startsWith("https://")
          ? relPath
          : `https://github.com/seedds/nxnative/blob/main/dm/games/${relPath}`;

      items.push({
        id: titleId,
        title,
        titleId,
        generation: isSwitch2 ? "switch2" : "switch1",
        versionTested,
        sdk,
        engine,
        graphicsApi,
        readmeRelPath: relPath,
        githubUrl,
        macReq: specs.macReq,
        iosReq: specs.iosReq,
        androidReq: "",
        androidGpuTier: "",
        storageReq: specs.storageReq,
        minRamGB: specs.minRamGB,
        minChipTier: specs.minChipTier,
        isNew: addedTs > 0 && addedTs >= newThreshold,
        addedTimestamp: addedTs,
        isMacSupported: true,
        isIosSupported: !isSwitch2 && !iosBlocked,
        isIpadOsSupported: !isSwitch2 && !iosBlocked,
        isAndroidSupported: false,
        coverUrl,
        genres: Array.isArray(art?.category) ? art.category : [],
        cloudSources: [],
      });
    }
    return items;
  }

  public static parseNx2AndroidMarkdown(
    markdown: string
  ): AndroidCompatEntry[] {
    let sectionText = markdown;
    const startIdx = markdown.indexOf("## Games");
    if (startIdx >= 0) {
      const tail = markdown.slice(startIdx + 8);
      const endIdx = tail.indexOf("\n## ");
      sectionText = endIdx >= 0 ? tail.slice(0, endIdx) : tail;
    }

    const pattern = /!\[[^\]]*\]\([^)]+\)<br>([^<\n]+)<br><sub>([^<]+)<\/sub>/g;
    const results: AndroidCompatEntry[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sectionText)) !== null) {
      const rawTitle = match[1].trim();
      const rawSub = match[2].replace(/`/g, "").trim();
      if (!rawTitle) continue;

      const subLower = rawSub.toLowerCase();
      let gpuTier = "Snapdragon 8 Gen 2/3 (Adreno 740/750)";
      if (
        subLower.includes("adreno 830") ||
        subLower.includes("snapdragon 8 elite")
      ) {
        gpuTier = "Snapdragon 8 Elite (Adreno 830)";
      } else if (
        subLower.includes("adreno 640") ||
        subLower.includes("adreno 6xx")
      ) {
        gpuTier = "Snapdragon Mid (Adreno 6xx/7xx)";
      } else if (subLower.includes("xclipse")) {
        gpuTier = "Exynos Xclipse (AMD RDNA)";
      }

      const parts = rawSub.split(" · ");
      const conciseVer = parts.slice(0, 2).join(" · ").trim() || "nx2android";

      results.push({
        title: rawTitle,
        versionSummary: conciseVer,
        gpuTier,
        androidReq: `Android: ${gpuTier}`,
      });
    }
    return results;
  }

  private static loadLocalNx2AndroidTitleIdMap(
    nx2aPath: string
  ): Record<string, string> {
    const map: Record<string, string> = {};
    const gamesDir = path.join(nx2aPath, "nxnative", "dm", "games");
    if (!fs.existsSync(gamesDir)) return map;
    try {
      for (const dir of fs.readdirSync(gamesDir)) {
        const tid = dir.toUpperCase();
        if (tid.length !== 16) continue;
        const tsv = path.join(gamesDir, dir, "game.tsv");
        if (!fs.existsSync(tsv)) continue;
        const content = fs.readFileSync(tsv, "utf8");
        for (const line of content.split(/\r?\n/)) {
          if (line.startsWith("name\t")) {
            const rawName = line.slice(5).trim();
            const norm = this.strictAlphaNum(rawName);
            if (norm) map[norm] = tid;
            const ascii = rawName.replace(/[^A-Za-z0-9:\-' ]/g, " ").trim();
            const asciiNorm = this.strictAlphaNum(ascii);
            if (asciiNorm && !map[asciiNorm]) map[asciiNorm] = tid;
            break;
          }
        }
      }
    } catch {
      // ignore
    }
    return map;
  }

  private static mergeAndroidEntries(
    baseGames: NxCompatibleGame[],
    androidEntries: AndroidCompatEntry[],
    nx2aPath: string,
    artworkDb: Record<string, ArtworkEntry>
  ): NxCompatibleGame[] {
    const merged = baseGames.map((g) => ({ ...g }));
    if (androidEntries.length === 0) return merged;

    const nx2aTidMap = this.loadLocalNx2AndroidTitleIdMap(nx2aPath);
    const tidToIdx = new Map<string, number>();
    const normToIdx = new Map<string, number>();

    merged.forEach((item, idx) => {
      tidToIdx.set(item.titleId.toUpperCase(), idx);
      const lower = item.title.toLowerCase();
      const isRegional =
        lower.includes("asian release") ||
        lower.includes("japanese release") ||
        lower.includes("chinese release");
      if (!isRegional) {
        const n = this.strictAlphaNum(item.title);
        if (n && !normToIdx.has(n)) normToIdx.set(n, idx);
      }
    });

    for (const entry of androidEntries) {
      const lower = entry.title.toLowerCase();
      const isRegional =
        lower.includes("chinese release") ||
        lower.includes("asian release") ||
        lower.includes("japanese release");
      const cleanTitle = this.stripRegionalSuffix(entry.title);
      const strictNorm = this.strictAlphaNum(cleanTitle);

      let matchedIdx: number | undefined;
      if (!isRegional) {
        matchedIdx = normToIdx.get(strictNorm);
      }

      let resolvedTid: string | undefined = nx2aTidMap[strictNorm];
      if (!resolvedTid && cleanTitle.includes(":")) {
        const prefix = this.strictAlphaNum(cleanTitle.split(":")[0]);
        if (prefix.length >= 5) resolvedTid = nx2aTidMap[prefix];
      }
      if (matchedIdx === undefined && resolvedTid) {
        matchedIdx = tidToIdx.get(resolvedTid.toUpperCase());
      }

      if (matchedIdx !== undefined) {
        merged[matchedIdx].isAndroidSupported = true;
        merged[matchedIdx].androidGpuTier = entry.gpuTier;
        merged[matchedIdx].androidReq = entry.androidReq;
      } else {
        const finalTid = (
          resolvedTid || `NX2A-${strictNorm.toUpperCase()}`
        ).toUpperCase();
        const existingIdx = tidToIdx.get(finalTid);
        if (existingIdx !== undefined) {
          merged[existingIdx].isAndroidSupported = true;
          merged[existingIdx].androidGpuTier = entry.gpuTier;
          merged[existingIdx].androidReq = entry.androidReq;
        } else {
          const { art, coverUrl } = this.resolveArtworkCoverFromMap(
            finalTid,
            artworkDb
          );
          tidToIdx.set(finalTid, merged.length);
          merged.push({
            id: finalTid,
            title: entry.title,
            titleId: finalTid,
            generation: finalTid.startsWith("0400") ? "switch2" : "switch1",
            versionTested: entry.versionSummary,
            sdk: "nx2android",
            engine: "NVN / Vulkan",
            graphicsApi: "Vulkan",
            readmeRelPath: "https://github.com/shirai91/nx2android#games",
            githubUrl: "https://github.com/shirai91/nx2android#games",
            macReq: "",
            iosReq: "",
            androidReq: entry.androidReq,
            androidGpuTier: entry.gpuTier,
            storageReq: "HD: ~6 GB",
            minRamGB: 8,
            minChipTier: "A17 Pro",
            isNew: false,
            addedTimestamp: 0,
            isMacSupported: false,
            isIosSupported: false,
            isIpadOsSupported: false,
            isAndroidSupported: true,
            coverUrl,
            genres: Array.isArray(art?.category) ? art.category : [],
            cloudSources: [],
          });
        }
      }
    }

    merged.sort((a, b) => a.title.localeCompare(b.title));
    return merged;
  }

  private static async enrichWithCloudSources(
    games: NxCompatibleGame[]
  ): Promise<NxCompatibleGame[]> {
    const [artworkDb, batchCovers] = await Promise.all([
      this.loadArtworkDatabase(),
      NxArtworkService.resolveCoversForBatch(
        games.map((g) => ({ titleId: g.titleId, title: g.title }))
      ),
    ]);
    const sourcesByTid = new Map<string, Set<string>>();
    try {
      for await (const [tid, streams] of nxCloudStreamsSublevel.iterator()) {
        const set = new Set<string>();
        for (const s of streams) {
          if (s.sourceName) set.add(s.sourceName);
        }
        sourcesByTid.set(tid.toUpperCase(), set);
      }
    } catch {
      // ignore if empty
    }

    const enriched = games.map((g) => {
      const upperTid = g.titleId.toUpperCase();
      const set = sourcesByTid.get(upperTid);
      const batchCover = batchCovers.get(upperTid) ?? null;
      let coverUrl =
        g.generation === "switch2"
          ? (batchCover ?? g.coverUrl)
          : (g.coverUrl ?? batchCover);
      if (!coverUrl) {
        coverUrl = this.resolveArtworkCoverFromMap(
          g.titleId,
          artworkDb
        ).coverUrl;
      }
      return {
        ...g,
        coverUrl,
        cloudSources: set ? Array.from(set) : [],
      };
    });

    const missingSwitch2 = enriched
      .filter((g) => g.generation === "switch2" && !g.coverUrl)
      .map((g) => ({ titleId: g.titleId, title: g.title }));
    const missingSwitch1 = enriched
      .filter((g) => g.generation !== "switch2" && !g.coverUrl)
      .slice(0, 40)
      .map((g) => ({ titleId: g.titleId, title: g.title }));
    const missingCovers = [...missingSwitch2, ...missingSwitch1];
    if (missingCovers.length > 0) {
      void NxArtworkService.ensureCoversForGames(missingCovers, 4).catch(
        () => {}
      );
    }

    return enriched;
  }

  public static async getCompatibleGames(forceRefresh = false): Promise<{
    games: NxCompatibleGame[];
    isOnline: boolean;
    updatedAt: number;
  }> {
    if (!forceRefresh && this.cachedGames.length > 0) {
      const enriched = await this.enrichWithCloudSources(this.cachedGames);
      return { games: enriched, isOnline: true, updatedAt: Date.now() };
    }

    if (!forceRefresh) {
      try {
        const cached = await nxCompatibilityCacheSublevel.get("master");
        const hasUpdatedSpecsSchema = cached?.games?.some((g) =>
          g.macReq?.includes("macOS 26.6+")
        );
        if (cached && cached.games.length > 0 && hasUpdatedSpecsSchema) {
          this.cachedGames = cached.games;
          const enriched = await this.enrichWithCloudSources(cached.games);
          return {
            games: enriched,
            isOnline: cached.isOnline,
            updatedAt: cached.updatedAt,
          };
        }
      } catch {
        // cache miss
      }
    }

    return this.refreshCompatibleGames();
  }

  public static async refreshCompatibleGames(): Promise<{
    games: NxCompatibleGame[];
    isOnline: boolean;
    updatedAt: number;
  }> {
    const [nxRepo, nx2aRepo, artworkDb] = await Promise.all([
      NxPathsService.resolveNxnativePath(),
      NxPathsService.resolveNx2AndroidPath(),
      this.loadArtworkDatabase(),
    ]);

    const fetchText = async (url: string): Promise<string | null> => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(url, {
          signal: controller.signal,
          headers: { "Cache-Control": "no-cache" },
        });
        clearTimeout(timer);
        if (!resp.ok) return null;
        const txt = await resp.text();
        return txt.trim() ? txt : null;
      } catch {
        return null;
      }
    };

    const [seeddsRemote, nx2aRemote] = await Promise.all([
      fetchText(SEEDDS_README_URL),
      fetchText(NX2ANDROID_README_URL),
    ]);

    const isOnline = Boolean(seeddsRemote || nx2aRemote);
    const addedTimestamps = this.loadAddedTimestamps(nxRepo.path);

    let baseGames: NxCompatibleGame[] = [];
    if (seeddsRemote) {
      baseGames = this.parseNxnativeMarkdown(
        seeddsRemote,
        addedTimestamps,
        artworkDb,
        nxRepo.path
      );
    }

    // Merge local README games as fallback/supplement
    const localReadmeCandidates = [
      path.join(nxRepo.path, "dm", "games", "README.md"),
      "/Volumes/SSD FN501 PRO/Emulations/NativePort/nxnative/dm/games/README.md",
    ];
    for (const p of localReadmeCandidates) {
      if (fs.existsSync(p)) {
        const localText = fs.readFileSync(p, "utf8");
        const localGames = this.parseNxnativeMarkdown(
          localText,
          addedTimestamps,
          artworkDb,
          nxRepo.path
        );
        if (baseGames.length === 0) {
          baseGames = localGames;
        } else {
          const existingIds = new Set(
            baseGames.map((g) => g.titleId.toUpperCase())
          );
          for (const lg of localGames) {
            if (!existingIds.has(lg.titleId.toUpperCase())) {
              baseGames.push(lg);
            }
          }
        }
        break;
      }
    }

    let nx2aText = nx2aRemote;
    if (!nx2aText) {
      const localNx2aReadme = path.join(nx2aRepo.path, "README.md");
      if (fs.existsSync(localNx2aReadme)) {
        nx2aText = fs.readFileSync(localNx2aReadme, "utf8");
      }
    }

    const androidEntries = nx2aText
      ? this.parseNx2AndroidMarkdown(nx2aText)
      : [];
    const merged = this.mergeAndroidEntries(
      baseGames,
      androidEntries,
      nx2aRepo.path,
      artworkDb
    );

    const updatedAt = Date.now();
    this.cachedGames = merged;
    await nxCompatibilityCacheSublevel.put("master", {
      games: merged,
      updatedAt,
      isOnline,
    });

    AppLogHub.info(
      "nxnative",
      `Compatibilidade atualizada (${isOnline ? "GitHub online" : "local"}): ${merged.length} jogos (Switch 1: ${merged.filter((g) => g.generation === "switch1").length}, Switch 2: ${merged.filter((g) => g.generation === "switch2").length}).`
    );

    const enriched = await this.enrichWithCloudSources(merged);
    return { games: enriched, isOnline, updatedAt };
  }

  private static async loadLocalGameTsvTitleMap(): Promise<
    Map<string, string>
  > {
    if (this.localTsvTitleMap) return this.localTsvTitleMap;
    const map = new Map<string, string>();
    const [nxRepo, nx2aRepo] = await Promise.all([
      NxPathsService.resolveNxnativePath(),
      NxPathsService.resolveNx2AndroidPath(),
    ]);
    const candidateDirs = [
      path.join(nxRepo.path, "dm", "games"),
      "/Volumes/SSD FN501 PRO/Emulations/NativePort/nxnative/dm/games",
      path.join(nx2aRepo.path, "nxnative", "dm", "games"),
      "/Volumes/SSD FN501 PRO/Emulations/NativePort/nxnative/tools/nx2android/nxnative/dm/games",
    ];
    for (const gamesDir of candidateDirs) {
      if (!fs.existsSync(gamesDir)) continue;
      try {
        for (const dir of fs.readdirSync(gamesDir)) {
          const tid = dir.toUpperCase();
          if (!/^[0-9A-F]{16}$/.test(tid) || map.has(tid)) continue;
          const tsv = path.join(gamesDir, dir, "game.tsv");
          if (!fs.existsSync(tsv)) continue;
          const content = fs.readFileSync(tsv, "utf8");
          for (const line of content.split(/\r?\n/)) {
            if (line.startsWith("name\t")) {
              const rawName = line.slice(5).trim();
              if (rawName) map.set(tid, rawName);
              break;
            }
          }
        }
      } catch {
        // ignore directory error
      }
    }
    this.localTsvTitleMap = map;
    return map;
  }

  public static async resolveCanonicalTitle(
    titleId: string | null | undefined,
    fallbackName: string
  ): Promise<string> {
    const cleanTid = titleId?.trim().toUpperCase() || "";
    if (!/^[0-9A-F]{16}$/.test(cleanTid)) {
      return fallbackName;
    }

    const tsvMap = await this.loadLocalGameTsvTitleMap();
    const fromTsv = tsvMap.get(cleanTid);
    if (fromTsv) return fromTsv;

    const { games } = await this.getCompatibleGames(false);
    const fromCompat = games.find(
      (g) => g.titleId.toUpperCase() === cleanTid
    )?.title;
    if (fromCompat) return fromCompat;

    const artworkDb = await this.loadArtworkDatabase();
    const fromArt =
      artworkDb[cleanTid]?.name ||
      artworkDb[cleanTid.toLowerCase()]?.name ||
      null;
    if (fromArt && fromArt.trim()) return fromArt.trim();

    return fallbackName;
  }

  public static async findVerifiedSteamAppId(
    switchTitle: string
  ): Promise<string | null> {
    const cleanTitle = this.stripRegionalSuffix(switchTitle).trim();
    if (!cleanTitle) return null;

    const cacheKey = this.strictAlphaNum(cleanTitle);
    if (this.verifiedSteamAppIdCache.has(cacheKey)) {
      return this.verifiedSteamAppIdCache.get(cacheKey) ?? null;
    }

    try {
      const suggestions = await HydraApi.get<
        Array<{ objectId: string; title: string; shop?: string }>
      >(
        "/catalogue/search/suggestions",
        { query: cleanTitle, limit: 8, shop: "steam" },
        { needsAuth: false }
      );
      if (Array.isArray(suggestions)) {
        let bestAppId: string | null = null;
        let bestScore = 0;
        for (const candidate of suggestions) {
          if (!candidate?.objectId || !candidate?.title) continue;
          const score = scoreSwitchTitleMatch(cleanTitle, candidate.title);
          if (score >= 0.88 && score > bestScore) {
            bestScore = score;
            bestAppId = String(candidate.objectId);
          }
        }
        this.verifiedSteamAppIdCache.set(cacheKey, bestAppId);
        return bestAppId;
      }
    } catch {
      // Network or API unavailable; do not cache failure permanently
      return null;
    }

    this.verifiedSteamAppIdCache.set(cacheKey, null);
    return null;
  }

  public static async findTitleIdByName(
    gameName: string
  ): Promise<string | null> {
    const norm = this.strictAlphaNum(gameName);
    if (!norm) return null;

    const tsvMap = await this.loadLocalGameTsvTitleMap();
    for (const [tid, officialName] of tsvMap.entries()) {
      if (this.strictAlphaNum(officialName) === norm) {
        return tid;
      }
    }

    const { games } = await this.getCompatibleGames(false);
    for (const g of games) {
      if (this.strictAlphaNum(g.title) === norm) {
        return g.titleId.toUpperCase();
      }
    }

    const artworkDb = await this.loadArtworkDatabase();
    for (const [tid, entry] of Object.entries(artworkDb)) {
      if (entry.name && this.strictAlphaNum(entry.name) === norm) {
        return tid.toUpperCase();
      }
    }

    let bestTid: string | null = null;
    let bestScore = 0;
    for (const [tid, officialName] of tsvMap.entries()) {
      const score = scoreSwitchTitleMatch(gameName, officialName);
      if (score >= 0.78 && score > bestScore) {
        bestScore = score;
        bestTid = tid;
      }
    }
    for (const g of games) {
      const score = scoreSwitchTitleMatch(gameName, g.title);
      if (score >= 0.78 && score > bestScore) {
        bestScore = score;
        bestTid = g.titleId.toUpperCase();
      }
    }
    for (const [tid, entry] of Object.entries(artworkDb)) {
      if (!entry.name) continue;
      const score = scoreSwitchTitleMatch(gameName, entry.name);
      if (score >= 0.78 && score > bestScore) {
        bestScore = score;
        bestTid = tid.toUpperCase();
      }
    }
    return bestTid;
  }

  public static async getCoverUrlForTitle(
    titleId: string | null,
    gameName: string
  ): Promise<string | null> {
    return NxArtworkService.resolveCoverForGame({
      titleId,
      title: gameName,
    });
  }
}
