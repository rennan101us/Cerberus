import { registerEvent } from "../register-event";
import { CrossOverDetector } from "@main/services/crossover";
import type { CrossOverStatus } from "@types";

const getCrossOverStatus = async (
  _event: Electron.IpcMainInvokeEvent,
  forceRefresh = false
): Promise<CrossOverStatus> => {
  return await CrossOverDetector.getStatus(forceRefresh);
};

registerEvent("getCrossOverStatus", getCrossOverStatus);
