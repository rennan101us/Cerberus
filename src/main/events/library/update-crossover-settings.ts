import { registerEvent } from "../register-event";
import { levelKeys, gamesSublevel } from "@main/level";
import { updateGameRecord } from "@main/services/game-record-updater";
import type { GameShop, MacOSCompatibilityOptions } from "@types";

const updateCrossOverSettings = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  options: MacOSCompatibilityOptions
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);

  if (!game) return;

  await updateGameRecord(gameKey, {
    macOSCompatibility: options,
  });
};

registerEvent("updateCrossOverSettings", updateCrossOverSettings);
