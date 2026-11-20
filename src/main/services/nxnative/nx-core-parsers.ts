import crypto from "node:crypto";
import type {
  ControllerProfile,
  NxGameRuntimeConfig,
  SwitchButton,
  SwitchGeneration,
} from "../../../types/nxnative.types.js";

export const NXN_MAGIC_HEADER = Buffer.from([
  0x4e, 0x58, 0x4e, 0x5f, 0x50, 0x52, 0x45, 0x53, 0x45, 0x54, 0x01, 0x00,
]); // "NXN_PRESET\x01\x00"

const FIRMWARE_REVISIONS = [
  "1.0.0",
  "3.0.0",
  "3.0.1",
  "4.0.0",
  "5.0.0",
  "6.0.0",
  "6.2.0",
  "7.0.0",
  "8.1.0",
  "9.0.0",
  "9.1.0",
  "12.1.0",
  "13.0.0",
  "14.0.0",
  "15.0.0",
  "16.0.0",
  "17.0.0",
  "18.0.0",
  "19.0.0",
  "20.0.0",
  "21.0.0",
];

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

export function parseProdKeysText(text: string): Record<string, Buffer> {
  const keys: Record<string, Buffer> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const idx = rawLine.indexOf("=");
    if (idx < 0) continue;
    const name = rawLine.slice(0, idx).trim().toLowerCase();
    const valStr = rawLine
      .slice(idx + 1)
      .split(/[;#]/)[0]
      .trim();
    if (!name || !valStr || valStr.length % 2 !== 0) continue;
    if (!/^[0-9a-fA-F]+$/.test(valStr)) continue;
    keys[name] = Buffer.from(valStr, "hex");
  }
  return keys;
}

export function inspectProdKeysText(content: string): {
  isValid: boolean;
  keyCount: number;
  highestMasterRev: number;
  firmwareSummary?: string;
  error?: string;
} {
  const keys = parseProdKeysText(content);
  const keyCount = Object.keys(keys).length;
  const headerKey =
    keys.header_key || keys.header_key_00 || keys.nca_header_key;
  if (!headerKey || headerKey.length !== 32) {
    return {
      isValid: false,
      keyCount,
      highestMasterRev: -1,
      error: "header_key ausente ou inválida (esperados 32 bytes).",
    };
  }

  let highestMaster = -1;
  for (const k of Object.keys(keys)) {
    const m = /^master_key_([0-9a-f]{2})$/.exec(k);
    if (m) {
      const rev = Number.parseInt(m[1], 16);
      if (rev > highestMaster) highestMaster = rev;
    }
  }

  const fw =
    highestMaster >= 0 && highestMaster < FIRMWARE_REVISIONS.length
      ? `Firmware até ${FIRMWARE_REVISIONS[highestMaster]} (${keyCount} chaves)`
      : `${keyCount} chaves válidas`;

  return {
    isValid: true,
    keyCount,
    highestMasterRev: highestMaster,
    firmwareSummary: fw,
  };
}

export function deriveNxnPresetKey(): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from("NxNative_NxN_Preset_Secret_Key_2026", "utf8"),
      Buffer.from("NxNative_Preset_v1_Salt", "utf8"),
      Buffer.from("NxNative_Preset_Payload_AES256GCM", "utf8"),
      32
    )
  );
}

