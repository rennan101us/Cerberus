import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { StoreAccountStorage, StoredGogAccount } from "./store-account-storage";
import { openGogAuthWindow } from "./gog-auth-window";
import type { Game, ShopAssets, StoreAccount, StoreLibraryGame } from "@types";

const GOG_CLIENT_ID = "46899977096215655";
const GOG_CLIENT_SECRET =
  "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9";
const GOG_REDIRECT_URI =
  "https://embed.gog.com/on_login_success?origin=client";

interface GogTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
  error?: string;
}

interface GogUserData {
  userId?: string;
  username?: string;
  email?: string;
  avatar?: string;
}

interface GogProduct {
  id: number;
  title: string;
  image?: string;
  slug?: string;
  category?: string;
  isGame?: boolean;
}

class GogStoreServiceImpl {
  private readonly storage = new StoreAccountStorage();
  private activeAuthWindow: ReturnType<typeof openGogAuthWindow> | null = null;
  private syncing = false;

  public getAccount(): StoreAccount {
    const stored = this.storage.getGog();
    if (!stored?.userId || !stored.accessToken) {
      return { provider: "gog", connected: false };
    }
    return {
      provider: "gog",
      connected: true,
      accountId: stored.userId,
      accountName: stored.username,
      displayName: stored.username,
      avatarUrl: stored.avatarUrl ?? null,
      lastSyncAt: stored.lastSyncAt,
      syncedGamesCount: stored.syncedGamesCount,
    };
  }

