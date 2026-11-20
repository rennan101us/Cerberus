import { logger } from "@main/services/logger";
import { GogStoreService } from "./gog-store-service";

export interface GogInstallerFile {
  id: string;
  name: string;
  size: number;
  downlink: string;
}

export interface GogInstaller {
  id: string;
  name: string;
  os: "mac" | "windows" | "linux";
  language: string;
  version: string;
  totalSize: number;
  files: GogInstallerFile[];
}

export interface GogProductDownloads {
  gameId: string;
  title: string;
  macInstallers: GogInstaller[];
  windowsInstallers: GogInstaller[];
}

interface RawGogDownloadFile {
  id?: string;
  name?: string;
  size?: number;
  downlink?: string;
}

interface RawGogInstaller {
  id?: string;
  name?: string;
  os?: string;
  language?: string;
  version?: string;
  total_size?: number;
  files?: RawGogDownloadFile[];
}

interface RawGogProductResponse {
  title?: string;
  downloads?: {
    installers?: RawGogInstaller[];
  };
}

class GogDownloadServiceImpl {
  public async getProductDownloads(
    gameId: string
  ): Promise<GogProductDownloads | null> {
    const token = await GogStoreService.getValidAccessToken();
    if (!token) {
      logger.warn("[GOG Download] Cannot fetch downloads: no valid token");
      return null;
    }

    try {
      const url = `https://api.gog.com/products/${gameId}?expand=downloads`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "CerberusLauncher/1.0",
        },
      });

      if (!res.ok) {
        logger.warn(
          `[GOG Download] Product ${gameId} returned HTTP ${res.status}`
        );
        return null;
      }

      const data = (await res.json()) as RawGogProductResponse;
      const rawInstallers = data.downloads?.installers || [];

      const macInstallers: GogInstaller[] = [];
      const windowsInstallers: GogInstaller[] = [];

      for (const inst of rawInstallers) {
        const os = inst.os?.toLowerCase();
        if (os !== "mac" && os !== "windows") continue;

        const files: GogInstallerFile[] = (inst.files || []).map((f) => ({
          id: f.id || "",
          name: f.name || "installer",
          size: f.size || 0,
          downlink: f.downlink || "",
        }));

        const parsed: GogInstaller = {
          id: inst.id || `${os}-${inst.language || "en"}`,
          name: inst.name || inst.language || "Default",
          os: os as "mac" | "windows",
          language: inst.language || "English",
          version: inst.version || "",
          totalSize: inst.total_size || 0,
          files,
        };

        if (os === "mac") {
          macInstallers.push(parsed);
        } else {
          windowsInstallers.push(parsed);
        }
      }

      return {
        gameId,
        title: data.title || `GOG Game ${gameId}`,
        macInstallers,
        windowsInstallers,
      };
    } catch (err) {
      logger.error(`[GOG Download] Error fetching downloads for ${gameId}`, err);
      return null;
    }
  }

  public async resolveDownlink(downlinkUrl: string): Promise<string | null> {
    const token = await GogStoreService.getValidAccessToken();
    if (!token || !downlinkUrl) return null;

    try {
      const res = await fetch(downlinkUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "CerberusLauncher/1.0",
        },
        redirect: "manual",
      });

      // GOG downlink returns 302 redirect with Location header pointing to signed CDN
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (location) return location;
      }

      if (res.ok) {
        const json = (await res.json().catch(() => null)) as {
          downlink?: string;
        } | null;
        if (json?.downlink) return json.downlink;
      }

      return null;
    } catch (err) {
      logger.error("[GOG Download] Failed to resolve downlink", err);
      return null;
    }
  }
}

export const GogDownloadService = new GogDownloadServiceImpl();
