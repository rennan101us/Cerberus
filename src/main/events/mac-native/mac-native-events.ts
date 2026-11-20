import { registerEvent } from "../register-event";
import type { MacNativeDownloadOption } from "@types";
import { MacNativeCatalogueService } from "@main/services/mac-native/mac-native-catalogue-service";

registerEvent("macNativeGetCatalogue", async (_event, forceRefresh = false) => {
  return MacNativeCatalogueService.getCatalogue(Boolean(forceRefresh));
});

registerEvent("macNativeSearchCatalogue", async (_event, query: string) => {
  return MacNativeCatalogueService.searchLive(query || "");
});

registerEvent(
  "macNativeGetDownloadOptions",
  async (_event, objectId: string, fallbackTitle?: string) => {
    return MacNativeCatalogueService.resolveDownloadOptions(
      objectId,
      fallbackTitle
    );
  }
);

registerEvent(
  "macNativeStartDownload",
  async (
    _event,
    params: {
      objectId: string;
      title: string;
      option: MacNativeDownloadOption;
      downloadPath?: string;
    }
  ) => {
    return MacNativeCatalogueService.startDownload(params);
  }
);
