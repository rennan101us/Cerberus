import { updateGameRecord } from "@main/services/game-record-updater";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

const setGameVisibility = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  field: "isHiddenFromOthers" | "isConcealed",
  value: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);
  if (!game || game.isDeleted) {
    throw new Error("game/not-found-local");
  }

  if (shop === "custom") {
    if (field !== "isConcealed") throw new Error("game/not-found-local");
    const saved = { isHiddenFromOthers: false, isConcealed: value };
    await gamesSublevel.put(gameKey, { ...game, ...saved });
    return saved;
  }

  const saved = {
    isHiddenFromOthers:
      field === "isHiddenFromOthers"
        ? value
        : Boolean(game.isHiddenFromOthers),
    isConcealed:
      field === "isConcealed" ? value : Boolean(game.isConcealed),
  };

  await updateGameRecord(gameKey, saved);

  return saved;
};

registerEvent("setGameVisibility", setGameVisibility);
