import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  EAuthSessionGuardType,
  EAuthTokenPlatformType,
  LoginSession,
} from "steam-session";
import QRCode from "qrcode";
import type {
  Game,
  ShopAssets,
  SteamLoginSessionStatus,
  StoreAccount,
  StoreLibraryGame,
} from "@types";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { WindowManager } from "@main/services/window-manager";
import { logger } from "@main/services/logger";
import { StoreAccountStorage } from "./store-account-storage";
import { buildSteamCdnAssets, buildSteamIconUrl } from "@shared";

class SteamStoreServiceImpl {
  private readonly storage = new StoreAccountStorage();
  private activeSession: LoginSession | null = null;
  private authState: SteamLoginSessionStatus = {
    sessionId: "",
    status: "idle",
  };
  private syncing = false;

  public getAccount(): StoreAccount {
    const stored = this.storage.getSteam();
    if (!stored?.steamId64 || !stored.refreshToken) {
      return { provider: "steam", connected: false };
    }

    return {
      provider: "steam",
      connected: true,
      accountId: stored.steamId64,
      accountName: stored.accountName,
      displayName: stored.displayName || stored.accountName,
      avatarUrl: stored.avatarUrl,
      lastSyncAt: stored.lastSyncAt,
      syncedGamesCount: stored.syncedGamesCount,
    };
  }

  public getRefreshToken(): string | null {
    return this.storage.getSteam()?.refreshToken ?? null;
  }

  public getAuthState(): SteamLoginSessionStatus {
    return this.authState;
  }

  private setAuthState(next: SteamLoginSessionStatus) {
    this.authState = next;
    WindowManager.sendToAppWindows("on-steam-auth-state", next);
  }

  private cleanupSession() {
    if (!this.activeSession) return;
    try {
      this.activeSession.cancelLoginAttempt();
    } catch {
      // ignore
    }
    this.activeSession.removeAllListeners();
    this.activeSession = null;
  }

  private createSession(): { session: LoginSession; sessionId: string } {
    this.cleanupSession();
    const sessionId = randomUUID();
    const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
    session.loginTimeout = 120_000;
    this.activeSession = session;

    session.on("authenticated", async () => {
      const steamId64 = session.steamID?.getSteamID64() ?? "";
      const accountName = session.accountName || "";
      const refreshToken = session.refreshToken || "";

      if (!steamId64 || !refreshToken) {
        this.setAuthState({
          sessionId,
          status: "error",
          error: "Sessão Steam autenticada sem token válido.",
        });
        return;
      }

      const existing = this.storage.getSteam();
      this.storage.setSteam({
        steamId64,
        accountName,
        displayName: existing?.displayName || accountName || steamId64,
        avatarUrl: existing?.avatarUrl ?? null,
        refreshToken,
        lastSyncAt: existing?.lastSyncAt ?? null,
        syncedGamesCount: existing?.syncedGamesCount ?? 0,
      });

      this.setAuthState({
        sessionId,
        status: "authenticated",
        steamId64,
        accountName,
        displayName: existing?.displayName || accountName || steamId64,
        avatarUrl: existing?.avatarUrl ?? null,
      });
      WindowManager.sendToAppWindows("on-store-accounts-updated");
      this.activeSession = null;

      try {
        const { SteamSocialService } = await import(
          "../social/steam-social-service"
        );
        await SteamSocialService.connect(true);
        await this.syncLibrary();
      } catch (err) {
        logger.warn("[SteamStore] Post-login connect/sync warning", err);
      }
    });

    session.on("timeout", () => {
      if (this.activeSession !== session) return;
      this.activeSession = null;
      this.setAuthState({
        sessionId,
        status: "expired",
        error: "Tempo limite de autenticação Steam expirado.",
      });
    });

    session.on("error", (err) => {
      if (this.activeSession !== session) return;
      this.activeSession = null;
      this.setAuthState({
        sessionId,
        status: "error",
        error: err?.message || "Erro na autenticação Steam.",
      });
    });

    return { session, sessionId };
  }

