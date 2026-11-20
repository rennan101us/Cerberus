import { registerEvent } from "../register-event";
import { CrossOverCompatibilityService } from "@main/services/crossover";

const getMacCompatibility = async (
  _event: Electron.IpcMainInvokeEvent,
  gameTitle: string,
  steamAppId?: string | null,
  forceRefresh = false
) => {
  return await CrossOverCompatibilityService.getCompatibilityReport({
    gameTitle,
    steamAppId,
    forceRefresh,
  });
};

registerEvent("getMacCompatibility", getMacCompatibility);
