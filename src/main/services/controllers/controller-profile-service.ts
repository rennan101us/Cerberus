import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ControllerProfile, ControllersState, SwitchButton } from "@types";
import { controllerProfilesSublevel } from "@main/level";
import { AppLogHub } from "@main/services/app-log-hub";
import { NxPathsService } from "@main/services/nxnative/nx-paths";

const DEFAULT_GAMEPAD_BINDINGS: Record<string, SwitchButton> = {
  buttonB: "A",
  buttonA: "B",
  buttonY: "X",
  buttonX: "Y",
  leftShoulder: "L",
  rightShoulder: "R",
  leftTrigger: "ZL",
  rightTrigger: "ZR",
  buttonMenu: "Plus",
  buttonOptions: "Minus",
  leftThumbstickButton: "L3",
  rightThumbstickButton: "R3",
  "dpad.up": "Up",
  "dpad.down": "Down",
  "dpad.left": "Left",
  "dpad.right": "Right",
};

const DEFAULT_KEYBOARD_BINDINGS: Record<string, SwitchButton> = {
  "14": "A", // E
  "49": "B", // Space
  "12": "X", // Q
  "15": "Y", // R
  "48": "L", // Tab
  "3": "R", // F
  "56": "ZL", // Shift
  "59": "ZR", // Control
  "36": "Plus", // Return
  "53": "Minus", // Escape
  "8": "L3", // C
  "9": "R3", // V
  "126": "Up", // Up Arrow
  "125": "Down", // Down Arrow
  "123": "Left", // Left Arrow
  "124": "Right", // Right Arrow
};

function createBaseProfile(
  overrides: Partial<ControllerProfile> & { id: string; name: string }
): ControllerProfile {
  return {
    id: overrides.id,
    name: overrides.name,
    isDefault: overrides.isDefault ?? false,
    targetDeviceName: overrides.targetDeviceName ?? "All Gamepads",
    gamepadBindings: {
      ...DEFAULT_GAMEPAD_BINDINGS,
      ...(overrides.gamepadBindings || {}),
    },
    keyboardBindings: {
      ...DEFAULT_KEYBOARD_BINDINGS,
      ...(overrides.keyboardBindings || {}),
    },
    keyboardMovement: overrides.keyboardMovement ?? {
      up: 13, // W
      left: 0, // A
      down: 1, // S
      right: 2, // D
    },
    analogDeadzone: overrides.analogDeadzone ?? 0.1,
    mouseMode: overrides.mouseMode ?? "auto",
    mouseAsRightStick: overrides.mouseAsRightStick ?? true,
    mouseSensitivity: overrides.mouseSensitivity ?? 5.0,
    mouseInvertX: overrides.mouseInvertX ?? false,
    mouseInvertY: overrides.mouseInvertY ?? false,
    mouseRightStickMode: overrides.mouseRightStickMode ?? "cursorLock",
    mouseSwitch2Enabled: overrides.mouseSwitch2Enabled ?? true,
    mouseSwitch2PointerSpeed: overrides.mouseSwitch2PointerSpeed ?? 1.0,
    mouseSwitch2LockCursor: overrides.mouseSwitch2LockCursor ?? true,
    mouseSwitch2PrimaryButton: overrides.mouseSwitch2PrimaryButton ?? "left",
    mouseSwitch2Side: overrides.mouseSwitch2Side ?? "right",
    mouseSwitch2InvertY: overrides.mouseSwitch2InvertY ?? false,
    enableRumble: overrides.enableRumble ?? true,
    rumbleStrength: overrides.rumbleStrength ?? 1.0,
    rumbleFloorBoost: overrides.rumbleFloorBoost ?? true,
  };
}

export function createFactoryProfiles(): ControllerProfile[] {
  const nintendo = createBaseProfile({
    id: "00000000-0000-0000-0000-000000000001",
    name: "Nintendo Switch (Default)",
    isDefault: true,
    targetDeviceName: "Nintendo Switch Pro Controller",
  });

  const xbox = createBaseProfile({
    id: "00000000-0000-0000-0000-000000000002",
    name: "Xbox / PC Controller",
    isDefault: false,
    targetDeviceName: "Xbox Wireless Controller",
    gamepadBindings: {
      ...DEFAULT_GAMEPAD_BINDINGS,
      buttonA: "A",
      buttonB: "B",
      buttonX: "Y",
      buttonY: "X",
    },
  });

  const playstation = createBaseProfile({
    id: "00000000-0000-0000-0000-000000000003",
    name: "PlayStation DualSense",
    isDefault: false,
    targetDeviceName: "DualSense / DualShock 4",
    gamepadBindings: {
      ...DEFAULT_GAMEPAD_BINDINGS,
      buttonA: "B",
      buttonB: "A",
      buttonX: "Y",
      buttonY: "X",
    },
  });

  return [nintendo, xbox, playstation];
}

