import type { MacNativeDownloadOption } from "@types";

export interface ParsedMacNativeCard {
  source: "appstorrent" | "torrentmac";
  sourceLabel: string;
  title: string;
  normalizedTitle: string;
  version: string | null;
  detailUrl: string;
  coverUrl: string | null;
  iconUrl: string | null;
  fileSize: string | null;
  publishedAt: string | null;
  summary: string | null;
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#8217;/g, "'")
    .replace(/&#8230;/g, "...")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripHtmlTags(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]+>/g, " "));
}

export function normalizeRussianSize(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = decodeHtmlEntities(raw)
    .replace(/,/g, ".")
    .replace(/ГБ/gi, "GB")
    .replace(/МБ/gi, "MB")
    .replace(/КБ/gi, "KB")
    .replace(/ТБ/gi, "TB")
    .trim();
  const m = /\b(\d+(?:\.\d+)?\s*(?:TB|GB|MB|KB))\b/i.exec(cleaned);
  return m ? m[1].toUpperCase() : cleaned || null;
}

export function splitTitleAndVersion(rawTitle: string): {
  title: string;
  version: string | null;
} {
  const decoded = decodeHtmlEntities(rawTitle);
  // Match trailing version like "Crimson Desert 2.03.02", "Frostpunk 2 1.5.3", "Rebel Cops v1.0.7.0 (2019)"
  const cleanedYear = decoded.replace(/\s*\(\d{4}\)\s*$/i, "").trim();
  const verMatch =
    /\s+(v?\d+\.\d+(?:\.\d+)*(?:\s*\(\d+\))?)\s*$/i.exec(cleanedYear);
  if (verMatch && cleanedYear.length - verMatch[0].length >= 3) {
    return {
      title: cleanedYear.slice(0, verMatch.index).trim(),
      version: verMatch[1].replace(/^v/i, "").trim(),
    };
  }
  return { title: cleanedYear, version: null };
}

export function normalizeMacNativeTitle(raw: string): string {
  const { title } = splitTitleAndVersion(raw);
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/\b(macos|mac os|arm64|apple silicon|universal|u2b|enhanced|repack)\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildMacNativeObjectId(normalizedTitle: string): string {
  const slug = normalizedTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "mac-game";
}

function resolveUrl(base: string, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = decodeHtmlEntities(raw).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return null;
  }
}

function pickBestSrcFromImgTag(imgTag: string, baseUrl: string): string | null {
  const srcsetMatch = /srcset=["']([^"']+)["']/i.exec(imgTag);
  if (srcsetMatch) {
    const candidates = srcsetMatch[1]
      .split(",")
      .map((part) => {
        const tokens = part.trim().split(/\s+/);
        const url = tokens[0];
        const descriptor = tokens[1] || "1x";
        const weight = descriptor.endsWith("w")
          ? Number.parseInt(descriptor, 10) || 0
          : descriptor.endsWith("x")
            ? Math.round((Number.parseFloat(descriptor) || 1) * 1000)
            : 0;
        return { url, weight };
      })
      .filter((c) => Boolean(c.url))
      .sort((a, b) => b.weight - a.weight);
    if (candidates[0]) {
      return resolveUrl(baseUrl, candidates[0].url);
    }
  }

  const srcMatch = /(?:data-src|src)=["']([^"']+)["']/i.exec(imgTag);
  return srcMatch ? resolveUrl(baseUrl, srcMatch[1]) : null;
}

export function parseAppstorrentListingHtml(html: string): ParsedMacNativeCard[] {
  const BASE = "https://appstorrent.ru";
  const results: ParsedMacNativeCard[] = [];
  const seen = new Set<string>();

  const articleRegex = /<article\s+class="games-item[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;
  while ((match = articleRegex.exec(html)) !== null) {
    const block = match[1];
    const hrefMatch = /href=["'](\/\d+-[^"']+\.html)["']/i.exec(block);
    if (!hrefMatch) continue;
    const detailUrl = resolveUrl(BASE, hrefMatch[1]);
    if (!detailUrl || seen.has(detailUrl)) continue;
    seen.add(detailUrl);

    const titleMatch =
      /<h2[^>]*class="[^"]*body-2[^"]*"[^>]*>([\s\S]*?)<\/h2>/i.exec(block) ||
      /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(block);
    const rawTitle = titleMatch ? stripHtmlTags(titleMatch[1]) : "";
    if (!rawTitle) continue;

    const { title, version } = splitTitleAndVersion(rawTitle);
    const normalizedTitle = normalizeMacNativeTitle(title);
    if (!normalizedTitle) continue;

    const coverBlock = /<div\s+class="cover"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    const coverImgTag = coverBlock ? /<img[^>]+>/i.exec(coverBlock[1]) : null;
    const coverUrl = coverImgTag
      ? pickBestSrcFromImgTag(coverImgTag[0], BASE)
      : null;

    const iconBlock = /<div\s+class="icon"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    const iconImgTag = iconBlock ? /<img[^>]+>/i.exec(iconBlock[1]) : null;
    const iconUrl = iconImgTag
      ? pickBestSrcFromImgTag(iconImgTag[0], BASE)
      : null;

    const sizeBlock =
      /<div\s+class="size"[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i.exec(
        block
      );
    const fileSize = normalizeRussianSize(
      sizeBlock ? stripHtmlTags(sizeBlock[1]) : null
    );

    results.push({
      source: "appstorrent",
      sourceLabel: "Appstorrent",
      title,
      normalizedTitle,
      version,
      detailUrl,
      coverUrl: coverUrl ?? iconUrl,
      iconUrl: iconUrl ?? coverUrl,
      fileSize,
      publishedAt: null,
      summary: null,
    });
  }

  return results;
}

export function parseAppstorrentDetailHtml(
  html: string,
  detailUrl: string,
  gameTitle: string
): { summary: string | null; fileSize: string | null; options: MacNativeDownloadOption[] } {
  const options: MacNativeDownloadOption[] = [];
  const seen = new Set<string>();

  const sizeBtnMatch =
    /<button[^>]*class="[^"]*big green[^"]*"[^>]*>[\s\S]*?\(([^)]+)\)/i.exec(
      html
    );
  const fileSize = normalizeRussianSize(sizeBtnMatch?.[1] ?? null);

  const metaDescMatch =
    /<meta\s+name="description"\s+content="([^"]+)"/i.exec(html);
  const summary = metaDescMatch ? decodeHtmlEntities(metaDescMatch[1]) : null;

  const listLinkMatch = /<div\s+class="list_link"[^>]*>([\s\S]*?)<\/div>/i.exec(
    html
  );
  const searchRegion = listLinkMatch ? listLinkMatch[1] : html;

  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;

  while ((m = linkRegex.exec(searchRegion)) !== null) {
    const rawHref = decodeHtmlEntities(m[1]).trim();
    const label = stripHtmlTags(m[2]);
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("/")) continue;
    if (seen.has(rawHref)) continue;

    const lower = rawHref.toLowerCase();
    const isDirectFile =
      /\.(dmg|pkg|iso|zip|7z|rar)(\?|$)/i.test(lower) &&
      !lower.includes("mediafire.com/file/") &&
      !lower.includes("cloud.mail.ru");
    const isMediafire = lower.includes("mediafire.com/");
    const isTorrent = lower.startsWith("magnet:") || /\.torrent(\?|$)/i.test(lower);
    const isMailRu = lower.includes("cloud.mail.ru/");
    const isOtherHoster =
      lower.includes("gofile.io/") ||
      lower.includes("pixeldrain.com/") ||
      lower.includes("mega.nz/");

    if (!isDirectFile && !isMediafire && !isTorrent && !isMailRu && !isOtherHoster) {
      continue;
    }
    seen.add(rawHref);

    let hoster = "Link Direto";
    if (isTorrent) hoster = "Torrent";
    else if (isDirectFile) hoster = "Direct CDN";
    else if (isMediafire) hoster = "MediaFire";
    else if (isMailRu) hoster = "Mail.ru Cloud";
    else if (lower.includes("gofile.io")) hoster = "Gofile";
    else if (lower.includes("pixeldrain.com")) hoster = "Pixeldrain";
    else if (lower.includes("mega.nz")) hoster = "MEGA";

    idx += 1;
    options.push({
      id: `appstorrent-${idx}-${Buffer.from(rawHref).toString("base64url").slice(0, 14)}`,
      title: `${gameTitle} (${hoster}${label && label.length < 36 && !/[а-яА-Я]/.test(label) ? ` · ${label}` : ""})`,
      source: "appstorrent",
      sourceLabel: "Appstorrent",
      url: rawHref,
      hoster,
      fileSize,
      isTorrent,
      detailUrl,
    });
  }

  // Sort: Direct CDN -> MediaFire -> Torrent -> Gofile/Pixeldrain -> Mail.ru
  const priority = (h: string): number => {
    if (h === "Direct CDN") return 1;
    if (h === "MediaFire") return 2;
    if (h === "Torrent") return 3;
    if (h === "Gofile" || h === "Pixeldrain") return 4;
    return 5;
  };
  options.sort((a, b) => priority(a.hoster) - priority(b.hoster));

  return { summary, fileSize, options };
}