export function encryptNxnPresetBuffer(
  metadata: { presetName: string; titleId: string; notes?: string },
  payload: Partial<NxGameRuntimeConfig>
): Buffer {
  const metaBuf = Buffer.from(JSON.stringify(metadata), "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(metaBuf.length, 0);

  const key = deriveNxnPresetKey();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([
    NXN_MAGIC_HEADER,
    lenBuf,
    metaBuf,
    nonce,
    ciphertext,
    tag,
  ]);
}

export function decryptNxnPresetBuffer(data: Buffer): {
  metadata: { presetName?: string; titleId?: string; notes?: string };
  config: Partial<NxGameRuntimeConfig>;
} {
  if (data.length < NXN_MAGIC_HEADER.length + 4 + 28) {
    throw new Error("Arquivo .nxn corrompido ou incompleto.");
  }
  if (!data.subarray(0, NXN_MAGIC_HEADER.length).equals(NXN_MAGIC_HEADER)) {
    throw new Error("Assinatura mágica .nxn inválida.");
  }
  const metaLen = data.readUInt32BE(NXN_MAGIC_HEADER.length);
  const metaStart = NXN_MAGIC_HEADER.length + 4;
  const metaEnd = metaStart + metaLen;
  if (metaEnd >= data.length - 28) {
    throw new Error("Metadados .nxn inválidos.");
  }

  const metadata = JSON.parse(
    data.subarray(metaStart, metaEnd).toString("utf8")
  ) as { presetName?: string; titleId?: string; notes?: string };

  const combined = data.subarray(metaEnd);
  const nonce = combined.subarray(0, 12);
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);

  const key = deriveNxnPresetKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  const config = JSON.parse(
    decrypted.toString("utf8")
  ) as Partial<NxGameRuntimeConfig>;

  return { metadata, config };
}

export function isLikelySwitchSourceUrl(urlString: string): boolean {
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

export function normalizeSwitchTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\.(nsp|xci|nsz|zip|7z)$/i, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\([^)]+\)/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function classifySwitchGeneration(
  titleId?: string | null,
  headingOrHint?: string | null
): SwitchGeneration {
  const tid = (titleId || "").trim().toUpperCase();
  if (tid.startsWith("0400")) return "switch2";
  const hint = (headingOrHint || "").toLowerCase();
  if (
    hint.includes("switch 2") ||
    hint.includes("switch2") ||
    hint.includes("ns2")
  ) {
    return "switch2";
  }
  return "switch1";
}

export function parseRamRequirementGB(reqText: string): number {
  const match = /(\d+)\s*GB/i.exec(reqText);
  if (!match) return 0;
  return Number.parseInt(match[1], 10) || 0;
}

export function buildSdlGameControllerEnvForProfile(
  profile: ControllerProfile
): Record<string, string> {
  const isNintendoFaceLayout =
    profile.gamepadBindings.buttonB === "A" &&
    profile.gamepadBindings.buttonA === "B";

  const physicalToSdl = (elem: string): string => {
    switch (elem) {
      case "buttonA":
        return "b0";
      case "buttonB":
        return "b1";
      case "buttonX":
        return "b2";
      case "buttonY":
        return "b3";
      case "leftShoulder":
        return "b9";
      case "rightShoulder":
        return "b10";
      case "buttonMenu":
        return "b6";
      case "buttonOptions":
        return "b4";
      case "leftThumbstickButton":
        return "b7";
      case "rightThumbstickButton":
        return "b8";
      case "dpad.up":
        return "b11";
      case "dpad.down":
        return "b12";
      case "dpad.left":
        return "b13";
      case "dpad.right":
        return "b14";
      default:
        return "";
    }
  };

  const switchToSdlLogical: Partial<Record<SwitchButton, string>> = {
    A: isNintendoFaceLayout ? "b" : "a",
    B: isNintendoFaceLayout ? "a" : "b",
    X: isNintendoFaceLayout ? "y" : "x",
    Y: isNintendoFaceLayout ? "x" : "y",
    L: "leftshoulder",
    R: "rightshoulder",
    Plus: "start",
    Minus: "back",
    L3: "leftstick",
    R3: "rightstick",
    Up: "dpup",
    Down: "dpdown",
    Left: "dpleft",
    Right: "dpright",
  };

  const mappings: string[] = [
    "leftx:a0",
    "lefty:a1",
    "rightx:a2",
    "righty:a3",
    "lefttrigger:a4",
    "righttrigger:a5",
  ];

  for (const [phys, swBtn] of Object.entries(profile.gamepadBindings)) {
    const sdlPhys = physicalToSdl(phys);
    const sdlLog = switchToSdlLogical[swBtn];
    if (sdlPhys && sdlLog) {
      mappings.push(`${sdlLog}:${sdlPhys}`);
    }
  }

  const mappingTail = `${mappings.join(",")},platform:Mac OS X,`;
  const commonGuids = [
    "030000005e040000130b000017050000,Xbox Wireless Controller",
    "030000004c050000e60c000000010000,PS5 DualSense Controller",
    "030000004c050000cc09000000010000,PS4 DualShock 4 Controller",
    "030000007e0500000920000001000000,Nintendo Switch Pro Controller",
  ];
  const sdlConfig = commonGuids.map((g) => `${g},${mappingTail}`).join("\n");

  return {
    SDL_GAMECONTROLLERCONFIG: sdlConfig,
    SDL_GAMECONTROLLER_USE_BUTTON_LABELS: isNintendoFaceLayout ? "1" : "0",
    CERBERUS_CONTROLLER_PROFILE: profile.name,
    CERBERUS_CONTROLLER_DEADZONE: profile.analogDeadzone.toFixed(2),
  };
}

