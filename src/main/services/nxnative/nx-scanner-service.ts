import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type {
  Download,
  Game,
  NxPortedGame,
  NxRomFileItem,
  NxRomGame,
  SwitchGeneration,
  UserPreferences,
} from "@types";
import { Downloader } from "@shared";
import {
  db,
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { updateGameRecord } from "@main/services/game-record-updater";
import { WindowManager } from "@main/services/window-manager";
import { AppLogHub } from "@main/services/app-log-hub";
import { NxArtworkService, type ArtworkQuery } from "./nx-artwork-service";
import { NxCompatibilityService } from "./nx-compatibility-service";
import {
  baseApplicationTitleId,
  scoreSwitchTitleMatch,
} from "./nx-core-parsers";
import { NxPathsService } from "./nx-paths";

const ALLOWED_ROM_EXTS = new Set([
  ".nsp",
  ".nsz",
  ".nzs",
  ".xci",
  ".xcz",
  ".nup",
]);

const SKIPPED_DIRS = new Set([
  "staging",
  "shader",
  "extract",
  "romfs",
  "exefs",
  "pso",
  "logs",
  "tools",
  "font",
  "aoc",
  ".git",
  "node_modules",
  ".build",
  "build",
]);

const TID_BRACKET_RE = /\[([0-9A-Fa-f]{16})\]/;
const TID_LOOSE_RE =
  /(?:^|[^0-9A-Fa-f])((?:0100|0400)[0-9A-Fa-f]{12})(?:[^0-9A-Fa-f]|$)/;
const VERSION_RE = /\[v([0-9]+)\]|v([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i;

const ACTIVE_OR_USER_DOWNLOAD_STATES = new Set([
  "active",
  "waiting",
  "paused",
  "seeding",
  "error",
]);

interface NupBinaryMetadata {
  titleId: string | null;
  updateCount: number;
  dlcCount: number;
}

interface UnifiedSwitchGameBucket {
  key: string;
  shop: SwitchGeneration;
  objectId: string;
  titleId: string | null;
  title: string;
  rom: NxRomGame | null;
  macApp: NxPortedGame | null;
  iosIpa: NxPortedGame | null;
  androidApk: NxPortedGame | null;
}

function cleanGameTitle(filename: string): string {
  return filename
    .replace(/\.(nsp|nsz|nzs|xci|xcz|nup|app|ipa|apk)$/i, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(base|update|dlc|switch\s*2?|v\d+(?:\.\d+)*)\b/gi, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readPlistJson(plistPath: string): Record<string, unknown> | null {
  if (!fs.existsSync(plistPath)) return null;
  try {
    const out = execFileSync(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", plistPath],
      {
        encoding: "utf8",
        timeout: 3000,
      }
    );
    return JSON.parse(out) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readPlistJsonFromBuffer(
  plistData: Buffer
): Record<string, unknown> | null {
  if (!plistData.length) return null;
  try {
    const out = execFileSync(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", "-"],
      {
        input: plistData,
        encoding: "utf8",
        timeout: 3000,
      }
    );
    return JSON.parse(out) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getDirSizeBytes(targetPath: string, depth = 0): number {
  if (depth > 3) return 0;
  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const entry of fs.readdirSync(targetPath)) {
      if (entry.startsWith("._")) continue;
      total += getDirSizeBytes(path.join(targetPath, entry), depth + 1);
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Extracts Title ID from an NSP/NSZ/NZS PFS0 header ticket filename (`<32-hex>.tik`).
 */
export function extractTitleIdFromPFS0(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".nsp" && ext !== ".nsz" && ext !== ".nzs") return null;

  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, header, 0, 16, 0);
    if (bytesRead < 16) return null;
    if (header.subarray(0, 4).toString("ascii") !== "PFS0") return null;

    const numFiles = header.readUInt32LE(4);
    const strTableSize = header.readUInt32LE(8);
    if (
      numFiles === 0 ||
      numFiles >= 2048 ||
      strTableSize === 0 ||
      strTableSize >= 262_144
    ) {
      return null;
    }

    const entriesBytes = numFiles * 24;
    const bodyLen = entriesBytes + strTableSize;
    const body = Buffer.alloc(bodyLen);
    const bodyRead = fs.readSync(fd, body, 0, bodyLen, 16);
    if (bodyRead < bodyLen) return null;

    const rawStrings = body
      .subarray(entriesBytes, entriesBytes + strTableSize)
      .toString("ascii");
    const tikMatch = /([0-9A-Fa-f]{16})[0-9A-Fa-f]{16}\.tik/.exec(rawStrings);
    return tikMatch?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close failure
      }
    }
  }
}

/**
 * Inspects NUP container TOC header (SPEC v1) to extract base Title ID, updates, and DLC counts.
 */
export function inspectNupMetadata(filePath: string): NupBinaryMetadata | null {
  if (path.extname(filePath).toLowerCase() !== ".nup") return null;

  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const superBuf = Buffer.alloc(128);
    const superRead = fs.readSync(fd, superBuf, 0, 128, 0);
    if (
      superRead < 24 ||
      superBuf[0] !== 0x4e ||
      superBuf[1] !== 0x55 ||
      superBuf[2] !== 0x50 ||
      superBuf[3] !== 0x01
    ) {
      return null;
    }

    const tocOff = superBuf.readBigUInt64LE(8);
    const tocSize = superBuf.readBigUInt64LE(16);
    if (
      tocSize < 48n + 64n ||
      tocOff > BigInt(Number.MAX_SAFE_INTEGER) ||
      tocSize > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return null;
    }

    const readCap = Math.min(Number(tocSize), 48 + 32 * 64);
    const tocHead = Buffer.alloc(readCap);
    const tocRead = fs.readSync(fd, tocHead, 0, readCap, Number(tocOff));
    if (
      tocRead < 48 + 64 ||
      tocHead[0] !== 0x54 ||
      tocHead[1] !== 0x4f ||
      tocHead[2] !== 0x43 ||
      tocHead[3] !== 0x01
    ) {
      return null;
    }

    const numPkgs = tocHead.readUInt32LE(4);
    if (numPkgs === 0) return null;

    const pkgLimit = Math.min(numPkgs, Math.floor((tocRead - 48) / 64));
    let resolvedBaseTid: string | null = null;
    let fallbackTid: string | null = null;
    let updateCount = 0;
    let dlcCount = 0;

    for (let i = 0; i < pkgLimit; i++) {
      const offset = 48 + i * 64;
      const pkgTid = tocHead.readBigUInt64LE(offset);
      const pkgKind = tocHead[offset + 24];

      if (pkgTid !== 0n) {
        const hexTid = pkgTid.toString(16).toUpperCase().padStart(16, "0");
        if (pkgKind === 0 || (pkgTid & 0xfffn) === 0n) {
          if (!resolvedBaseTid) resolvedBaseTid = hexTid;
        } else if (!fallbackTid) {
          fallbackTid = baseApplicationTitleId(hexTid) ?? hexTid;
        }
      }

      if (pkgKind === 1) updateCount++;
      else if (pkgKind === 2) dlcCount++;
    }

    return {
      titleId: resolvedBaseTid ?? fallbackTid,
      updateCount,
      dlcCount,
    };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close failure
      }
    }
  }
}

/**
 * Extracts the 16-hex Program ID (Title ID) from a Switch ExeFS `main.npdm` binary (META/ACI0).
 */
export function extractProgramIdFromNpdm(npdmPath: string): string | null {
  try {
    if (!fs.existsSync(npdmPath)) return null;
    const data = fs.readFileSync(npdmPath);
    if (data.length < 0x80) return null;
    if (data.subarray(0, 4).toString("ascii") !== "META") return null;

    const aci0Offset = data.readUInt32LE(0x70);
    const aci0Size = data.readUInt32LE(0x74);
    if (aci0Size < 0x18 || data.length < aci0Offset + aci0Size) return null;
    if (
      data.subarray(aci0Offset, aci0Offset + 4).toString("ascii") !== "ACI0"
    ) {
      return null;
    }

    const programId = data.readBigUInt64LE(aci0Offset + 0x10);
    if (programId === 0n) return null;
    return programId.toString(16).toUpperCase().padStart(16, "0");
  } catch {
    return null;
  }
}

function computeIpaCompanionSizeBytes(
  ipaPath: string,
  titleId: string | null
): number {
  const dir = path.dirname(ipaPath);
  const stem = path.basename(ipaPath, path.extname(ipaPath));
  const stemVariants = Array.from(
    new Set(
      [stem, stem.replace(/’/g, "'"), stem.replace(/'/g, "’")].filter(Boolean)
    )
  );

  const candidates: string[] = [];
  for (const variant of stemVariants) {
    candidates.push(path.join(dir, `${variant}.romfs.img`));
    candidates.push(path.join(dir, `${variant}.RomFS.img`));
    candidates.push(path.join(dir, `${variant}.ipa.idx`));
  }
  const cleanTid = titleId?.trim();
  if (cleanTid) {
    candidates.push(path.join(dir, `${cleanTid.toUpperCase()}.romfs.img`));
    candidates.push(path.join(dir, `${cleanTid.toLowerCase()}.romfs.img`));
    candidates.push(path.join(dir, `${cleanTid.toUpperCase()}.RomFS.img`));
  }

  const seenRealPaths = new Set<string>();
  let extraBytes = 0;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const real = fs.realpathSync(candidate).toLowerCase();
      if (seenRealPaths.has(real)) continue;
      seenRealPaths.add(real);
      const st = fs.statSync(candidate);
      if (st.isFile()) extraBytes += st.size;
    } catch {
      // Skip unreadable companion
    }
  }
  return extraBytes;
}

/**
 * Unified scanner for Switch 1 / Switch 2 ROMs, NUP containers, extracted dumps,
 * and ported `.app`, `.ipa`, and `.apk` builds, keeping Cerberus's library & downloads in sync.
 */
export class NxScannerService {
  private static cachedRomGames: NxRomGame[] = [];
  private static cachedPortedGames: NxPortedGame[] = [];

  public static getCachedRomGames(): NxRomGame[] {
    return this.cachedRomGames;
  }

  public static getCachedPortedGames(): NxPortedGame[] {
    return this.cachedPortedGames;
  }

  public static scanRomDirectory(
    dirPath: string,
    defaultGeneration: SwitchGeneration
  ): NxRomFileItem[] {
    if (!dirPath || !fs.existsSync(dirPath)) return [];
    const results: NxRomFileItem[] = [];

    const resolveDumpNpdm = (d: string): string | null => {
      const baseNpdm = path.join(d, "base", "exefs", "main.npdm");
      if (fs.existsSync(baseNpdm)) return baseNpdm;
      const flatNpdm = path.join(d, "exefs", "main.npdm");
      if (fs.existsSync(flatNpdm)) return flatNpdm;
      return null;
    };

    const walk = (current: string, depth: number) => {
      if (depth > 5) return;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(current);
      } catch {
        return;
      }

      if (!stat.isDirectory()) {
        const item = this.inspectRomFile(current, stat.size, defaultGeneration);
        if (item) results.push(item);
        return;
      }

      const npdmPath = resolveDumpNpdm(current);
      if (npdmPath) {
        const name = path.basename(current);
        const npdmTid = extractProgramIdFromNpdm(npdmPath);
        const nameTid =
          (TID_BRACKET_RE.exec(name) ||
            TID_LOOSE_RE.exec(name))?.[1]?.toUpperCase() || null;
        results.push({
          path: current,
          name,
          sizeBytes: getDirSizeBytes(current, 0),
          type: "switch2Dump",
          titleId: npdmTid ?? nameTid,
          versionString: null,
        });
        return;
      }

      let entries: string[];
      try {
        entries = fs.readdirSync(current);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.startsWith(".") || entry.startsWith("._")) continue;
        const full = path.join(current, entry);
        let childStat: fs.Stats;
        try {
          childStat = fs.statSync(full);
        } catch {
          continue;
        }
        if (childStat.isDirectory()) {
          const lower = entry.toLowerCase();
          if (
            SKIPPED_DIRS.has(lower) ||
            lower.endsWith("_build") ||
            lower.endsWith("-work") ||
            lower.endsWith("_survey") ||
            lower.endsWith(".app") ||
            lower.endsWith(".framework") ||
            lower.startsWith("patched_")
          ) {
            continue;
          }
          walk(full, depth + 1);
        } else {
          const item = this.inspectRomFile(
            full,
            childStat.size,
            defaultGeneration
          );
          if (item) results.push(item);
        }
      }
    };

    walk(dirPath, 0);
    return results;
  }

  private static inspectRomFile(
    filePath: string,
    sizeBytes: number,
    defaultGeneration: SwitchGeneration
  ): NxRomFileItem | null {
    const filename = path.basename(filePath);
    if (filename.startsWith("._")) return null;
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_ROM_EXTS.has(ext)) return null;

    const tidFromName =
      (TID_BRACKET_RE.exec(filename) ||
        TID_LOOSE_RE.exec(filename))?.[1]?.toUpperCase() || null;
    const nupMeta = ext === ".nup" ? inspectNupMetadata(filePath) : null;
    const pfs0Tid =
      !tidFromName && ext !== ".nup" ? extractTitleIdFromPFS0(filePath) : null;
    const titleId = tidFromName ?? nupMeta?.titleId ?? pfs0Tid ?? null;

    const verMatch = VERSION_RE.exec(filename);
    const versionString = verMatch ? `v${verMatch[1] || verMatch[2]}` : null;

    const lower = filename.toLowerCase();
    const parentLower = path.basename(path.dirname(filePath)).toLowerCase();

    let type: NxRomFileItem["type"] = "base";
    if (ext === ".nup") {
      type =
        titleId?.startsWith("0400") ||
        defaultGeneration === "switch2" ||
        lower.includes("switch 2") ||
        lower.includes("switch2")
          ? "switch2Dump"
          : "base";
    } else if (titleId) {
      const low = Number.parseInt(titleId.slice(-3), 16);
      if (low === 0x000) type = "base";
      else if (low === 0x800) type = "update";
      else type = "dlc";
    } else if (lower.includes("dlc") || parentLower.includes("dlc")) {
      type = "dlc";
    } else if (
      lower.includes("update") ||
      lower.includes("patch") ||
      parentLower.includes("update")
    ) {
      type = "update";
    } else {
      type = defaultGeneration === "switch2" ? "switch2Dump" : "base";
    }

    return {
      path: filePath,
      name: filename,
      sizeBytes,
      type,
      titleId,
      versionString,
    };
  }

  public static async groupRomFiles(
    items: NxRomFileItem[],
    defaultGeneration: SwitchGeneration
  ): Promise<NxRomGame[]> {
    const groups = new Map<string, NxRomFileItem[]>();

    for (const item of items) {
      let tid = item.titleId;
      if (!tid) {
        const clean = cleanGameTitle(item.name);
        tid = await NxCompatibilityService.findTitleIdByName(clean);
      }

      const baseTid = tid
        ? (baseApplicationTitleId(tid) ?? tid.toUpperCase())
        : null;
      const key =
        baseTid ??
        `NAME:${NxCompatibilityService.strictAlphaNum(cleanGameTitle(item.name)) || item.path}`;

      const list = groups.get(key) || [];
      list.push({ ...item, titleId: tid });
      groups.set(key, list);
    }

    const romGames: NxRomGame[] = [];
    for (const [key, files] of groups.entries()) {
      const baseFile =
        files.find((f) => f.type === "base" || f.type === "switch2Dump") ||
        files[0];
      const titleId = key.startsWith("NAME:") ? null : key;
      const nupExtras = files.reduce(
        (acc, file) => {
          if (file.path.toLowerCase().endsWith(".nup")) {
            const meta = inspectNupMetadata(file.path);
            if (meta) {
              acc.updates += meta.updateCount;
              acc.dlcs += meta.dlcCount;
            }
          }
          return acc;
        },
        { updates: 0, dlcs: 0 }
      );
      const updateCount =
        files.filter((f) => f.type === "update").length + nupExtras.updates;
      const dlcCount =
        files.filter((f) => f.type === "dlc").length + nupExtras.dlcs;
      const totalSizeBytes = files.reduce((acc, f) => acc + f.sizeBytes, 0);

      const isSwitch2 =
        Boolean(titleId?.startsWith("0400")) ||
        baseFile.type === "switch2Dump" ||
        defaultGeneration === "switch2";
      const isNup = files.some((f) => f.path.toLowerCase().endsWith(".nup"));
      const isDumpFolder =
        fs.existsSync(baseFile.path) &&
        fs.statSync(baseFile.path).isDirectory();

      const folderPath = isDumpFolder
        ? baseFile.path
        : path.dirname(baseFile.path);
      const displayName = cleanGameTitle(baseFile.name) || baseFile.name;

      romGames.push({
        id:
          titleId ||
          `rom_${NxCompatibilityService.strictAlphaNum(displayName)}`,
        name: displayName,
        titleId,
        generation: isSwitch2 ? "switch2" : "switch1",
        folderPath,
        baseFilePath: baseFile.path,
        files,
        updateCount,
        dlcCount,
        totalSizeBytes,
        isNup,
        isDumpFolder,
      });
    }

    return romGames.sort((a, b) => a.name.localeCompare(b.name));
  }

  public static async scanPortedOutputDirectory(
    outputDir: string
  ): Promise<NxPortedGame[]> {
    if (!outputDir || !fs.existsSync(outputDir)) return [];
    const ported: NxPortedGame[] = [];

    let entries: string[];
    try {
      entries = fs.readdirSync(outputDir);
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (entry.startsWith(".") || entry.startsWith("._")) continue;
      if (entry === "NXNative.app" || entry === "NxNative_Launcher.app") {
        continue;
      }
      const fullPath = path.join(outputDir, entry);
      const ext = path.extname(entry).toLowerCase();

      if (ext === ".app") {
        const parsed = await this.parsePortedMacApp(fullPath);
        if (parsed) ported.push(parsed);
      } else if (ext === ".ipa") {
        const parsed = await this.parsePortedIpa(fullPath);
        if (parsed) ported.push(parsed);
      } else if (ext === ".apk") {
        const parsed = await this.parsePortedApk(fullPath);
        if (parsed) ported.push(parsed);
      }
    }

    return ported.sort((a, b) => b.modificationDate - a.modificationDate);
  }

  private static async resolvePortTitleId(
    rawTitleId: string | null,
    bundleId: string | null,
    filename: string,
    gameName: string
  ): Promise<string | null> {
    let candidate = rawTitleId?.trim().toUpperCase() || null;
    if (!candidate && bundleId) {
      const m = TID_LOOSE_RE.exec(bundleId);
      if (m?.[1]) candidate = m[1].toUpperCase();
    }
    if (!candidate) {
      const m = TID_BRACKET_RE.exec(filename) || TID_LOOSE_RE.exec(filename);
      if (m?.[1]) candidate = m[1].toUpperCase();
    }
    if (!candidate) {
      candidate = await NxCompatibilityService.findTitleIdByName(gameName);
    }
    if (!candidate) return null;
    return baseApplicationTitleId(candidate) ?? candidate.toUpperCase();
  }

  private static async parsePortedMacApp(
    appPath: string
  ): Promise<NxPortedGame | null> {
    const plistPath = path.join(appPath, "Contents", "Info.plist");
    const plist = readPlistJson(plistPath);
    const hasDmhost = fs.existsSync(
      path.join(appPath, "Contents", "MacOS", "dmhost")
    );
    const dmTitleId =
      typeof plist?.DMTitleID === "string" ? plist.DMTitleID.trim() : null;

    if (!hasDmhost && !dmTitleId) return null;

    const bundleId =
      typeof plist?.CFBundleIdentifier === "string"
        ? plist.CFBundleIdentifier
        : null;
    const version =
      typeof plist?.CFBundleShortVersionString === "string"
        ? plist.CFBundleShortVersionString
        : null;

    let name = path.basename(appPath, ".app");
    if (
      typeof plist?.CFBundleDisplayName === "string" &&
      plist.CFBundleDisplayName
    ) {
      name = plist.CFBundleDisplayName;
    } else if (typeof plist?.CFBundleName === "string" && plist.CFBundleName) {
      name = plist.CFBundleName;
    }

    const titleId = await this.resolvePortTitleId(
      dmTitleId,
      bundleId,
      path.basename(appPath),
      name
    );

    let mtime = Date.now();
    try {
      mtime = fs.statSync(appPath).mtimeMs;
    } catch {
      // ignore
    }

    const generation: SwitchGeneration = titleId?.startsWith("0400")
      ? "switch2"
      : "switch1";

    return {
      name,
      appPath,
      platform: "macApp",
      titleId,
      bundleId,
      version,
      sizeBytes: getDirSizeBytes(appPath, 1),
      generation,
      modificationDate: mtime,
    };
  }

  private static async parsePortedIpa(
    ipaPath: string
  ): Promise<NxPortedGame | null> {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(ipaPath);
      if (!stat.isFile()) return null;
    } catch {
      return null;
    }

    let name = path.basename(ipaPath, ".ipa");
    let bundleId: string | null = null;
    let dmTitleId: string | null = null;
    let version: string | null = null;

    try {
      const plistBuf = execFileSync(
        "/usr/bin/unzip",
        ["-p", ipaPath, "Payload/*/Info.plist"],
        { timeout: 3000, maxBuffer: 2 * 1024 * 1024 }
      );
      const plist = readPlistJsonFromBuffer(plistBuf);
      if (plist) {
        if (
          typeof plist.CFBundleDisplayName === "string" &&
          plist.CFBundleDisplayName.trim()
        ) {
          name = plist.CFBundleDisplayName.trim();
        } else if (
          typeof plist.CFBundleName === "string" &&
          plist.CFBundleName.trim() &&
          plist.CFBundleName.trim() !== "DmIOS"
        ) {
          name = plist.CFBundleName.trim();
        }
        bundleId =
          typeof plist.CFBundleIdentifier === "string"
            ? plist.CFBundleIdentifier.trim()
            : null;
        dmTitleId =
          typeof plist.DMTitleID === "string" ? plist.DMTitleID.trim() : null;
        version =
          typeof plist.CFBundleShortVersionString === "string"
            ? plist.CFBundleShortVersionString.trim()
            : null;
      }
    } catch {
      // Fall back to filename metadata when Info.plist cannot be extracted
    }

    const titleId = await this.resolvePortTitleId(
      dmTitleId,
      bundleId,
      path.basename(ipaPath),
      name
    );
    const totalSize =
      stat.size + computeIpaCompanionSizeBytes(ipaPath, titleId);

    return {
      name,
      appPath: ipaPath,
      platform: "ios",
      titleId,
      bundleId:
        bundleId ?? (titleId ? `org.nxnative.${titleId.toLowerCase()}` : null),
      version,
      sizeBytes: totalSize,
      generation: titleId?.startsWith("0400") ? "switch2" : "switch1",
      modificationDate: stat.mtimeMs,
    };
  }

  private static async parsePortedApk(
    apkPath: string
  ): Promise<NxPortedGame | null> {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(apkPath);
      if (!stat.isFile()) return null;
    } catch {
      return null;
    }

    const rawName = path.basename(apkPath, ".apk");
    const name = cleanGameTitle(rawName) || rawName;
    const titleId = await this.resolvePortTitleId(
      null,
      null,
      path.basename(apkPath),
      name
    );

    return {
      name,
      appPath: apkPath,
      platform: "android",
      titleId,
      bundleId: titleId ? `org.nx2android.${titleId.toLowerCase()}` : null,
      version: null,
      sizeBytes: stat.size,
      generation: titleId?.startsWith("0400") ? "switch2" : "switch1",
      modificationDate: stat.mtimeMs,
    };
  }

  public static getSupportedLanguages(appPath: string): {
    supported: string[];
    defaultLanguage: string;
  } {
    const fallback = [
      "en-US",
      "pt-BR",
      "pt",
      "es-419",
      "es",
      "fr",
      "de",
      "it",
      "ja",
      "ko",
      "zh-Hans",
      "zh-Hant",
    ];
    if (!appPath || !fs.existsSync(appPath)) {
      return { supported: fallback, defaultLanguage: "en-US" };
    }
    const plist = readPlistJson(path.join(appPath, "Contents", "Info.plist"));
    const dmLang =
      typeof plist?.DMLanguage === "string" && plist.DMLanguage.trim()
        ? plist.DMLanguage.trim()
        : "en-US";
    const dmSupported = Array.isArray(plist?.DMSupportedLanguages)
      ? (plist.DMSupportedLanguages as unknown[]).filter(
          (x): x is string => typeof x === "string" && x.trim().length > 0
        )
      : [];

    const supported =
      dmSupported.length > 0
        ? dmSupported
        : Array.from(new Set([dmLang, ...fallback]));
    return { supported, defaultLanguage: dmLang };
  }

  private static matchPortedArtifact(
    buckets: UnifiedSwitchGameBucket[],
    artifact: { titleId: string | null; name: string }
  ): UnifiedSwitchGameBucket | null {
    const normTid = artifact.titleId
      ? (baseApplicationTitleId(artifact.titleId) ??
        artifact.titleId.toUpperCase())
      : null;

    if (normTid) {
      const byTid = buckets.find((b) => b.titleId === normTid);
      if (byTid) return byTid;
    }

    const strictTarget = NxCompatibilityService.strictAlphaNum(artifact.name);
    if (strictTarget) {
      const byExact = buckets.find(
        (b) => NxCompatibilityService.strictAlphaNum(b.title) === strictTarget
      );
      if (byExact) return byExact;
    }

    let best: UnifiedSwitchGameBucket | null = null;
    let bestScore = 0;
    for (const bucket of buckets) {
      const score = scoreSwitchTitleMatch(artifact.name, bucket.title);
      if (score >= 0.78 && score > bestScore) {
        bestScore = score;
        best = bucket;
      }
    }
    return best;
  }

  private static async syncUnportedDownloadRecord(
    gameKey: string,
    shop: SwitchGeneration,
    objectId: string,
    rom: NxRomGame | null,
    macApp: NxPortedGame | null
  ): Promise<void> {
    if (!rom) return;

    let existingDownload: Download | undefined;
    try {
      existingDownload = await downloadsSublevel.get(gameKey);
    } catch {
      existingDownload = undefined;
    }

    if (
      existingDownload &&
      (existingDownload.queued ||
        existingDownload.extracting ||
        ACTIVE_OR_USER_DOWNLOAD_STATES.has(existingDownload.status ?? ""))
    ) {
      return;
    }

    if (macApp) {
      // Keep any existing download history row intact once ported (step becomes "play"),
      // rather than fabricating a synthetic download for an already-ported title.
      return;
    }

    if (
      existingDownload?.status === "complete" &&
      existingDownload.downloader === Downloader.Torrent
    ) {
      return;
    }

    const downloadPath = rom.isDumpFolder
      ? path.dirname(rom.folderPath)
      : path.dirname(rom.baseFilePath);
    const folderName = rom.isDumpFolder
      ? path.basename(rom.folderPath)
      : path.basename(rom.baseFilePath);

    await downloadsSublevel.put(gameKey, {
      shop,
      objectId,
      uri: rom.baseFilePath,
      folderName,
      downloadPath,
      progress: 1,
      downloader: existingDownload?.downloader ?? Downloader.DirectHttp,
      bytesDownloaded: rom.totalSizeBytes,
      fileSize: rom.totalSizeBytes,
      shouldSeed: false,
      status: "complete",
      queued: false,
      pinnedToHero: false,
      timestamp: existingDownload?.timestamp ?? Date.now(),
      extracting: false,
      automaticallyExtract: false,
      automaticallyDeleteArchiveFiles: false,
    });
  }

  /**
   * Scans configured Switch 1 & 2 ROM folders + Output ported folder (.app, .ipa, .apk),
   * groups all artifacts per Base Title ID, keeps unported ROMs represented as
   * downloaded-but-not-installed games, refreshes covers/heroes, and cleans up stale entries.
   */
  public static async scanAndSyncToLibrary(): Promise<{
    roms: NxRomGame[];
    ported: NxPortedGame[];
    syncedCount: number;
  }> {
    let prefs: UserPreferences | null = null;
    try {
      prefs = (await db.get<string, UserPreferences>(
        levelKeys.userPreferences,
        { valueEncoding: "json" }
      )) as UserPreferences;
    } catch {
      prefs = null;
    }

    const switch1Folders = [...(prefs?.switch1RomFolders || [])];
    const switch2Folders = [...(prefs?.switch2RomFolders || [])];
    const outputDir = await NxPathsService.getOutputDirectory();

    const defaultNintendoRoot = "/Volumes/Nintendo/Games";
    if (fs.existsSync(defaultNintendoRoot)) {
      const s1Default = path.join(defaultNintendoRoot, "Switch 1");
      if (fs.existsSync(s1Default) && !switch1Folders.includes(s1Default)) {
        switch1Folders.push(s1Default);
      }
      if (!switch1Folders.includes(defaultNintendoRoot)) {
        switch1Folders.push(defaultNintendoRoot);
      }
      if (!switch2Folders.includes(defaultNintendoRoot)) {
        switch2Folders.push(defaultNintendoRoot);
      }
    }

    const s1Items: NxRomFileItem[] = [];
    for (const dir of switch1Folders) {
      s1Items.push(...this.scanRomDirectory(dir, "switch1"));
    }
    const s2Items: NxRomFileItem[] = [];
    for (const dir of switch2Folders) {
      s2Items.push(...this.scanRomDirectory(dir, "switch2"));
    }

    const [s1Roms, s2Roms, portedGames] = await Promise.all([
      this.groupRomFiles(s1Items, "switch1"),
      this.groupRomFiles(s2Items, "switch2"),
      this.scanPortedOutputDirectory(outputDir),
    ]);

    const allRoms = [...s1Roms, ...s2Roms];
    this.cachedRomGames = allRoms;
    this.cachedPortedGames = portedGames;

    const buckets: UnifiedSwitchGameBucket[] = [];

    // 1. Seed buckets from ROMs (unported or already ported)
    for (const rom of allRoms) {
      const normalizedTid = rom.titleId
        ? (baseApplicationTitleId(rom.titleId) ?? rom.titleId.toUpperCase())
        : null;
      const existingBucket = this.matchPortedArtifact(buckets, {
        titleId: normalizedTid,
        name: rom.name,
      });
      if (existingBucket) {
        if (!existingBucket.rom) existingBucket.rom = rom;
        continue;
      }

      const objectId = normalizedTid || rom.id;
      const shop: SwitchGeneration =
        normalizedTid?.startsWith("0400") || rom.generation === "switch2"
          ? "switch2"
          : "switch1";
      buckets.push({
        key: levelKeys.game(shop, objectId),
        shop,
        objectId,
        titleId: normalizedTid,
        title: rom.name,
        rom,
        macApp: null,
        iosIpa: null,
        androidApk: null,
      });
    }

    // 2. Attach .app, .ipa, and .apk artifacts into unified per-game buckets
    for (const ported of portedGames) {
      const normTid = ported.titleId
        ? (baseApplicationTitleId(ported.titleId) ??
          ported.titleId.toUpperCase())
        : null;
      let bucket = this.matchPortedArtifact(buckets, {
        titleId: normTid,
        name: ported.name,
      });

      if (!bucket) {
        const shop: SwitchGeneration =
          normTid?.startsWith("0400") || ported.generation === "switch2"
            ? "switch2"
            : "switch1";
        const objectId =
          normTid ||
          `port_${NxCompatibilityService.strictAlphaNum(ported.name)}`;
        bucket = {
          key: levelKeys.game(shop, objectId),
          shop,
          objectId,
          titleId: normTid,
          title: ported.name,
          rom: null,
          macApp: null,
          iosIpa: null,
          androidApk: null,
        };
        buckets.push(bucket);
      }

      if (ported.platform === "macApp") {
        if (
          !bucket.macApp ||
          ported.modificationDate > bucket.macApp.modificationDate
        ) {
          bucket.macApp = ported;
        }
        if (ported.name) bucket.title = ported.name;
      } else if (ported.platform === "ios") {
        if (
          !bucket.iosIpa ||
          ported.modificationDate > bucket.iosIpa.modificationDate
        ) {
          bucket.iosIpa = ported;
        }
      } else if (ported.platform === "android") {
        if (
          !bucket.androidApk ||
          ported.modificationDate > bucket.androidApk.modificationDate
        ) {
          bucket.androidApk = ported;
        }
      }

      if (!bucket.titleId && normTid) {
        bucket.titleId = normTid;
      }
    }

    const syncedGameKeys = new Set<string>();
    const artworkQueries: ArtworkQuery[] = [];
    let syncedCount = 0;

    for (const bucket of buckets) {
      const {
        shop,
        objectId,
        titleId,
        title,
        rom,
        macApp,
        iosIpa,
        androidApk,
      } = bucket;
      const gameKey = levelKeys.game(shop, objectId);
      syncedGameKeys.add(gameKey);

      const canonicalTitle = await NxCompatibilityService.resolveCanonicalTitle(
        titleId,
        macApp?.name || title
      );

      const artworkQuery: ArtworkQuery = {
        titleId,
        title: canonicalTitle,
        switchPortedAppPath: macApp?.appPath ?? null,
        switchPortedIpaPath: iosIpa?.appPath ?? null,
        objectId,
      };
      artworkQueries.push(artworkQuery);

      const [coverUrl, heroUrl] = await Promise.all([
        NxArtworkService.resolveCoverForGame(artworkQuery),
        NxArtworkService.resolveHeroForGame(artworkQuery),
      ]);

      let existing: Game | null = null;
      try {
        existing = (await gamesSublevel.get(gameKey)) ?? null;
      } catch {
        existing = null;
      }

      const executablePath = macApp?.appPath ?? null;
      const installedSizeInBytes = macApp ? macApp.sizeBytes : null;
      const installerSizeInBytes = rom ? rom.totalSizeBytes : null;

      if (existing) {
        await updateGameRecord(gameKey, (current) => ({
          ...current,
          title: canonicalTitle || current.title,
          isDeleted: false,
          platform:
            shop === "switch2" ? "Nintendo Switch 2" : "Nintendo Switch",
          switchTitleId: titleId || current.switchTitleId || null,
          switchGeneration: shop,
          switchRomPath: rom ? rom.folderPath : null,
          switchPortedAppPath: macApp?.appPath ?? null,
          switchPortedIpaPath: iosIpa?.appPath ?? null,
          switchPortedApkPath: androidApk?.appPath ?? null,
          executablePath,
          romSizeBytes: rom?.totalSizeBytes,
          installerSizeInBytes,
          installedSizeInBytes,
          catalogueGame: undefined,
          macOSCompatibility: undefined,
          logoImageUrl: null,
          iconUrl: coverUrl ?? current.iconUrl,
          libraryHeroImageUrl:
            heroUrl ?? coverUrl ?? current.libraryHeroImageUrl,
        }));
      } else {
        const addedAt = macApp ? new Date(macApp.modificationDate) : new Date();
        const newGame: Game = {
          title: canonicalTitle,
          iconUrl: coverUrl,
          libraryHeroImageUrl: heroUrl ?? coverUrl,
          logoImageUrl: null,
          playTimeInMilliseconds: 0,
          lastTimePlayed: null,
          addedToLibraryAt: addedAt,
          objectId,
          shop,
          remoteId: null,
          isDeleted: false,
          platform:
            shop === "switch2" ? "Nintendo Switch 2" : "Nintendo Switch",
          executablePath,
          romSizeBytes: rom?.totalSizeBytes,
          installerSizeInBytes,
          installedSizeInBytes,
          switchTitleId: titleId,
          switchGeneration: shop,
          switchRomPath: rom ? rom.folderPath : null,
          switchPortedAppPath: macApp?.appPath ?? null,
          switchPortedIpaPath: iosIpa?.appPath ?? null,
          switchPortedApkPath: androidApk?.appPath ?? null,
        };
        await gamesSublevel.put(gameKey, newGame);
      }

      if (coverUrl || heroUrl) {
        await gamesShopAssetsSublevel.put(gameKey, {
          objectId,
          shop,
          title: canonicalTitle,
          iconUrl: coverUrl,
          libraryHeroImageUrl: heroUrl ?? coverUrl,
          libraryImageUrl: coverUrl ?? heroUrl,
          logoImageUrl: null,
          logoPosition: null,
          coverImageUrl: coverUrl ?? heroUrl,
          downloadSources: [],
          updatedAt: Date.now(),
        });
      }

      await this.syncUnportedDownloadRecord(
        gameKey,
        shop,
        objectId,
        rom,
        macApp
      );
      syncedCount++;
    }

    // 3. Stale cleanup for removed local Switch ROMs / ports
    try {
      for await (const [key, game] of gamesSublevel.iterator()) {
        if (game.shop !== "switch1" && game.shop !== "switch2") continue;
        if (syncedGameKeys.has(key)) continue;

        const hasLocalOrigin = Boolean(
          game.switchRomPath ||
            game.switchPortedAppPath ||
            game.switchPortedIpaPath ||
            game.switchPortedApkPath
        );
        if (!hasLocalOrigin) continue;

        const anyPathStillExists = [
          game.switchRomPath,
          game.switchPortedAppPath,
          game.switchPortedIpaPath,
          game.switchPortedApkPath,
        ].some((p) => Boolean(p && fs.existsSync(p)));
        if (anyPathStillExists) continue;

        let dl: Download | undefined;
        try {
          dl = await downloadsSublevel.get(key);
        } catch {
          dl = undefined;
        }
        if (
          dl &&
          (dl.queued ||
            dl.extracting ||
            ACTIVE_OR_USER_DOWNLOAD_STATES.has(dl.status ?? ""))
        ) {
          continue;
        }

        if (
          !game.isDeleted ||
          game.executablePath ||
          game.installedSizeInBytes != null
        ) {
          await updateGameRecord(key, (current) => ({
            ...current,
            isDeleted: true,
            executablePath: null,
            installedSizeInBytes: null,
            installerSizeInBytes: null,
            switchRomPath: null,
            switchPortedAppPath: null,
            switchPortedIpaPath: null,
            switchPortedApkPath: null,
          }));
        }
        if (
          dl?.status === "complete" &&
          dl.downloader === Downloader.DirectHttp
        ) {
          await downloadsSublevel.del(key).catch(() => {});
        }
      }
    } catch {
      // Non-fatal stale cleanup error
    }

    if (artworkQueries.length > 0) {
      void NxArtworkService.ensureCoversForGames(artworkQueries, 4).catch(
        () => {}
      );
    }

    AppLogHub.info(
      "nxnative",
      `Scanner sincronizou biblioteca: ${allRoms.length} ROMs detectadas, ${portedGames.length} builds (.app/.ipa/.apk) em ${outputDir}.`
    );

    try {
      WindowManager.sendToAppWindows("on-nx-library-updated", {
        romsCount: allRoms.length,
        portedCount: portedGames.length,
      });
      WindowManager.sendDownloadsUpdated();
    } catch {
      // ignore if window not open yet
    }

    return { roms: allRoms, ported: portedGames, syncedCount };
  }
}
