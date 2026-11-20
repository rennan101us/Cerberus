const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CACHE_TTL_MS = 60_000;

export class MediafireChallengeError extends Error {
  public readonly code = "CLOUDFLARE_CHALLENGE";

  constructor(
    public readonly originalUrl: string,
    message = "MediaFire requested a Cloudflare anti-bot verification challenge"
  ) {
    super(message);
    this.name = "MediafireChallengeError";
  }
}

export class MediafireApi {
  private static readonly validMediafireIdentifierDL = /^[a-zA-Z0-9]+$/m;
  private static readonly directDownloadUrlRe =
    /^https?:\/\/download\d+\.mediafire\.com\//i;
  private static readonly validDynamicDL =
    /(?<=['"])https?:\/\/download\d+\.mediafire\.com\/[^'"]+(?=['"])/;
  private static readonly scrambledUrlRe =
    /data-scrambled-url=['"]([A-Za-z0-9+/=]+)['"]/i;
  private static readonly validMediafirePreDL =
    /(?<=['"])(https?:)?(\/\/)?(www\.)?mediafire\.com\/(file|view|download)\/[^'"?]+\?dkey=[^'"]+(?=['"])/;
  private static readonly checkHTTP = /^https?:\/\//m;

  private static readonly resolvedCache = new Map<
    string,
    { url: string; cachedAt: number }
  >();

  public static async getDownloadUrl(
    mediafireUrl: string,
    options?: { bypassCache?: boolean }
  ): Promise<string> {
    const processedUrl = this.processUrl(mediafireUrl);

    if (this.directDownloadUrlRe.test(processedUrl)) {
      return processedUrl;
    }

    if (!options?.bypassCache) {
      const cached = this.resolvedCache.get(processedUrl);
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return cached.url;
      }
    }

    const directUrl = await this.fetchAndExtract(processedUrl, 0);
    this.resolvedCache.set(processedUrl, {
      url: directUrl,
      cachedAt: Date.now(),
    });
    return directUrl;
  }

  private static async fetchAndExtract(
    url: string,
    depth: number
  ): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
      },
      redirect: "follow",
    });

    const finalUrl = response.url || url;
    const html = await response.text();

    if (response.ok) {
      const directUrl = this.extractDirectBinaryUrl(html);
      if (directUrl) {
        return directUrl;
      }
    }

    if (this.isCloudflareChallenge(response.status, response.headers, finalUrl, html)) {
      throw new MediafireChallengeError(url);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch Mediafire page (HTTP ${response.status})`);
    }

    if (depth < 1) {
      const preMatch = this.validMediafirePreDL.exec(html);
      if (preMatch?.[0]) {
        const nextUrl = preMatch[0].startsWith("//")
          ? `https:${preMatch[0]}`
          : preMatch[0];
        if (nextUrl !== url) {
          return this.fetchAndExtract(nextUrl, depth + 1);
        }
      }
    }

    throw new Error("No valid MediaFire download link found on page");
  }

  private static isCloudflareChallenge(
    status: number,
    headers: { get(name: string): string | null },
    finalUrl: string,
    html: string
  ): boolean {
    if (finalUrl.includes("action=check")) return true;
    if (headers.get("cf-mitigated")?.toLowerCase() === "challenge") return true;
    if (
      /<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(html) ||
      html.includes("/cdn-cgi/challenge-platform") ||
      html.includes("cf-turnstile") ||
      html.includes("Attention Required! | Cloudflare")
    ) {
      return true;
    }
    if ((status === 403 || status === 503) && Boolean(headers.get("cf-ray"))) {
      return true;
    }
    return false;
  }

  private static processUrl(url: string): string {
    let processed = url.trim().replace("http://", "https://");

    if (this.validMediafireIdentifierDL.test(processed)) {
      processed = `https://www.mediafire.com/?${processed}`;
    }

    if (!this.checkHTTP.test(processed)) {
      processed = processed.startsWith("//")
        ? `https:${processed}`
        : `https://${processed}`;
    }

    return processed;
  }

  private static extractDirectBinaryUrl(html: string): string | null {
    const dlMatch = this.validDynamicDL.exec(html);
    if (dlMatch?.[0]) {
      return dlMatch[0];
    }

    const scrambledMatch = this.scrambledUrlRe.exec(html);
    if (scrambledMatch?.[1]) {
      try {
        const decoded = Buffer.from(scrambledMatch[1], "base64").toString("utf8").trim();
        if (this.directDownloadUrlRe.test(decoded)) {
          return decoded;
        }
      } catch {
        // Ignore invalid base64
      }
    }

    return null;
  }
}
