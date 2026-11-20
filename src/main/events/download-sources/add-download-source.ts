import crypto from "node:crypto";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services/hydra-api";
import { downloadSourcesSublevel } from "@main/level";
import type { DownloadSource } from "@types";
import { DownloadSourceStatus } from "@shared";
import { logger } from "@main/services";
import { NxCloudScraperService } from "@main/services/nxnative/nx-cloud-scraper-service";

const addSwitchDownloadSource = async (
  url: string,
  customName?: string
): Promise<DownloadSource> => {
  let derivedName = customName?.trim() || "";
  if (!derivedName) {
    if (url.startsWith("magnet:")) {
      derivedName = "Magnet Switch";
    } else {
      try {
        derivedName = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        derivedName = "Fonte Switch";
      }
    }
  }

  const draft: DownloadSource = {
    id: `switch_${crypto.randomUUID()}`,
    name: derivedName,
    url,
    status: DownloadSourceStatus.PendingMatching,
    downloadCount: 0,
    fingerprint: `switch:${derivedName.toLowerCase()}`,
    createdAt: new Date().toISOString(),
    sourceKind: "switch",
    isEnabled: true,
  };

  await downloadSourcesSublevel.put(draft.id, draft);
  const { updatedSource } = await NxCloudScraperService.syncSingleSource(draft);
  await downloadSourcesSublevel.put(updatedSource.id, updatedSource);
  await NxCloudScraperService.syncAllSwitchSources();
  return updatedSource;
};

const addDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  rawUrl: string,
  options?: { name?: string; kind?: "auto" | "hydra" | "switch" }
) => {
  const url = rawUrl.trim();
  const kind = options?.kind ?? "auto";

  try {
    const existingSources = await downloadSourcesSublevel.values().all();
    const urlExists = existingSources.some((source) => source.url === url);

    if (urlExists) {
      throw new Error("Download source with this URL already exists");
    }

    if (
      kind === "switch" ||
      (kind === "auto" && NxCloudScraperService.isLikelySwitchSourceUrl(url))
    ) {
      return await addSwitchDownloadSource(url, options?.name);
    }

    try {
      const downloadSource = await HydraApi.post<DownloadSource>(
        "/download-sources",
        {
          url,
        },
        { needsAuth: false }
      );

      const saved: DownloadSource = {
        ...downloadSource,
        isRemote: true,
        sourceKind: "hydra",
        isEnabled: true,
        createdAt: new Date().toISOString(),
      };
      await downloadSourcesSublevel.put(saved.id, saved);
      return saved;
    } catch (hydraErr) {
      if (kind === "auto") {
        // Fallback: treat as a Switch HTML/Cloud/JSON source locally
        return await addSwitchDownloadSource(url, options?.name);
      }
      throw hydraErr;
    }
  } catch (error) {
    logger.error("Failed to add download source:", error);
    throw error;
  }
};

const toggleDownloadSourceEnabled = async (
  _event: Electron.IpcMainInvokeEvent,
  downloadSourceId: string,
  enabled: boolean
) => {
  const source = await downloadSourcesSublevel.get(downloadSourceId);
  if (!source) return null;
  const updated: DownloadSource = { ...source, isEnabled: enabled };
  await downloadSourcesSublevel.put(downloadSourceId, updated);
  if (updated.sourceKind === "switch") {
    await NxCloudScraperService.syncAllSwitchSources();
  }
  return updated;
};

registerEvent("addDownloadSource", addDownloadSource);
registerEvent("toggleDownloadSourceEnabled", toggleDownloadSourceEnabled);