export function baseApplicationTitleId(tid: string): string | null {
  const trimmed = tid.trim().toUpperCase();
  if (!/^[0-9A-F]{16}$/.test(trimmed)) return null;
  try {
    const val = BigInt(`0x${trimmed}`);
    const low = val & 0xfffn;
    let baseVal: bigint;
    if (low === 0n) {
      baseVal = val;
    } else if (low === 0x800n) {
      baseVal = val & ~0xfffn;
    } else {
      baseVal = (val & ~0xfffn) - 0x1000n;
    }
    return baseVal.toString(16).toUpperCase().padStart(16, "0");
  } catch {
    return null;
  }
}

export function extractArtworkUrls(
  entry: Record<string, unknown> | null | undefined
): { icon: string | null; banner: string | null } {
  if (!entry || typeof entry !== "object") {
    return { icon: null, banner: null };
  }
  const pickStr = (...keys: string[]): string | null => {
    for (const k of keys) {
      const val = entry[k];
      if (typeof val === "string" && val.trim().length > 0) {
        return val.trim();
      }
    }
    return null;
  };
  return {
    icon: pickStr("icon", "iconUrl"),
    banner: pickStr("banner", "bannerUrl"),
  };
}

const TITLE_STOP_WORDS = new Set([
  "the",
  "of",
  "a",
  "an",
  "and",
  "to",
  "in",
  "for",
  "on",
  "edition",
  "nintendo",
  "switch",
  "deluxe",
  "hd",
  "remastered",
  "remake",
  "definitive",
  "complete",
  "collection",
  "version",
  "bundle",
  "pack",
  "asian",
  "japanese",
  "chinese",
  "base",
  "update",
  "dlc",
  "nsp",
  "xci",
  "nsz",
  "nup",
  "rom",
  "roms",
  "usa",
  "eur",
  "jpn",
  "game",
  "release",
]);

const DISTINCTIVE_SEQUEL_TOKENS = new Set([
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "ix",
  "x",
  "xi",
  "xii",
  "za",
  "z",
  "hd",
  "dx",
  "reimagined",
  "pokopia",
  "arceus",
  "scarlet",
  "violet",
  "sword",
  "shield",
  "ocarina",
  "awakening",
  "skyward",
  "breath",
  "tears",
  "echoes",
  "legends",
]);