export function parseTorrentMacListingHtml(html: string): ParsedMacNativeCard[] {
  const BASE = "https://www.torrentmac.net";
  const results: ParsedMacNativeCard[] = [];
  const seen = new Set<string>();

  const articleRegex = /<article[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;

  while ((match = articleRegex.exec(html)) !== null) {
    const block = match[1];
    const titleAnchor =
      /<h2[^>]*class="[^"]*post-title[^"]*"[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(
        block
      );
    if (!titleAnchor) continue;

    const detailUrl = resolveUrl(BASE, titleAnchor[1]);
    const rawTitle = stripHtmlTags(titleAnchor[2]);
    if (!detailUrl || !rawTitle || seen.has(detailUrl)) continue;
    seen.add(detailUrl);

    const { title, version } = splitTitleAndVersion(rawTitle);
    const normalizedTitle = normalizeMacNativeTitle(title);
    if (!normalizedTitle) continue;

    const imgMatch = /<img[^>]+wp-post-image[^>]*>/i.exec(block) || /<img[^>]+>/i.exec(block);
    const coverUrl = imgMatch ? pickBestSrcFromImgTag(imgMatch[0], BASE) : null;

    const timeMatch = /<time[^>]+datetime=["']([^"']+)["']/i.exec(block);
    const publishedAt = timeMatch ? timeMatch[1] : null;

    const summaryMatch =
      /<section[^>]*class="[^"]*post_content[^"]*"[^>]*>([\s\S]*?)<\/section>/i.exec(
        block
      );
    const summary = summaryMatch ? stripHtmlTags(summaryMatch[1]) : null;

    results.push({
      source: "torrentmac",
      sourceLabel: "TorrentMac",
      title,
      normalizedTitle,
      version,
      detailUrl,
      coverUrl,
      iconUrl: coverUrl,
      fileSize: null,
      publishedAt,
      summary,
    });
  }

  return results;
}

export function parseTorrentMacDetailHtml(
  html: string,
  detailUrl: string,
  gameTitle: string
): { summary: string | null; fileSize: string | null; options: MacNativeDownloadOption[] } {
  const BASE = "https://www.torrentmac.net";
  const options: MacNativeDownloadOption[] = [];
  const seen = new Set<string>();

  const articleMatch = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  const body = articleMatch ? articleMatch[1] : html;

  const sizeMatch =
    /(?:Size|File\s*Size|Tamanho)\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:TB|GB|MB))/i.exec(
      stripHtmlTags(body)
    );
  const fileSize = sizeMatch ? sizeMatch[1].toUpperCase() : null;

  const metaDescMatch =
    /<meta\s+name="description"\s+content="([^"]+)"/i.exec(html);
  const summary = metaDescMatch ? decodeHtmlEntities(metaDescMatch[1]) : null;

  const linkRegex = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = linkRegex.exec(body)) !== null) {
    const rawHref = decodeHtmlEntities(m[1]).trim();
    if (!rawHref) continue;
    const lower = rawHref.toLowerCase();
    const isMagnet = lower.startsWith("magnet:");
    const isTorrentFile = /\.torrent(\?|$)/i.test(lower);
    if (!isMagnet && !isTorrentFile) continue;

    const fullUrl = isMagnet ? rawHref : resolveUrl(BASE, rawHref);
    if (!fullUrl || seen.has(fullUrl)) continue;
    seen.add(fullUrl);

    idx += 1;
    options.push({
      id: `torrentmac-${idx}-${Buffer.from(fullUrl).toString("base64url").slice(0, 14)}`,
      title: `${gameTitle} (TorrentMac · ${isMagnet ? "Magnet" : ".torrent"})`,
      source: "torrentmac",
      sourceLabel: "TorrentMac",
      url: fullUrl,
      hoster: isMagnet ? "Magnet" : "Torrent (.torrent)",
      fileSize,
      isTorrent: true,
      detailUrl,
    });
  }

  return { summary, fileSize, options };
}
