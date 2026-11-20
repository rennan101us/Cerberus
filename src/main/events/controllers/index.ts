import type { ControllerProfile, GameShop } from "@types";
import { registerEvent } from "../register-event";
import { levelKeys } from "@main/level";
import { updateGameRecord } from "@main/services/game-record-updater";
import { ControllerProfileService } from "@main/services/controllers/controller-profile-service";

registerEvent("controllersGetState", async () =>
  ControllerProfileService.getState()
);

registerEvent(
  "controllersSaveProfile",
  async (_e, profile: ControllerProfile, syncKeyboardGlobally = false) =>
    ControllerProfileService.saveProfile(profile, Boolean(syncKeyboardGlobally))
);

registerEvent(
  "controllersCreateProfile",
  async (_e, name: string, templateId?: string) =>
    ControllerProfileService.createProfile(name, templateId)
);

registerEvent("controllersDuplicateProfile", async (_e, profileId: string) =>
  ControllerProfileService.duplicateProfile(profileId)
);

registerEvent("controllersDeleteProfile", async (_e, profileId: string) =>
  ControllerProfileService.deleteProfile(profileId)
);

registerEvent(
  "controllersSetPlayerProfile",
  async (_e, playerSlot: number, profileId: string) =>
    ControllerProfileService.setPlayerProfile(playerSlot, profileId)
);

registerEvent("controllersExportMappings", async () => {
  await ControllerProfileService.exportGlobalMappingToDisk();
  return true;
});

registerEvent(
  "controllersSetGameProfiles",
  async (
    _e,
    shop: GameShop,
    objectId: string,
    controllerProfileId: string | null,
    playerProfileIds: Record<string, string> | null
  ) => {
    const gameKey = levelKeys.game(shop, objectId);
    await updateGameRecord(gameKey, (current) => ({
      ...current,
      controllerProfileId,
      playerProfileIds,
    }));
    return { controllerProfileId, playerProfileIds };
  }
);