function stripTitleNoise(raw: string): string {
  return raw
    .replace(/\.(nsp|nsz|nzs|xci|xcz|nup|nca|app|ipa|apk|zip|7z|rar)$/i, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/™|®|©/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function tokenizeSwitchTitle(raw: string): string[] {
  const cleaned = stripTitleNoise(raw)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!cleaned) return [];
  const rawTokens = cleaned.split(/\s+/).filter(Boolean);
  const filtered = rawTokens.filter(
    (tok) => !TITLE_STOP_WORDS.has(tok) || tok === "hd"
  );
  return filtered.length > 0 ? filtered : rawTokens;
}

export function scoreSwitchTitleMatch(
  query: string,
  candidate: string
): number {
  const qFolded = stripTitleNoise(query).replace(/[^a-z0-9]/g, "");
  const cFolded = stripTitleNoise(candidate).replace(/[^a-z0-9]/g, "");
  if (!qFolded || !cFolded) return 0;
  if (qFolded === cFolded) return 1.0;

  const qTokens = tokenizeSwitchTitle(query);
  const cTokens = tokenizeSwitchTitle(candidate);
  if (qTokens.length === 0 || cTokens.length === 0) return 0;

  const qSet = new Set(qTokens);
  const cSet = new Set(cTokens);

  // Reject mismatches on distinctive sequel numbers/subtitles (e.g. "ocarina" vs "breath", "2" vs none, "za" vs "pokopia")
  for (const tok of qSet) {
    if (
      (DISTINCTIVE_SEQUEL_TOKENS.has(tok) || /^\d+$/.test(tok)) &&
      !cSet.has(tok)
    ) {
      return 0;
    }
  }
  for (const tok of cSet) {
    if (
      (DISTINCTIVE_SEQUEL_TOKENS.has(tok) || /^\d+$/.test(tok)) &&
      !qSet.has(tok)
    ) {
      return 0;
    }
  }

  let overlap = 0;
  for (const tok of qSet) {
    if (cSet.has(tok)) overlap++;
  }
  if (overlap === 0) return 0;

  const minLen = Math.min(qSet.size, cSet.size);
  if (minLen >= 2 && overlap < 2) return 0;

  const dice = (2 * overlap) / (qSet.size + cSet.size);
  const coverage = overlap / Math.max(qSet.size, cSet.size);
  return Math.min(0.99, dice * 0.65 + coverage * 0.35);
}

export function getSwitchPortButtonState(params: {
  isSwitchGame: boolean;
  hasMacPort: boolean;
  hasIosPort: boolean;
}): {
  showPlay: boolean;
  showPrimaryPort: boolean;
  showSecondaryPort: boolean;
} {
  if (!params.isSwitchGame) {
    return {
      showPlay: false,
      showPrimaryPort: false,
      showSecondaryPort: false,
    };
  }
  if (!params.hasMacPort) {
    return {
      showPlay: false,
      showPrimaryPort: true,
      showSecondaryPort: false,
    };
  }
  return {
    showPlay: true,
    showPrimaryPort: false,
    showSecondaryPort: !params.hasIosPort,
  };
}

export function decodeHtmlEntitiesText(raw: string): string {
  return raw
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : " ";
    });
}

export function cleanPortalCardTitle(raw: string): string {
  const decoded = decodeHtmlEntitiesText(raw)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!decoded || /^(download(\s+now)?|read\s+more|view(\s+game)?)$/i.test(decoded)) {
    return "";
  }
  return decoded
    .replace(
      /^(?:Final\s+Release|Early\s+Access|Pre-Release|Demo|Beta|Alpha|Full\s+Game|Updated)\s+/i,
      ""
    )
    .replace(
      /\s+(?:19|20)\d{2}(?:\s*[•·|-]\s*[\d.,]+\s*(?:MB|GB|KB|TB))?$/i,
      ""
    )
    .replace(/\s*[•·|-]\s*[\d.,]+\s*(?:MB|GB|KB|TB)$/i, "")
    .replace(
      /\s+(?:Nintendo\s+Switch(?:\s+2)?\s+)?(?:NSP|XCI|NSZ|NUP|ROM|ROMs)(?:\s+Download)?$/i,
      ""
    )
    .trim();
}

