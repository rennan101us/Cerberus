import { registerEvent } from "../register-event";
import { DownloadOrchestrator, GameFilesManager, logger } from "@main/services";
import type { GameShop } from "@types";

const cancelGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  logger.log(`[Downloads] Cancel requested for ${shop}:${objectId}`);
  if (shop === "steam") {
    const { DepotDownloaderService } = await import(
      "@main/services/stores/depot-downloader-service"
    );
    await DepotDownloaderService.cancelDownload(objectId);
  } else if (shop === "epic") {
    const { EpicDownloadService } = await import(
      "@main/services/stores/epic-download-service"
    );
    await EpicDownloadService.cancelDownload(objectId);
  }
  GameFilesManager.cancelPs4Extraction(shop, objectId);
  return DownloadOrchestrator.cancelDownloadById(shop, objectId);
};

registerEvent("cancelGameDownload", cancelGameDownload);
