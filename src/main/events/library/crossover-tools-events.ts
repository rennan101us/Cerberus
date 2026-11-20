import { registerEvent } from "../register-event";
import { CrossOverToolsService } from "@main/services/crossover";
import { WindowManager } from "@main/services";
import type { CrossOverToolDownloadProgress } from "@types";

const getCrossOverTools = async () => {
  return await CrossOverToolsService.getToolsWithStatus();
};

const installCrossOverTool = async (
  _event: Electron.IpcMainInvokeEvent,
  toolId: string
) => {
  const onProgress = (progress: CrossOverToolDownloadProgress) => {
    WindowManager.sendToAppWindows("on-crossover-tool-progress", progress);
  };

  return await CrossOverToolsService.downloadAndInstallTool(toolId, onProgress);
};

const launchCrossOverTool = async (
  _event: Electron.IpcMainInvokeEvent,
  toolId: string
) => {
  return await CrossOverToolsService.launchTool(toolId);
};

registerEvent("getCrossOverTools", getCrossOverTools);
registerEvent("installCrossOverTool", installCrossOverTool);
registerEvent("launchCrossOverTool", launchCrossOverTool);
