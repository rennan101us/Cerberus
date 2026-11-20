import fs from "node:fs";
import path from "node:path";
import type {
  Game,
  ShopAssets,
  StoreAccount,
  StoreLibraryGame,
} from "@types";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { openEpicAuthWindow } from "@main/services/epic/auth-window";
import {
  CrossOverDetector,
  CrossOverDiscovery,
  DEFAULT_BOTTLE_NAME,
} from "@main/services/crossover";
import { WindowManager } from "@main/services/window-manager";
import { logger } from "@main/services/logger";
import { getLegendaryConfigDir, runLegendary } from "./legendary-cli";
import { StoreAccountStorage } from "./store-account-storage";

const EPIC_LAUNCHER_BASIC_AUTH =
  "Basic MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE6ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc2Y2Y=";
const EPIC_OAUTH_TOKEN_URL =
  "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token";

export interface LegendaryUserJson {
  account_id?: string;
  displayName?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
}

interface LegendaryKeyImage {
  type?: string;
  url?: string;
}

interface LegendaryGameItem {
  app_name?: string;
  app_title?: string;
  metadata?: {
    title?: string;
    description?: string;
    keyImages?: LegendaryKeyImage[];
    categories?: Array<{ path?: string }>;
    mainGameItem?: unknown;
  };
}

interface LegendaryInstalledEntry {
  app_name?: string;
  executable?: string;
  install_path?: string;
  install_size?: number;
  title?: string;
}

const pickKeyImage = (
  images: LegendaryKeyImage[] | undefined,
  preferredTypes: string[]
): string | null => {
  if (!Array.isArray(images)) return null;
  for (const preferred of preferredTypes) {
    const hit = images.find((img) => img?.type === preferred && img?.url);
    if (hit?.url) return hit.url;
  }
  return images.find((img) => img?.url)?.url ?? null;
};

const isPlayableEpicItem = (item: LegendaryGameItem): boolean => {
  if (!item.app_name) return false;
  if (item.metadata?.mainGameItem) return false;
  const categories = item.metadata?.categories;
  if (Array.isArray(categories) && categories.length > 0) {
    const paths = categories.map((c) => c.path?.toLowerCase() ?? "");
    const hasGames = paths.some((p) => p === "games" || p.startsWith("games/"));
    const isEngineOnly = paths.some(
      (p) =>
        p === "ue" ||
        p === "engines" ||
        p === "plugins" ||
        p === "assets" ||
        p === "digitalextras"
    );
    if (isEngineOnly && !hasGames) return false;
  }
  return true;
};

class EpicStoreServiceImpl {
  private readonly storage = new StoreAccountStorage();
  private activeAuthWindow: ReturnType<typeof openEpicAuthWindow> | null = null;
  private syncing = false;

  public readLegendaryUser(): LegendaryUserJson | null {
    try {
      const userPath = path.join(getLegendaryConfigDir(), "user.json");
      if (!fs.existsSync(userPath)) return null;
      return JSON.parse(
        fs.readFileSync(userPath, "utf8")
      ) as LegendaryUserJson;
    } catch {
      return null;
    }
  }