  public async startQrLogin(): Promise<SteamLoginSessionStatus> {
    const { session, sessionId } = this.createSession();
    this.setAuthState({ sessionId, status: "pending" });

    try {
      const res = await session.startWithQR();
      const qrUrl = res.qrChallengeUrl ?? "";
      const qrDataUrl = qrUrl
        ? await QRCode.toDataURL(qrUrl, { width: 240, margin: 1 })
        : undefined;

      const state: SteamLoginSessionStatus = {
        sessionId,
        status: "qr-ready",
        qrChallengeUrl: qrUrl,
        qrDataUrl,
      };
      this.setAuthState(state);
      return state;
    } catch (err) {
      this.cleanupSession();
      const state: SteamLoginSessionStatus = {
        sessionId,
        status: "error",
        error: err instanceof Error ? err.message : "Falha ao gerar QR Steam.",
      };
      this.setAuthState(state);
      return state;
    }
  }

  public async startCredentialsLogin(
    username: string,
    password: string
  ): Promise<SteamLoginSessionStatus> {
    const { session, sessionId } = this.createSession();
    this.setAuthState({
      sessionId,
      status: "pending",
      accountName: username.trim(),
    });

    try {
      const res = await session.startWithCredentials({
        accountName: username.trim(),
        password,
      });

      if (res.actionRequired && Array.isArray(res.validActions)) {
        const deviceCode = res.validActions.find(
          (a) => a.type === EAuthSessionGuardType.DeviceCode
        );
        const emailCode = res.validActions.find(
          (a) => a.type === EAuthSessionGuardType.EmailCode
        );
        const deviceConfirm = res.validActions.find(
          (a) => a.type === EAuthSessionGuardType.DeviceConfirmation
        );

        const state: SteamLoginSessionStatus = {
          sessionId,
          status: "needs-guard",
          accountName: username.trim(),
          guardType: deviceCode
            ? "device-code"
            : emailCode
              ? "email-code"
              : deviceConfirm
                ? "device-confirmation"
                : "device-code",
          guardDomain: emailCode?.detail,
        };
        this.setAuthState(state);
        return state;
      }

      return this.authState;
    } catch (err) {
      this.cleanupSession();
      const state: SteamLoginSessionStatus = {
        sessionId,
        status: "error",
        error: err instanceof Error ? err.message : "Falha no login Steam.",
      };
      this.setAuthState(state);
      return state;
    }
  }

