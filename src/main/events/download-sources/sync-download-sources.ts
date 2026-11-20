import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";
import { downloadSourcesSublevel } from "@main/level";
import type { DownloadSource } from "@types";
import { NxCloudScraperService } from "@main/services/nxnative/nx-cloud-scraper-service";

const syncDownloadSources = async (_event: Electron.IpcMainInvokeEvent) => {
  const downloadSources = await downloadSourcesSublevel.values().all();

  const hydraSources = downloadSources.filter((s) => s.sourceKind !== "switch");
  const hasSwitchSources = downloadSources.some(
    (s) => s.sourceKind === "switch"
  );

  if (hydraSources.length > 0) {
    const response = await HydraApi.post<DownloadSource[]>(
      "/download-sources/sync",
      {
        ids: hydraSources.map((downloadSource) => downloadSource.id),
      },
      { needsAuth: false }
    );

    for (const downloadSource of response) {
      const existingDownloadSource = hydraSources.find(
        (source) => source.id === downloadSource.id
      );

      await downloadSourcesSublevel.put(downloadSource.id, {
        ...existingDownloadSource,
        ...downloadSource,
        sourceKind: "hydra",
      });
    }
  }

  if (hasSwitchSources) {
    await NxCloudScraperService.syncAllSwitchSources();
  }
};

registerEvent("syncDownloadSources", syncDownloadSources);