function profileToExportDict(
  profile: ControllerProfile,
  enableGamepadProfile = true
): Record<string, unknown> {
  return {
    name: profile.name,
    analogDeadzone: profile.analogDeadzone,
    mouseMode: profile.mouseMode,
    mouseAsRightStick:
      profile.mouseMode === "rightStick" || profile.mouseMode === "auto",
    mouseSensitivity: profile.mouseSensitivity,
    mouseInvertX: profile.mouseInvertX,
    mouseInvertY: profile.mouseInvertY,
    mouseRightStickMode: profile.mouseRightStickMode,
    mouseSwitch2Enabled: profile.mouseSwitch2Enabled,
    mouseSwitch2PointerSpeed: profile.mouseSwitch2PointerSpeed,
    mouseSwitch2LockCursor: profile.mouseSwitch2LockCursor,
    mouseSwitch2PrimaryButton: profile.mouseSwitch2PrimaryButton,
    mouseSwitch2Side: profile.mouseSwitch2Side,
    mouseSwitch2InvertY: profile.mouseSwitch2InvertY,
    enableRumble: profile.enableRumble,
    rumbleStrength: profile.rumbleStrength,
    rumbleFloorBoost: profile.rumbleFloorBoost,
    enableGamepadProfile,
    gamepad: enableGamepadProfile ? profile.gamepadBindings : {},
    keyboard: profile.keyboardBindings,
    keyboardMovement: profile.keyboardMovement,
  };
}

export class ControllerProfileService {
  private static readonly STATE_KEY = "state";

  public static async getState(): Promise<ControllersState> {
    try {
      const saved = await controllerProfilesSublevel.get(this.STATE_KEY);
      if (saved && Array.isArray(saved.profiles) && saved.profiles.length > 0) {
        return saved;
      }
    } catch {
      // first launch
    }

    const factory = createFactoryProfiles();
    const initial: ControllersState = {
      profiles: factory,
      activeProfileId: factory[0].id,
      playerProfileIds: {
        "0": factory[0].id,
      },
    };
    await controllerProfilesSublevel.put(this.STATE_KEY, initial);
    return initial;
  }

  public static async saveState(
    state: ControllersState
  ): Promise<ControllersState> {
    await controllerProfilesSublevel.put(this.STATE_KEY, state);
    await this.exportGlobalMappingToDisk(state);
    return state;
  }

  public static async saveProfile(
    profile: ControllerProfile,
    syncKeyboardGlobally = false
  ): Promise<ControllersState> {
    const state = await this.getState();
    const idx = state.profiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) {
      state.profiles[idx] = profile;
    } else {
      state.profiles.push(profile);
    }

    if (syncKeyboardGlobally) {
      for (let i = 0; i < state.profiles.length; i++) {
        state.profiles[i] = {
          ...state.profiles[i],
          keyboardBindings: profile.keyboardBindings,
          keyboardMovement: profile.keyboardMovement,
          mouseMode: profile.mouseMode,
          mouseAsRightStick: profile.mouseAsRightStick,
          mouseSensitivity: profile.mouseSensitivity,
          mouseInvertX: profile.mouseInvertX,
          mouseInvertY: profile.mouseInvertY,
          mouseRightStickMode: profile.mouseRightStickMode,
          mouseSwitch2Enabled: profile.mouseSwitch2Enabled,
          mouseSwitch2PointerSpeed: profile.mouseSwitch2PointerSpeed,
          mouseSwitch2LockCursor: profile.mouseSwitch2LockCursor,
          mouseSwitch2PrimaryButton: profile.mouseSwitch2PrimaryButton,
          mouseSwitch2Side: profile.mouseSwitch2Side,
          mouseSwitch2InvertY: profile.mouseSwitch2InvertY,
        };
      }
    }