  public async getValidAccessToken(): Promise<string | null> {
    const stored = this.storage.getGog();
    if (!stored?.accessToken) return null;

    // Refresh if within 5 minutes of expiration
    if (stored.expiresAt && Date.now() > stored.expiresAt - 300_000) {
      if (!stored.refreshToken) return null;
      try {
        const body = new URLSearchParams({
          grant_type: "refresh_token",
          client_id: GOG_CLIENT_ID,
          client_secret: GOG_CLIENT_SECRET,
          refresh_token: stored.refreshToken,
        });
        const res = await fetch("https://auth.gog.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        if (res.ok) {
          const data = (await res.json()) as GogTokenResponse;
          const updated: StoredGogAccount = {
            ...stored,
            accessToken: data.access_token,
            refreshToken: data.refresh_token || stored.refreshToken,
            expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
          };
          this.storage.setGog(updated);
          return updated.accessToken;
        }
      } catch (err) {
        logger.error("[GOG] Token refresh failed", err);
      }
    }
    return stored.accessToken;
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

      this.activeAuthWindow = openGogAuthWindow({
        onCode: async (code: string) => {
          try {
            const body = new URLSearchParams({
              grant_type: "authorization_code",
              client_id: GOG_CLIENT_ID,
              client_secret: GOG_CLIENT_SECRET,
              code,
              redirect_uri: GOG_REDIRECT_URI,
            });
            const tokenRes = await fetch("https://auth.gog.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: body.toString(),
            });

            if (!tokenRes.ok) {
              const text = await tokenRes.text().catch(() => "");
              settle({ ok: false, error: text || "token-exchange-failed" });
              return { ok: false, error: "token-exchange-failed" };
            }

            const tokenData = (await tokenRes.json()) as GogTokenResponse;
            let userData: GogUserData = {};
            try {
              const userRes = await fetch("https://embed.gog.com/userData.json", {
                headers: { Authorization: `Bearer ${tokenData.access_token}` },
              });
              if (userRes.ok) {
                userData = (await userRes.json()) as GogUserData;
              }
            } catch {
              // ignore
            }

            const userId = tokenData.user_id || userData.userId || "gog-user";
            const username = userData.username || `GOG User ${userId}`;

            this.storage.setGog({
              userId,
              username,
              email: userData.email,
              avatarUrl: userData.avatar ?? null,
              accessToken: tokenData.access_token,
              refreshToken: tokenData.refresh_token,
              expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
              lastSyncAt: null,
              syncedGamesCount: 0,
            });

            WindowManager.sendToAppWindows("on-store-accounts-updated");
            void this.syncLibrary().catch((err) =>
              logger.warn("[GOG] Post-login sync failed", err)
            );

            settle({ ok: true });
            return { ok: true };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "auth-failed";
            settle({ ok: false, error: msg });
            return { ok: false, error: msg };
          }
        },
        onCancel: async () => {
          settle({ ok: false, error: "cancelled" });
        },
        onError: async (error) => {
          settle({ ok: false, error });
        },
      });
    });
  }

  public disconnect(): void {
    this.storage.setGog(null);
    WindowManager.sendToAppWindows("on-store-accounts-updated");
  }

  public async syncLibrary(): Promise<{ syncedGamesCount: number }> {
    if (this.syncing) {
      return { syncedGamesCount: this.getAccount().syncedGamesCount ?? 0 };
    }

    const token = await this.getValidAccessToken();
    if (!token) {
      throw new Error("GOG account is not connected or token expired");
    }

    this.syncing = true;
    try {
      const res = await fetch(
        "https://embed.gog.com/account/getFilteredProducts?hasHiddenProducts=false&mediaType=1",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "CerberusLauncher/1.0",
          },
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch GOG library (HTTP ${res.status})`);
      }

      const data = (await res.json()) as { products?: GogProduct[] };
      const products = data.products || [];

      let count = 0;
      for (const item of products) {
        if (!item.id || !item.isGame) continue;
        const gameId = String(item.id);
        const title = item.title?.trim() || `GOG Game ${gameId}`;
        const gameKey = levelKeys.game("gog", gameId);

        const existingGame = await gamesSublevel.get(gameKey).catch(() => null);
        const existingAssets = await gamesShopAssetsSublevel
          .get(gameKey)
          .catch(() => null);

        let baseImg = item.image || "";
        if (baseImg.startsWith("//")) baseImg = `https:${baseImg}`;
        const coverUrl = baseImg ? `${baseImg}_glcid_tall.jpg` : "";
        const heroUrl = baseImg ? `${baseImg}_glcid_hero.jpg` : "";
        const iconUrl = baseImg ? `${baseImg}_glcid_icon.png` : "";

        const assetsPayload: ShopAssets & { updatedAt: number } = {
          updatedAt: Date.now(),
          objectId: gameId,
          shop: "gog",
          title,
          iconUrl: existingAssets?.iconUrl || iconUrl || null,
          libraryHeroImageUrl:
            existingAssets?.libraryHeroImageUrl || heroUrl || coverUrl,
          libraryImageUrl:
            existingAssets?.libraryImageUrl || coverUrl || heroUrl,
          logoImageUrl: existingAssets?.logoImageUrl || "",
          logoPosition: null,
          coverImageUrl: existingAssets?.coverImageUrl || coverUrl,
          downloadSources: existingAssets?.downloadSources ?? [],
        };
        await gamesShopAssetsSublevel.put(gameKey, assetsPayload);

        const gameRecord: Game = {
          ...(existingGame ?? {}),
          title,
          objectId: gameId,
          shop: "gog",
          remoteId: existingGame?.remoteId ?? null,
          source: "gog",
          isDeleted: false,
          iconUrl: assetsPayload.iconUrl,
          libraryHeroImageUrl: assetsPayload.libraryHeroImageUrl,
          logoImageUrl: assetsPayload.logoImageUrl,
          playTimeInMilliseconds: existingGame?.playTimeInMilliseconds ?? 0,
          lastTimePlayed: existingGame?.lastTimePlayed ?? null,
          addedToLibraryAt: existingGame?.addedToLibraryAt ?? new Date(),
          executablePath: existingGame?.executablePath ?? null,
          executablePathUpdatedAt: existingGame?.executablePathUpdatedAt ?? null,
          launchOptions: existingGame?.launchOptions ?? null,
          favorite: existingGame?.favorite ?? false,
          automaticCloudSync: existingGame?.automaticCloudSync ?? false,
          hasManuallyUpdatedPlaytime:
            existingGame?.hasManuallyUpdatedPlaytime ?? false,
        };

        await gamesSublevel.put(gameKey, gameRecord);
        count++;
      }

      const stored = this.storage.getGog();
      if (stored) {
        this.storage.setGog({
          ...stored,
          lastSyncAt: new Date().toISOString(),
          syncedGamesCount: count,
        });
      }

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
      if (game.shop !== "gog" && game.source !== "gog") continue;
      const assets = await gamesShopAssetsSublevel
        .get(levelKeys.game(game.shop, game.objectId))
        .catch(() => null);
      results.push({
        provider: "gog",
        storeId: game.objectId,
        title: game.title,
        coverUrl:
          assets?.coverImageUrl ||
          assets?.libraryImageUrl ||
          game.iconUrl ||
          null,
        installed: Boolean(game.executablePath),
        playtimeMinutes: Math.round(
          (game.playTimeInMilliseconds ?? 0) / 60_000
        ),
      });
    }
    return results;
  }
}

export const GogStoreService = new GogStoreServiceImpl();