  private writeLegendaryUser(user: LegendaryUserJson): void {
    const userPath = path.join(getLegendaryConfigDir(), "user.json");
    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    const tmpPath = `${userPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(user, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmpPath, userPath);
  }

  public getAccount(): StoreAccount {
    const stored = this.storage.getEpic();
    const user = this.readLegendaryUser();
    const accountId = stored?.accountId ?? user?.account_id;
    const displayName = stored?.displayName ?? user?.displayName;

    if (!accountId || !user?.access_token) {
      return { provider: "epic", connected: false };
    }

    return {
      provider: "epic",
      connected: true,
      accountId,
      displayName: displayName || accountId,
      lastSyncAt: stored?.lastSyncAt ?? null,
      syncedGamesCount: stored?.syncedGamesCount ?? 0,
    };
  }

  public async getValidAccessToken(): Promise<{
    accountId: string;
    accessToken: string;
    displayName: string;
  } | null> {
    const user = this.readLegendaryUser();
    if (!user?.account_id || !user?.access_token) return null;

    const expiresAtMs = user.expires_at ? Date.parse(user.expires_at) : 0;
    const needsRefresh =
      !expiresAtMs || Number.isNaN(expiresAtMs) || expiresAtMs - Date.now() < 300_000;

    if (!needsRefresh) {
      return {
        accountId: user.account_id,
        accessToken: user.access_token,
        displayName: user.displayName || user.account_id,
      };
    }

    if (user.refresh_token) {
      try {
        const body = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: user.refresh_token,
        });
        const response = await fetch(EPIC_OAUTH_TOKEN_URL, {
          method: "POST",
          headers: {
            Authorization: EPIC_LAUNCHER_BASIC_AUTH,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        });
        if (response.ok) {
          const data = (await response.json()) as LegendaryUserJson;
          const updated: LegendaryUserJson = {
            ...user,
            ...data,
          };
          this.writeLegendaryUser(updated);
          if (updated.account_id && updated.access_token) {
            return {
              accountId: updated.account_id,
              accessToken: updated.access_token,
              displayName: updated.displayName || updated.account_id,
            };
          }
        }
      } catch (err) {
        logger.warn("[EpicStore] Direct token refresh failed, trying legendary status", err);
      }
    }

    await runLegendary(["status"]).catch(() => null);
    const refreshed = this.readLegendaryUser();
    if (!refreshed?.account_id || !refreshed?.access_token) return null;
    return {
      accountId: refreshed.account_id,
      accessToken: refreshed.access_token,
      displayName: refreshed.displayName || refreshed.account_id,
    };
  }

  public startLogin(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (this.activeAuthWindow) {
        this.activeAuthWindow.close();
        this.activeAuthWindow = null;
      }

      let settled = false;
      const settle = (result: { ok: boolean; error?: string }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      this.activeAuthWindow = openEpicAuthWindow({
        onCode: async (code: string) => {
          try {
            const authRes = await runLegendary(["auth", "--code", code]);
            if (authRes.code !== 0) {
              settle({
                ok: false,
                error: authRes.stderr.trim() || "epic-auth-failed",
              });
              return { ok: false, error: "auth-failed" };
            }

            const user = this.readLegendaryUser();
            if (!user?.account_id) {
              settle({ ok: false, error: "epic-user-missing" });
              return { ok: false, error: "auth-failed" };
            }

            this.storage.setEpic({
              accountId: user.account_id,
              displayName: user.displayName || user.account_id,
              lastSyncAt: null,
              syncedGamesCount: 0,
            });
            WindowManager.sendToAppWindows("on-store-accounts-updated");

            // Connect Epic social and import library asynchronously
            void import("../social/epic-social-service")
              .then(({ EpicSocialService }) => EpicSocialService.connect())
              .catch((err) => logger.warn("[EpicStore] Social connect error", err));

            void this.syncLibrary().catch((err) =>
              logger.warn("[EpicStore] Post-login library sync failed", err)
            );

            settle({ ok: true });
            return { ok: true };
          } catch (err) {
            settle({
              ok: false,
              error: err instanceof Error ? err.message : "epic-auth-failed",
            });
            return { ok: false, error: "auth-failed" };
          } finally {
            this.activeAuthWindow?.close();
            this.activeAuthWindow = null;
          }
        },
        onCancel: async () => {
          this.activeAuthWindow = null;
          settle({ ok: false, error: "cancelled" });
          return { ok: false, error: "auth-failed" as const };
        },
        onError: async (error) => {
          this.activeAuthWindow = null;
          settle({ ok: false, error });
          return { ok: false, error };
        },
      });
    });
  }

  public async disconnect(): Promise<void> {
    try {
      const { EpicSocialService } = await import(
        "../social/epic-social-service"
      );
      await EpicSocialService.disconnect();
    } catch {
      // ignore
    }

    await runLegendary(["auth", "--delete"]).catch(() => null);
    this.storage.setEpic(null);
    WindowManager.sendToAppWindows("on-store-accounts-updated");
  }

  public readInstalledMap(): Record<string, LegendaryInstalledEntry> {
    try {
      const installedPath = path.join(getLegendaryConfigDir(), "installed.json");
      if (!fs.existsSync(installedPath)) return {};
      return JSON.parse(
        fs.readFileSync(installedPath, "utf8")
      ) as Record<string, LegendaryInstalledEntry>;
    } catch {
      return {};
    }
  }

  public async syncLibrary(): Promise<{ syncedGamesCount: number }> {
    if (this.syncing) {
      return { syncedGamesCount: this.getAccount().syncedGamesCount ?? 0 };
    }

    const account = this.getAccount();
    if (!account.connected || !account.accountId) {
      throw new Error("Epic Games account is not connected");
    }

    this.syncing = true;
    try {
      const res = await runLegendary([
        "list",
        "--platform",
        "Windows",
        "--json",
        "--force-refresh",
      ]);

      if (res.code !== 0) {
        throw new Error(
          res.stderr.trim() || `legendary list failed with exit ${res.code}`
        );
      }

      const items = JSON.parse(res.stdout) as LegendaryGameItem[];
      const installedMap = this.readInstalledMap();
      const bottlesDir = await CrossOverDetector.getBottlesDirectory().catch(
        () => null
      );

      let count = 0;
      for (const item of items) {
        if (!isPlayableEpicItem(item) || !item.app_name) continue;
        const appName = item.app_name;
        const title = item.metadata?.title || item.app_title || appName;
        const gameKey = levelKeys.game("epic", appName);

        const existingGame = await gamesSublevel.get(gameKey).catch(() => null);
        const existingAssets = await gamesShopAssetsSublevel
          .get(gameKey)
          .catch(() => null);

        const tallCover = pickKeyImage(item.metadata?.keyImages, [
          "DieselGameBoxTall",
          "OfferImageTall",
          "Thumbnail",
          "DieselGameBox",
        ]);
        const heroCover = pickKeyImage(item.metadata?.keyImages, [
          "DieselGameBox",
          "OfferImageWide",
          "DieselStoreFrontWide",
        ]);
        const logoUrl = pickKeyImage(item.metadata?.keyImages, [
          "DieselGameBoxLogo",
        ]);

        let finalCover = existingAssets?.coverImageUrl || tallCover || heroCover || "";
        let finalHero = existingAssets?.libraryHeroImageUrl || heroCover || tallCover || "";
        let finalLogo = existingAssets?.logoImageUrl || logoUrl || "";
        let finalIcon = existingAssets?.iconUrl || tallCover || heroCover || null;

        if (!finalCover) {
          const matched = await CrossOverDiscovery.matchCandidateToSteam({
            title,
            executablePath: "",
            bottleName: DEFAULT_BOTTLE_NAME,
          }).catch(() => null);
          if (matched) {
            const steamAssets =
              await CrossOverDiscovery.fetchOrConstructSteamAssets(
                matched.appId,
                title
              ).catch(() => null);
            if (steamAssets) {
              finalCover = steamAssets.coverImageUrl || steamAssets.libraryImageUrl || "";
              finalHero = finalHero || steamAssets.libraryHeroImageUrl || "";
              finalLogo = finalLogo || steamAssets.logoImageUrl || "";
              finalIcon = finalIcon || steamAssets.iconUrl || null;
            }
          }
        }

        const assetsPayload: ShopAssets & { updatedAt: number } = {
          updatedAt: Date.now(),
          objectId: appName,
          shop: "epic",
          title,
          iconUrl: finalIcon,
          libraryHeroImageUrl: finalHero,
          libraryImageUrl: finalCover,
          logoImageUrl: finalLogo,
          logoPosition: null,
          coverImageUrl: finalCover,
          downloadSources: existingAssets?.downloadSources ?? [],
        };
        await gamesShopAssetsSublevel.put(gameKey, assetsPayload);

        let executablePath = existingGame?.executablePath ?? null;
        let installedSizeInBytes = existingGame?.installedSizeInBytes ?? null;
        let macOSCompatibility = existingGame?.macOSCompatibility;

        const installedEntry = installedMap[appName];
        if (installedEntry?.install_path && installedEntry?.executable) {
          const candidateExe = path.join(
            installedEntry.install_path,
            installedEntry.executable.replace(/\\/g, path.sep)
          );
          if (fs.existsSync(candidateExe)) {
            executablePath = candidateExe;
            installedSizeInBytes =
              installedEntry.install_size ?? installedSizeInBytes;
            if (process.platform === "darwin" && !macOSCompatibility) {
              const bottle =
                (bottlesDir &&
                  CrossOverDetector.detectBottleFromPath(candidateExe)) ||
                DEFAULT_BOTTLE_NAME;
              macOSCompatibility = {
                bottleName: bottle,
                graphicsBackend: "d3dmetal",
                syncMode: "msync",
              };
            }
          }
        }

        const gameRecord: Game = {
          ...(existingGame ?? {}),
          title,
          objectId: appName,
          shop: "epic",
          remoteId: existingGame?.remoteId ?? null,
          source: "epic",
          hasActiveEpicImport: true,
          isDeleted: false,
          iconUrl: finalIcon || existingGame?.iconUrl || null,
          libraryHeroImageUrl: finalHero || existingGame?.libraryHeroImageUrl || null,
          logoImageUrl: finalLogo || existingGame?.logoImageUrl || null,
          playTimeInMilliseconds: existingGame?.playTimeInMilliseconds ?? 0,
          epicPlayTimeInMilliseconds: existingGame?.epicPlayTimeInMilliseconds ?? 0,
          lastTimePlayed: existingGame?.lastTimePlayed ?? null,
          addedToLibraryAt: existingGame?.addedToLibraryAt ?? new Date(),
          executablePath,
          executablePathUpdatedAt: executablePath
            ? existingGame?.executablePathUpdatedAt ?? new Date()
            : null,
          installedSizeInBytes,
          launchOptions: existingGame?.launchOptions ?? null,
          favorite: existingGame?.favorite ?? false,
          automaticCloudSync: existingGame?.automaticCloudSync ?? false,
          hasManuallyUpdatedPlaytime:
            existingGame?.hasManuallyUpdatedPlaytime ?? false,
          macOSCompatibility,
        };

        await gamesSublevel.put(gameKey, gameRecord);
        count++;
      }

      this.storage.setEpic({
        accountId: account.accountId,
        displayName: account.displayName || account.accountId,
        lastSyncAt: new Date().toISOString(),
        syncedGamesCount: count,
      });

      WindowManager.sendToAppWindows("on-library-batch-complete");
      WindowManager.sendToAppWindows("on-store-accounts-updated");
      return { syncedGamesCount: count };
    } finally {
      this.syncing = false;
    }
  }

  public async getOwnedGames(): Promise<StoreLibraryGame[]> {
    const results: StoreLibraryGame[] = [];
    for await (const [, game] of gamesSublevel.iterator()) {
      if (game.isDeleted) continue;
      if (game.shop !== "epic" && !game.hasActiveEpicImport) continue;
      const assets = await gamesShopAssetsSublevel
        .get(levelKeys.game(game.shop, game.objectId))
        .catch(() => null);
      results.push({
        provider: "epic",
        storeId: game.objectId,
        title: game.title,
        coverUrl: assets?.coverImageUrl || assets?.libraryImageUrl || game.iconUrl || null,
        installed: Boolean(game.executablePath && fs.existsSync(game.executablePath)),
      });
    }
    return results;
  }
}

export const EpicStoreService = new EpicStoreServiceImpl();
