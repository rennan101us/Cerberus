import { registerEvent } from "../register-event";
import type { GameShop, GameUninstallOptions } from "@types";
import { GameUninstallService } from "@main/services/uninstall/game-uninstall-service";

const getGameUninstallPreview = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  return await GameUninstallService.getUninstallPreview(shop, objectId);
};

const uninstallGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  options: GameUninstallOptions
) => {
  return await GameUninstallService.uninstallGame(shop, objectId, options);
};

registerEvent("getGameUninstallPreview", getGameUninstallPreview);
registerEvent("uninstallGame", uninstallGame);
