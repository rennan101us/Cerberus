import { downloadSourcesSublevel, nxCloudStreamsSublevel } from "@main/level";
import { registerEvent } from "../register-event";
import { NxCloudScraperService } from "@main/services/nxnative/nx-cloud-scraper-service";

const removeDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  removeAll = false,
  downloadSourceId?: string
) => {
  const target =
    !removeAll && downloadSourceId
      ? await downloadSourcesSublevel.get(downloadSourceId).catch(() => null)
      : null;

  const isSwitchOnly = target?.sourceKind === "switch";

  if (removeAll) {
    await downloadSourcesSublevel.clear();
    await nxCloudStreamsSublevel.clear();
  } else if (downloadSourceId) {
    await downloadSourcesSublevel.del(downloadSourceId);
    if (isSwitchOnly) {
      await NxCloudScraperService.syncAllSwitchSources();
    }
  }
};

registerEvent("removeDownloadSource", removeDownloadSource);
