import { registerEvent } from "../register-event";
import {
  CrossOverProvisioner,
  CrossOverDetector,
} from "@main/services/crossover";
import { WindowManager } from "@main/services";
import type { CrossOverProvisionProgress } from "@types";

const resetCrossOverTrial = async () => {
  return await CrossOverProvisioner.resetTrial();
};

const createCrossOverBottle = async (
  _event: Electron.IpcMainInvokeEvent,
  bottleName: string
) => {
  const bottleDir = await CrossOverProvisioner.ensureBottle(bottleName);
  return { bottleDir };
};

const installCrossOverDemo = async () => {
  const onProgress = (progress: CrossOverProvisionProgress) => {
    WindowManager.sendToAppWindows("on-crossover-provision-progress", progress);
  };

  try {
    const appPath =
      await CrossOverProvisioner.downloadAndInstallCrossOver(onProgress);
    const status = await CrossOverDetector.getStatus(true);
    return { success: true, appPath, status };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to install CrossOver";
    onProgress({
      phase: "error",
      progress: 0,
      error: errorMessage,
    });
    return { success: false, error: errorMessage };
  }
};

registerEvent("resetCrossOverTrial", resetCrossOverTrial);
registerEvent("createCrossOverBottle", createCrossOverBottle);
registerEvent("installCrossOverDemo", installCrossOverDemo);