export function extractPortalSlugCandidates(urlOrPath: string): string[] {
  let decoded = urlOrPath;
  try {
    decoded = decodeURIComponent(urlOrPath);
  } catch {
    // ignore invalid URI encoding
  }
  const cleanPath = decoded.split(/[?#]/)[0];
  const lastSegment =
    cleanPath
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/\.(html?|php|nsp|xci|nsz|nup|zip|rar|7z)$/i, "") || "";
  if (!lastSegment) return [];

  const stripFormatSuffixes = (s: string) =>
    s
      .replace(
        /[-_]+(?:switch[-_]?2|nintendo[-_]?switch(?:[-_]?2)?|nsp|xci|nsz|nup|rom|roms|free|download)(?:[-_]+\d+[a-z]?)?$/gi,
        ""
      )
      .replace(/[-_]+(?:p\d+|x\d+[a-z]*|\d+[a-z])$/i, "");

  const base1 = stripFormatSuffixes(lastSegment)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // RomsHQ & NSWPedia frequently append a numeric deduplication ID (-1, -2, -6, -9, -64)
  const base2 = stripFormatSuffixes(lastSegment)
    .replace(/[-_]+\d+[a-z]?$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const base3 = lastSegment
    .replace(/[-_]+/g, " ")
    .replace(/\b(?:nsp|xci|nsz|nup|rom|roms|switch2|switch)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const out: string[] = [];
  for (const cand of [base1, base2, base3]) {
    if (cand && !out.includes(cand)) {
      out.push(cand);
    }
  }
  return out;
}

export function extractBlueRomsDownloadPath(html: string): string | null {
  const match = /href=["']((?:https?:\/\/(?:www\.)?blueroms\.ws)?\/download\/[^"']+)["']/i.exec(
    html
  );
  return match?.[1] ?? null;
}

export function decodeBlueRomsDataLink(html: string): string | null {
  const match = /data-link=["']([^"']+)["']/i.exec(html);
  if (!match?.[1]) return null;
  try {
    const decoded = Buffer.from(match[1].trim(), "base64")
      .toString("utf8")
      .trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function extractNswpediaDownloadLinks(
  html: string,
  baseUrl = "https://nswpedia.com"
): {
  downloadPages: string[];
  directLinks: string[];
  downloadListPages: string[];
} {
  const downloadPages: string[] = [];
  const directLinks: string[] = [];
  const downloadListPages: string[] = [];

  const resolveUrl = (raw: string): string => {
    const cleaned = raw.replace(/&amp;/g, "&").trim();
    if (
      cleaned.startsWith("http://") ||
      cleaned.startsWith("https://") ||
      cleaned.startsWith("magnet:")
    ) {
      return cleaned;
    }
    try {
      return new URL(cleaned, baseUrl).toString();
    } catch {
      return cleaned;
    }
  };

  const pageRe =
    /href=["']((?:https?:\/\/(?:www\.)?nswpedia\.com)?\/download(?:_list)?\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = pageRe.exec(html)) !== null) {
    const u = resolveUrl(m[1]);
    if (u.includes("/download_list")) {
      if (!downloadListPages.includes(u)) downloadListPages.push(u);
    } else if (!downloadPages.includes(u)) {
      downloadPages.push(u);
    }
  }

  const directRe = /id=["']download-link["'][^>]*href=["']([^"']+)["']/gi;
  while ((m = directRe.exec(html)) !== null) {
    const u = resolveUrl(m[1]);
    if (u && !directLinks.includes(u)) directLinks.push(u);
  }
  const directAltRe = /href=["']([^"']+)["'][^>]*id=["']download-link["']/gi;
  while ((m = directAltRe.exec(html)) !== null) {
    const u = resolveUrl(m[1]);
    if (u && !directLinks.includes(u)) directLinks.push(u);
  }

  return { downloadPages, directLinks, downloadListPages };
}

const FREE_DIRECT_HOSTER_SNIPPETS = [
  "filekeeper.net",
  "gofile.io",
  "pixeldrain.com",
  "mediafire.com",
  "fuckingfast.co",
  "rootz.so",
  "archive.org",
  "drive.google.com",
];

const API_SUPPORTED_GATED_HOSTERS = ["datanodes.to", "vikingfile.com"];
const SLOW_GATED_HOSTERS = ["1fichier.com"];

const SUPPORTED_HOSTER_SNIPPETS = [
  ...FREE_DIRECT_HOSTER_SNIPPETS,
  ...API_SUPPORTED_GATED_HOSTERS,
  ...SLOW_GATED_HOSTERS,
];

export function extractRomsHqDownloadLinks(
  html: string,
  baseUrl: string
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const addLink = (raw: string) => {
    const trimmed = raw.trim();
    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("javascript:")
    )
      return;
    let resolved = trimmed;
    if (
      !trimmed.startsWith("magnet:") &&
      !trimmed.startsWith("http://") &&
      !trimmed.startsWith("https://")
    ) {
      try {
        resolved = new URL(trimmed, baseUrl).toString();
      } catch {
        return;
      }
    }
    if (!seen.has(resolved)) {
      seen.add(resolved);
      found.push(resolved);
    }
  };

  const magnetRe = /(["'])(magnet:\?xt=urn:btih:[^"'\s<>]+)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = magnetRe.exec(html)) !== null) {
    addLink(m[2].replace(/&amp;/g, "&"));
  }

  const hrefRe = /(?:href|data-url|data-href)=["']([^"']+)["']/gi;
  while ((m = hrefRe.exec(html)) !== null) {
    const link = m[1].replace(/&amp;/g, "&").trim();
    const lower = link.toLowerCase();
    if (
      lower.startsWith("magnet:") ||
      /\.(torrent|nsp|nsz|xci|xcz|nup|zip|7z|rar)(\?|#|$)/i.test(lower) ||
      SUPPORTED_HOSTER_SNIPPETS.some((h) => lower.includes(h))
    ) {
      addLink(link);
    }
  }

  // Prioritize:
  // 0: magnet
  // 1: .torrent
  // 2: direct ROM/archive URLs that are NOT landing pages on known hosters
  // 3: free no-auth direct hosters (FileKeeper, Gofile, PixelDrain, MediaFire, etc.)
  // 4: auth/captcha-gated hosters (Datanodes, VikingFile, 1fichier)
  // Also deprioritize standalone "_emulator" archives and updates below Base_Game archives.
  const scoreUrl = (u: string): number => {
    const l = u.toLowerCase();
    const penalty =
      l.includes("_emulator") || l.includes("-emulator")
        ? 20
        : l.includes("_update") || l.includes("-update")
          ? 2
          : 0;
    if (l.startsWith("magnet:")) return 0 + penalty;
    if (l.endsWith(".torrent")) return 1 + penalty;
    const isFreeHoster = FREE_DIRECT_HOSTER_SNIPPETS.some((h) => l.includes(h));
    const isApiGatedHoster = API_SUPPORTED_GATED_HOSTERS.some((h) =>
      l.includes(h)
    );
    const isSlowGatedHoster = SLOW_GATED_HOSTERS.some((h) => l.includes(h));
    if (
      !isFreeHoster &&
      !isApiGatedHoster &&
      !isSlowGatedHoster &&
      /\.(nsp|nsz|xci|xcz|nup|zip|7z|rar)(\?|#|$)/i.test(l)
    ) {
      return 2 + penalty;
    }
    if (isFreeHoster) return 3 + penalty;
    if (isApiGatedHoster) return 5 + penalty;
    if (isSlowGatedHoster) return 6 + penalty;
    return 8 + penalty;
  };
  return found.sort((a, b) => scoreUrl(a) - scoreUrl(b));
}
