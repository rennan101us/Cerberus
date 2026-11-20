import { updateGameRecord } from "@main/services/game-record-updater";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import type { GameShop } from "@types";

const toggleGamePin = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  pin: boolean
) => {
  try {
    const gameKey = levelKeys.game(shop, objectId);

    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    await updateGameRecord(gameKey, {
      isPinned: pin,
      pinnedDate: pin ? new Date() : null,
    });
  } catch (error) {
    logger.error("Failed to update game pinned status", error);
    throw new Error(`Failed to update game pinned status: ${error}`);
  }
};

registerEvent("toggleGamePin", toggleGamePin);
