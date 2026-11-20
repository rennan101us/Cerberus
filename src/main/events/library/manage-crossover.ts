import { registerEvent } from "../register-event";
import {
  CrossOverProvisioner,
  CrossOverDetector,
  CrossOverRunner,
} from "@main/services/crossover";
import { WindowManager } from "@main/services";
import type {
  CrossOverProvisionProgress,
  RedWineBottleConfig,
} from "@types";

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
      error instanceof Error ? error.message : "Failed to install Red Wine";
    onProgress({
      phase: "error",
      progress: 0,
      error: errorMessage,
    });
    return { success: false, error: errorMessage };
  }
};

const getHeadBottleDependenciesStatus = async () => {
  return await CrossOverProvisioner.getHeadBottleDependenciesStatus();
};

const provisionHeadBottleDependencies = async () => {
  const onProgress = (progress: CrossOverProvisionProgress) => {
    WindowManager.sendToAppWindows("on-crossover-provision-progress", progress);
  };

  try {
    const dependencies =
      await CrossOverProvisioner.provisionHeadBottleDependencies(onProgress);
    const status = await CrossOverDetector.getStatus(true);
    return { success: true, status, dependencies };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to provision Head Bottle dependencies";
    onProgress({
      phase: "error",
      progress: 0,
      error: errorMessage,
    });
    return { success: false, error: errorMessage };
  }
};

const getMacHardwareSpecs = async () => {
  return await CrossOverDetector.getMacHardwareSpecs();
};

registerEvent("resetCrossOverTrial", resetCrossOverTrial);
registerEvent("createCrossOverBottle", createCrossOverBottle);
registerEvent("installCrossOverDemo", installCrossOverDemo);
registerEvent("getHeadBottleDependenciesStatus", getHeadBottleDependenciesStatus);
registerEvent("provisionHeadBottleDependencies", provisionHeadBottleDependencies);
registerEvent("getMacHardwareSpecs", getMacHardwareSpecs);

registerEvent(
  "launchRedWineControlPanelTool",
  async (
    _event: Electron.IpcMainInvokeEvent,
    tool: "winecfg" | "joy" | "reboot" | "taskmgr" | "inetcpl"
  ) => CrossOverRunner.launchControlPanelTool(tool)
);

registerEvent(
  "getRedWineBottleConfig",
  async (_event: Electron.IpcMainInvokeEvent, bottleName?: string) =>
    CrossOverProvisioner.getBottleConfig(bottleName)
);

registerEvent(
  "saveRedWineBottleConfig",
  async (
    _event: Electron.IpcMainInvokeEvent,
    config: Partial<RedWineBottleConfig>,
    bottleName?: string
  ) => CrossOverProvisioner.saveBottleConfig(config, bottleName)
);
