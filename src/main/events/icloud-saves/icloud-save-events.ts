import type { GameShop } from "@types";
import { registerEvent } from "../register-event";
import { ICloudSaveService } from "@main/services/icloud-save-service";

registerEvent("icloudGetStatus", async () => {
  return ICloudSaveService.getStatus();
});

registerEvent(
  "icloudGetGameSaveInfo",
  async (_event, shop: GameShop, objectId: string) => {
    return ICloudSaveService.getGameSaveInfo(shop, objectId);
  }
);

registerEvent(
  "icloudBackupGameSave",
  async (_event, shop: GameShop, objectId: string) => {
    return ICloudSaveService.backupGameToICloud(shop, objectId);
  }
);

registerEvent(
  "icloudRestoreGameSave",
  async (_event, shop: GameShop, objectId: string) => {
    return ICloudSaveService.restoreGameFromICloud(shop, objectId);
  }
);

registerEvent(
  "icloudSetCustomSavePath",
  async (
    _event,
    shop: GameShop,
    objectId: string,
    customPath: string | null
  ) => {
    return ICloudSaveService.setCustomSavePath(shop, objectId, customPath);
  }
);

registerEvent(
  "icloudSetAutoSync",
  async (_event, shop: GameShop, objectId: string, enabled: boolean) => {
    await ICloudSaveService.setAutoSync(shop, objectId, enabled);
    return { ok: true };
  }
);

registerEvent(
  "icloudOpenSaveFolder",
  async (_event, shop: GameShop, objectId: string) => {
    await ICloudSaveService.openICloudFolder(shop, objectId);
    return { ok: true };
  }
);
