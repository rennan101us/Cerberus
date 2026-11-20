const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CACHE_TTL_MS = 60_000;

export interface MailRuResolvedDownload {
  directUrl: string;
  fileName?: string;
  fileSize?: number;
}

interface MailRuDispatcherResponse {
  status?: number;
  body?: {
    weblink_get?: Array<{ url?: string; count?: number }>;
  };
}

interface MailRuFileEntry {
  name?: string;
  size?: number;
  type?: "file" | "folder";
  weblink?: string;
  list?: MailRuFileEntry[];
}

interface MailRuFileResponse {
  status?: number;
  body?: MailRuFileEntry;
}

const PREFERRED_GAME_ARCHIVE_RE =
  /\.(dmg|pkg|iso|zip|7z|rar|tar\.gz|tgz|nsp|xci|nsz|exe|msi)$/i;

export class MailRuApi {
  private static readonly publicUrlPattern =
    /^https?:\/\/cloud\.mail\.ru\/public\/([^?#]+)/i;

  private static readonly resolvedCache = new Map<
    string,
    { result: MailRuResolvedDownload; cachedAt: number }
  >();

  public static isMailRuPublicUrl(url: string): boolean {
    return this.publicUrlPattern.test(url.trim());
  }

  public static extractWeblink(url: string): string | null {
    const match = this.publicUrlPattern.exec(url.trim());
    if (!match?.[1]) return null;
    const cleaned = match[1].replace(/\/+$/, "");
    return cleaned.includes("/") ? cleaned : null;
  }

  private static encodeWeblinkPath(weblink: string): string {
    return weblink
      .split("/")
      .map((segment) => {
        try {
          return encodeURIComponent(decodeURIComponent(segment));
        } catch {
          return encodeURIComponent(segment);
        }
      })
      .join("/");
  }

  public static async resolveDownload(
    publicUrl: string,
    options?: { bypassCache?: boolean }
  ): Promise<MailRuResolvedDownload> {
    const normalizedUrl = publicUrl.trim();

    if (!options?.bypassCache) {
      const cached = this.resolvedCache.get(normalizedUrl);
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return cached.result;
      }
    }

    const weblink = this.extractWeblink(normalizedUrl);
    if (!weblink) {
      throw new Error("Invalid Mail.ru public link");
    }

    const commonHeaders = {
      "User-Agent": BROWSER_USER_AGENT,
      Accept: "application/json, text/plain, */*",
      Referer: "https://cloud.mail.ru/",
    };

    const [dispatcherRes, fileRes] = await Promise.all([
      fetch("https://cloud.mail.ru/api/v2/dispatcher", {
        headers: commonHeaders,
      }),
      fetch(
        `https://cloud.mail.ru/api/v2/file?weblink=${encodeURIComponent(weblink)}`,
        {
          headers: commonHeaders,
        }
      ),
    ]);

    if (!dispatcherRes.ok) {
      throw new Error(
        `Mail.ru dispatcher failed (HTTP ${dispatcherRes.status})`
      );
    }

    const dispatcherJson =
      (await dispatcherRes.json()) as MailRuDispatcherResponse;
    const baseUrl = dispatcherJson.body?.weblink_get?.[0]?.url;
    if (!baseUrl) {
      throw new Error("Mail.ru did not return a download endpoint");
    }

    let targetWeblink = weblink;
    let fileName: string | undefined;
    let fileSize: number | undefined;

    if (fileRes.ok) {
      const fileJson = (await fileRes.json()) as MailRuFileResponse;
      const body = fileJson.body;

      if (body?.type === "file") {
        targetWeblink = body.weblink || weblink;
        fileName = body.name || undefined;
        fileSize =
          typeof body.size === "number" && Number.isFinite(body.size)
            ? body.size
            : undefined;
      } else if (body?.type === "folder") {
        const files = (body.list ?? []).filter(
          (entry) => entry.type === "file" && Boolean(entry.weblink)
        );
        const preferred = files
          .filter((f) => f.name && PREFERRED_GAME_ARCHIVE_RE.test(f.name))
          .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));

        const chosen =
          preferred[0] ?? (files.length === 1 ? files[0] : undefined);

        if (!chosen?.weblink) {
          throw new Error(
            "Mail.ru public folder contains multiple files and requires browser download"
          );
        }

        targetWeblink = chosen.weblink;
        fileName = chosen.name || undefined;
        fileSize =
          typeof chosen.size === "number" && Number.isFinite(chosen.size)
            ? chosen.size
            : undefined;
      }
    }

    const directUrl = `${baseUrl.replace(/\/+$/, "")}/${this.encodeWeblinkPath(targetWeblink)}`;
    const result: MailRuResolvedDownload = {
      directUrl,
      fileName,
      fileSize,
    };

    this.resolvedCache.set(normalizedUrl, {
      result,
      cachedAt: Date.now(),
    });

    return result;
  }
}