    return this.saveState(state);
  }

  public static async createProfile(
    name: string,
    templateId?: string
  ): Promise<{ state: ControllersState; created: ControllerProfile }> {
    const state = await this.getState();
    const base =
      state.profiles.find((p) => p.id === templateId) ||
      state.profiles.find((p) => p.id === state.activeProfileId) ||
      createFactoryProfiles()[0];

    const created: ControllerProfile = {
      ...structuredClone(base),
      id: crypto.randomUUID(),
      name: name.trim() || `Perfil ${state.profiles.length + 1}`,
      isDefault: false,
    };
    state.profiles.push(created);
    state.activeProfileId = created.id;
    await this.saveState(state);
    return { state, created };
  }

  public static async duplicateProfile(
    profileId: string
  ): Promise<{ state: ControllersState; created: ControllerProfile }> {
    const state = await this.getState();
    const source =
      state.profiles.find((p) => p.id === profileId) || state.profiles[0];
    return this.createProfile(`${source.name} (Cópia)`, source.id);
  }

  public static async deleteProfile(
    profileId: string
  ): Promise<ControllersState> {
    const state = await this.getState();
    const target = state.profiles.find((p) => p.id === profileId);
    if (!target || target.isDefault || state.profiles.length <= 1) {
      return state;
    }

    state.profiles = state.profiles.filter((p) => p.id !== profileId);
    const fallbackId = state.profiles[0].id;
    if (state.activeProfileId === profileId) {
      state.activeProfileId = fallbackId;
    }
    for (const slot of Object.keys(state.playerProfileIds)) {
      if (state.playerProfileIds[slot] === profileId) {
        state.playerProfileIds[slot] = fallbackId;
      }
    }
    return this.saveState(state);
  }

  public static async setPlayerProfile(
    playerSlot: number,
    profileId: string
  ): Promise<ControllersState> {
    const state = await this.getState();
    const key = String(Math.max(0, Math.min(7, playerSlot)));
    state.playerProfileIds[key] = profileId;
    if (playerSlot === 0) {
      state.activeProfileId = profileId;
    }
    return this.saveState(state);
  }

  public static resolveProfileForSlot(
    state: ControllersState,
    slot: number,
    gameOverride?: {
      controllerProfileId?: string | null;
      playerProfileIds?: Record<string, string> | null;
    }
  ): ControllerProfile {
    const key = String(slot);
    const overrideId =
      gameOverride?.playerProfileIds?.[key] ||
      (slot === 0 ? gameOverride?.controllerProfileId : null);

    const resolvedId =
      overrideId || state.playerProfileIds[key] || state.activeProfileId;
    return (
      state.profiles.find((p) => p.id === resolvedId) ||
      state.profiles.find((p) => p.id === state.activeProfileId) ||
      state.profiles[0]
    );
  }

  public static buildCompositeMapping(
    state: ControllersState,
    gameOverride?: {
      enableGamepadProfile?: boolean;
      controllerProfileId?: string | null;
      playerProfileIds?: Record<string, string> | null;
    }
  ): Record<string, unknown> {
    const enabled = gameOverride?.enableGamepadProfile ?? true;
    const p0 = this.resolveProfileForSlot(state, 0, gameOverride);
    const root = profileToExportDict(p0, enabled);

    const players: Record<string, unknown> = {};
    for (let i = 0; i < 8; i++) {
      const p = this.resolveProfileForSlot(state, i, gameOverride);
      players[String(i)] = profileToExportDict(p, enabled);
    }
    root.players = players;
    return root;
  }

  public static async exportMappingForApp(
    appPath: string,
    gameOverride?: {
      enableGamepadProfile?: boolean;
      controllerProfileId?: string | null;
      playerProfileIds?: Record<string, string> | null;
    }
  ): Promise<void> {
    const state = await this.getState();
    const composite = this.buildCompositeMapping(state, gameOverride);
    const dmDir = path.join(appPath, "Contents", "Resources", "dm");
    if (fs.existsSync(dmDir)) {
      fs.writeFileSync(
        path.join(dmDir, "input_mapping.json"),
        JSON.stringify(composite, null, 2),
        "utf8"
      );
    }
  }

  public static async exportGlobalMappingToDisk(
    providedState?: ControllersState
  ): Promise<void> {
    const state = providedState ?? (await this.getState());
    const composite = this.buildCompositeMapping(state);
    const jsonText = JSON.stringify(composite, null, 2);

    try {
      const appSupport = await NxPathsService.getAppSupportDirectory();
      fs.mkdirSync(appSupport, { recursive: true });
      fs.writeFileSync(
        path.join(appSupport, "input_mapping.json"),
        jsonText,
        "utf8"
      );

      const defaultAppSupport = NxPathsService.getDefaultAppSupportDirectory();
      if (path.resolve(defaultAppSupport) !== path.resolve(appSupport)) {
        fs.mkdirSync(defaultAppSupport, { recursive: true });
        fs.writeFileSync(
          path.join(defaultAppSupport, "input_mapping.json"),
          jsonText,
          "utf8"
        );
      }

      // Propagate to ported .app bundles in output directory
      const outputDir = await NxPathsService.getOutputDirectory();
      if (fs.existsSync(outputDir)) {
        for (const entry of fs.readdirSync(outputDir)) {
          if (!entry.endsWith(".app")) continue;
          const dmDir = path.join(
            outputDir,
            entry,
            "Contents",
            "Resources",
            "dm"
          );
          if (fs.existsSync(dmDir)) {
            fs.writeFileSync(
              path.join(dmDir, "input_mapping.json"),
              jsonText,
              "utf8"
            );
          }
        }
      }
    } catch (err) {
      AppLogHub.warn(
        "controllers",
        `Aviso ao exportar input_mapping.json: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Builds SDL_GAMECONTROLLERCONFIG & Wine controller environment variables for CrossOver/Red Wine
   * so Windows games respect the user's selected controller profile & face button layout.
   */
  public static async buildCrossOverControllerEnv(gameOverride?: {
    controllerProfileId?: string | null;
    playerProfileIds?: Record<string, string> | null;
  }): Promise<Record<string, string>> {
    const state = await this.getState();
    const profile = this.resolveProfileForSlot(state, 0, gameOverride);

    // Determine whether face buttons use Nintendo (East=A, South=B) or Xbox/PC (South=A, East=B)
    const isNintendoFaceLayout =
      profile.gamepadBindings.buttonB === "A" &&
      profile.gamepadBindings.buttonA === "B";

    // Map physical SDL buttons (b0=South, b1=East, b2=West, b3=North, etc.) based on profile bindings
    const physicalToSdl = (elem: string): string => {
      switch (elem) {
        case "buttonA":
          return "b0";
        case "buttonB":
          return "b1";
        case "buttonX":
          return "b2";
        case "buttonY":
          return "b3";
        case "leftShoulder":
          return "b9";
        case "rightShoulder":
          return "b10";
        case "buttonMenu":
          return "b6";
        case "buttonOptions":
          return "b4";
        case "leftThumbstickButton":
          return "b7";
        case "rightThumbstickButton":
          return "b8";
        case "dpad.up":
          return "b11";
        case "dpad.down":
          return "b12";
        case "dpad.left":
          return "b13";
        case "dpad.right":
          return "b14";
        default:
          return "";
      }
    };

    const switchToSdlLogical: Partial<Record<SwitchButton, string>> = {
      A: isNintendoFaceLayout ? "b" : "a",
      B: isNintendoFaceLayout ? "a" : "b",
      X: isNintendoFaceLayout ? "y" : "x",
      Y: isNintendoFaceLayout ? "x" : "y",
      L: "leftshoulder",
      R: "rightshoulder",
      Plus: "start",
      Minus: "back",
      L3: "leftstick",
      R3: "rightstick",
      Up: "dpup",
      Down: "dpdown",
      Left: "dpleft",
      Right: "dpright",
    };

    const mappings: string[] = [
      "leftx:a0",
      "lefty:a1",
      "rightx:a2",
      "righty:a3",
      "lefttrigger:a4",
      "righttrigger:a5",
    ];

    for (const [phys, swBtn] of Object.entries(profile.gamepadBindings)) {
      const sdlPhys = physicalToSdl(phys);
      const sdlLog = switchToSdlLogical[swBtn];
      if (sdlPhys && sdlLog) {
        mappings.push(`${sdlLog}:${sdlPhys}`);
      }
    }

    const mappingTail = `${mappings.join(",")},platform:Mac OS X,`;
    // Apply to common macOS SDL HID GUIDs (Xbox Series/One, DualSense, DualShock 4, Switch Pro)
    const commonGuids = [
      "030000005e040000130b000017050000,Xbox Wireless Controller",
      "030000004c050000e60c000000010000,PS5 DualSense Controller",
      "030000004c050000cc09000000010000,PS4 DualShock 4 Controller",
      "030000007e0500000920000001000000,Nintendo Switch Pro Controller",
    ];
    const sdlConfig = commonGuids.map((g) => `${g},${mappingTail}`).join("\n");

    return {
      SDL_GAMECONTROLLERCONFIG: sdlConfig,
      SDL_GAMECONTROLLER_USE_BUTTON_LABELS: isNintendoFaceLayout ? "1" : "0",
      CERBERUS_CONTROLLER_PROFILE: profile.name,
      CERBERUS_CONTROLLER_DEADZONE: profile.analogDeadzone.toFixed(2),
    };
  }
}
