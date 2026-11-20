import { registerEvent } from "../register-event";
import { IgdbService } from "@main/services/igdb-service";

registerEvent("igdbGetStatus", async () => {
  const creds = await IgdbService.getCredentials();
  return {
    configured: Boolean(creds.clientId && creds.clientSecret),
    isCustom: creds.isCustom,
    clientId: "",
    hasSecret: Boolean(creds.clientSecret),
  };
});

registerEvent(
  "igdbSaveCredentials",
  async (_event, clientId: string, clientSecret: string) => {
    await IgdbService.saveCredentials(clientId, clientSecret);
    return IgdbService.testConnection();
  }
);

registerEvent("igdbTestConnection", async () => {
  return IgdbService.testConnection();
});

registerEvent("igdbClearCache", async () => {
  await IgdbService.clearCache();
  return { ok: true };
});