  public async submitGuardCode(
    code: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.activeSession) {
      return { ok: false, error: "Nenhuma sessão Steam aguardando código." };
    }
    try {
      await this.activeSession.submitSteamGuardCode(code.trim());
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "Código Steam Guard inválido.",
      };
    }
  }

  public cancelLogin(): void {
    this.cleanupSession();
    this.setAuthState({ sessionId: "", status: "idle" });
  }

  public updateProfileFromPersona(
    steamId64: string,
    displayName: string,
    avatarUrl: string | null
  ): void {
    const stored = this.storage.getSteam();
    if (!stored || stored.steamId64 !== steamId64) return;
    if (stored.displayName === displayName && stored.avatarUrl === avatarUrl) {
      return;
    }
    this.storage.setSteam({
      ...stored,
      displayName: displayName || stored.displayName,
      avatarUrl: avatarUrl ?? stored.avatarUrl,
    });
    WindowManager.sendToAppWindows("on-store-accounts-updated");
  }

  public async syncLibrary(): Promise<{ syncedGamesCount: number }> {
    if (this.syncing) {
      return { syncedGamesCount: this.getAccount().syncedGamesCount ?? 0 };
    }
    const stored = this.storage.getSteam();
    if (!stored?.steamId64 || !stored.refreshToken) {
      throw new Error("Conta Steam não conectada.");
    }

    this.syncing = true;
    try {
      const { SteamSocialService } = await import(
        "../social/steam-social-service"
      );
      const apps = await SteamSocialService.getOwnedApps();

      let count = 0;
      for (const app of apps) {
        const appId = String(app.appid);
        const title = app.name?.trim() || `Steam App ${appId}`;
        const gameKey = levelKeys.game("steam", appId);

        const existingGame = await gamesSublevel.get(gameKey).catch(() => null);
        const existingAssets = await gamesShopAssetsSublevel
          .get(gameKey)
          .catch(() => null);

        const cdn = buildSteamCdnAssets(appId, app.img_icon_url);
        const resolvedIcon = buildSteamIconUrl(
          appId,
          app.img_icon_url || existingAssets?.iconUrl || existingGame?.iconUrl
        );

        // Sanitize cover in case of stale unhashed 2x URLs that 404
        let finalCover = existingAssets?.coverImageUrl || cdn.coverImageUrl;
        if (finalCover.includes("library_600x900_2x.jpg")) {
          finalCover = cdn.coverImageUrl;
        }

        const assetsPayload: ShopAssets & { updatedAt: number } = {
          updatedAt: Date.now(),
          objectId: appId,
          shop: "steam",
          title: existingAssets?.title || title,
          iconUrl: resolvedIcon,
          libraryHeroImageUrl:
            existingAssets?.libraryHeroImageUrl || cdn.libraryHeroImageUrl,
          libraryImageUrl: finalCover,
          logoImageUrl: existingAssets?.logoImageUrl || cdn.logoImageUrl,
          logoPosition: existingAssets?.logoPosition ?? null,
          coverImageUrl: finalCover,
          downloadSources: existingAssets?.downloadSources ?? [],
        };
        await gamesShopAssetsSublevel.put(gameKey, assetsPayload);

        const gameRecord: Game = {
          ...(existingGame ?? {}),
          title: existingGame?.title || title,
          objectId: appId,
          shop: "steam",
          remoteId: existingGame?.remoteId ?? null,
          source: "steam",
          hasActiveSteamImport: true,
          isDeleted: false,
          iconUrl: resolvedIcon,
          libraryHeroImageUrl:
            existingGame?.libraryHeroImageUrl || cdn.libraryHeroImageUrl,
          logoImageUrl: existingGame?.logoImageUrl || cdn.logoImageUrl,
          playTimeInMilliseconds:
            existingGame?.playTimeInMilliseconds ||
            (app.playtime_forever ?? 0) * 60_000,
          steamPlayTimeInMilliseconds: (app.playtime_forever ?? 0) * 60_000,
          lastTimePlayed: existingGame?.lastTimePlayed ?? null,
          addedToLibraryAt: existingGame?.addedToLibraryAt ?? new Date(),
          executablePath: existingGame?.executablePath ?? null,
          executablePathUpdatedAt:
            existingGame?.executablePathUpdatedAt ?? null,
          launchOptions: existingGame?.launchOptions ?? null,
          favorite: existingGame?.favorite ?? false,
          automaticCloudSync: existingGame?.automaticCloudSync ?? false,
          hasManuallyUpdatedPlaytime:
            existingGame?.hasManuallyUpdatedPlaytime ?? false,
        };

        await gamesSublevel.put(gameKey, gameRecord);
        count++;
      }

      const latest = this.storage.getSteam();
      if (latest) {
        this.storage.setSteam({
          ...latest,
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

  public async disconnect(): Promise<void> {
    this.cleanupSession();
    try {
      const { SteamSocialService } = await import(
        "../social/steam-social-service"
      );
      await SteamSocialService.disconnect();
    } catch {
      // ignore
    }

    this.storage.setSteam(null);
    this.setAuthState({ sessionId: "", status: "idle" });
    WindowManager.sendToAppWindows("on-store-accounts-updated");
  }

  public async getOwnedGames(): Promise<StoreLibraryGame[]> {
    const results: StoreLibraryGame[] = [];
    for await (const [, game] of gamesSublevel.iterator()) {
      if (game.isDeleted) continue;
      if (game.shop !== "steam" && !game.hasActiveSteamImport) continue;
      const assets = await gamesShopAssetsSublevel
        .get(levelKeys.game(game.shop, game.objectId))
        .catch(() => null);
      results.push({
        provider: "steam",
        storeId: game.objectId,
        title: game.title,
        coverUrl:
          assets?.coverImageUrl ||
          assets?.libraryImageUrl ||
          game.iconUrl ||
          null,
        installed: Boolean(
          game.executablePath && fs.existsSync(game.executablePath)
        ),
        playtimeMinutes: Math.round(
          (game.steamPlayTimeInMilliseconds ?? 0) / 60_000
        ),
      });
    }
    return results;
  }
}

export const SteamStoreService = new SteamStoreServiceImpl();
