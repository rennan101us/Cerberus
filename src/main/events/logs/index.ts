import { registerEvent } from "../register-event";
import { AppLogHub } from "@main/services/app-log-hub";

registerEvent("logsGetAll", async () => AppLogHub.getAll());

registerEvent("logsClear", async () => {
  AppLogHub.clear();
  return true;
});
