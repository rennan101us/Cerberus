import { registerEvent } from "../register-event";
import type { SteamDepotLoginInput, StoreProvider } from "@types";
import { SteamStoreService } from "@main/services/stores/steam-store-service";
import { EpicStoreService } from "@main/services/stores/epic-store-service";
import { GogStoreService } from "@main/services/stores/gog-store-service";
import { GogDownloadService } from "@main/services/stores/gog-download-service";
import { DepotDownloaderService } from "@main/services/stores/depot-downloader-service";
import { EpicDownloadService } from "@main/services/stores/epic-download-service";

registerEvent("storesGetAccounts", () => ({
  steam: SteamStoreService.getAccount(),
  epic: EpicStoreService.getAccount(),
  gog: GogStoreService.getAccount(),
}));

registerEvent("storesGetSteamAuthState", () =>
  SteamStoreService.getAuthState()
);

registerEvent("storesStartSteamQrLogin", () =>
  SteamStoreService.startQrLogin()
);

registerEvent(
  "storesStartSteamCredentialsLogin",
  (_event, input: SteamDepotLoginInput) =>
    SteamStoreService.startCredentialsLogin(input.username, input.password)
);

registerEvent("storesSubmitSteamGuardCode", (_event, code: string) =>
  SteamStoreService.submitGuardCode(code)
);

registerEvent("storesCancelSteamLogin", () => {
  SteamStoreService.cancelLogin();
});

registerEvent("storesDisconnectSteam", () => SteamStoreService.disconnect());

registerEvent("storesSyncSteamLibrary", () => SteamStoreService.syncLibrary());

registerEvent("storesStartEpicLogin", () => EpicStoreService.startLogin());

registerEvent("storesDisconnectEpic", () => EpicStoreService.disconnect());

registerEvent("storesSyncEpicLibrary", () => EpicStoreService.syncLibrary());

registerEvent("storesStartGogLogin", () => GogStoreService.startLogin());

registerEvent("storesDisconnectGog", () => GogStoreService.disconnect());

registerEvent("storesSyncGogLibrary", () => GogStoreService.syncLibrary());

registerEvent("storesGetGogDownloads", (_event, gameId: string) =>
  GogDownloadService.getProductDownloads(gameId)
);

registerEvent("storesResolveGogDownlink", (_event, downlink: string) =>
  GogDownloadService.resolveDownlink(downlink)
);

registerEvent(
  "storesGetOwnedGames",
  async (_event, provider?: StoreProvider) => {
    if (provider === "steam") return SteamStoreService.getOwnedGames();
    if (provider === "epic") return EpicStoreService.getOwnedGames();
    if (provider === "gog") return GogStoreService.getOwnedGames();
    const [steam, epic, gog] = await Promise.all([
      SteamStoreService.getOwnedGames(),
      EpicStoreService.getOwnedGames(),
      GogStoreService.getOwnedGames(),
    ]);
    return [...steam, ...epic, ...gog];
  }
);

registerEvent(
  "storesStartGameDownload",
  async (
    _event,
    payload: {
      provider: StoreProvider;
      storeId: string;
      title: string;
      username?: string;
      password?: string;
      useQr?: boolean;
      installBaseDir?: string;
    }
  ) => {
    if (payload.provider === "steam") {
      return DepotDownloaderService.startSteamDownload({
        appId: payload.storeId,
        title: payload.title,
        username: payload.username,
        password: payload.password,
        useQr: payload.useQr,
        installBaseDir: payload.installBaseDir,
      });
    }
    return EpicDownloadService.startDownload({
      appName: payload.storeId,
      title: payload.title,
      installBaseDir: payload.installBaseDir,
    });
  }
);

registerEvent(
  "storesCancelGameDownload",
  async (_event, payload: { provider: StoreProvider; storeId: string }) => {
    if (payload.provider === "steam") {
      await DepotDownloaderService.cancelDownload(payload.storeId);
      return;
    }
    await EpicDownloadService.cancelDownload(payload.storeId);
  }
);

registerEvent(
  "storesSubmitDownloadInput",
  (
    _event,
    payload: { provider: StoreProvider; storeId: string; value: string }
  ) => {
    if (payload.provider === "steam") {
      return DepotDownloaderService.submitInput(payload.storeId, payload.value);
    }
    return false;
  }
);

registerEvent("storesGetActiveDownloads", () => [
  ...DepotDownloaderService.getActiveDownloads(),
  ...EpicDownloadService.getActiveDownloads(),
]);
