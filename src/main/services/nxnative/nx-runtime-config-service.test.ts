import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadRuntimeConfigService(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nx-rt-test-"));
  const key = "__nxRtTest" + randomUUID();
  const globals = globalThis as unknown as Record<string, unknown>;
  globals[key] = {};

  t.after(async () => {
    delete globals[key];
    await fs.rm(root, { recursive: true, force: true });
  });

  const stubs: Record<string, string> = {
    "@main/level":
      "export const db = {}; export const gamesSublevel = {}; export const levelKeys = { game: (s, o) => `${s}:${o}`, userPreferences: 'userPreferences' };",
    "@main/services/game-record-updater":
      "export const updateGameRecord = async () => {};",
    "@main/services/app-log-hub":
      "export const AppLogHub = { info() {}, warn() {}, step() {}, error() {}, success() {} };",
    "@main/services/controllers/controller-profile-service":
      "export const ControllerProfileService = { getState: async () => ({}), resolveProfileForSlot: () => ({}), exportMappingForApp: async () => {} };",
    "./nx-paths":
      "export const NxPathsService = { getHardwareInfo: () => ({ supports120Hz: false }), getAppSupportDirectory: async () => '/tmp', getDefaultAppSupportDirectory: () => '/tmp', getDiskFreeBytes: () => 0, isICloudDriveAvailable: () => false, getICloudRootDirectory: () => '/tmp/CloudDocs' };",
    "./nx-scanner-service":
      "export const NxScannerService = { getSupportedLanguages: () => ({ defaultLanguage: null }) };",
  };

  const bundlePath = path.join(root, "nx-runtime-config.mjs");
  await build({
    entryPoints: [
      fileURLToPath(new URL("./nx-runtime-config-service.ts", import.meta.url)),
    ],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    plugins: [
      {
        name: "stubs",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (Object.hasOwn(stubs, args.path)) {
              return { path: args.path, namespace: "test" };
            }
            return undefined;
          });
          builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
            contents: stubs[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });

  const mod = (await import(
    pathToFileURL(bundlePath).href
  )) as typeof import("./nx-runtime-config-service");
  return mod;
}

test("mergeEnvFileText strips CloudDocs paths, resets DM_TEX_RELEASE=1|2 and cleans stale OoT overrides", async (t) => {
  const { NxRuntimeConfigService, createDefaultRuntimeConfig } =
    await loadRuntimeConfigService(t);

  const cfg = createDefaultRuntimeConfig(false);
  const entries = NxRuntimeConfigService.buildEnvEntries(cfg, {
    titleId: "0400A3A01EE4C000",
    isOot: false,
    supports120Hz: true,
  });

  assert.equal("DM_FRAMEGEN" in entries, false);
  assert.equal("DM_SLOWFRAME" in entries, false);
  assert.equal("DM_SCREEN_MATCH" in entries, false);

  const existing = [
    "DM_SAVE=/Users/test/Library/Mobile Documents/com~apple~CloudDocs/nxnative_launcher/0400A3A01EE4C000/save",
    "DM_PSO_ARCHIVE=/Users/test/Library/Mobile Documents/com~apple~CloudDocs/nxnative_launcher/0400A3A01EE4C000/pso_archive",
    "DM_PSO_USER=/Users/test/Library/CloudDocs/pso_user.tsv",
    "DM_TEX_RELEASE=2",
    "DM_FRAMEGEN=0",
    "DM_FRAMEGEN_MAXK=2",
    "DM_PRESENT_LINK=1",
    "DM_RES_PRESET=1",
    "DM_UPSCALER=off",
    "CUSTOM_KEEP=yes",
  ].join("\n");

  const merged = NxRuntimeConfigService.mergeEnvFileText(
    existing,
    entries,
    false
  );

  assert.equal(merged.includes("CloudDocs"), false);
  assert.equal(merged.includes("Mobile Documents"), false);
  assert.equal(merged.includes("DM_FRAMEGEN_MAXK"), false);
  assert.equal(merged.includes("DM_PRESENT_LINK"), false);
  assert.equal(merged.includes("DM_RES_PRESET"), false);
  assert.equal(merged.includes("DM_UPSCALER"), false);
  assert.equal(merged.includes("DM_TEX_RELEASE=0"), true);
  assert.equal(merged.includes("DM_TEX_RELEASE=2"), false);
  assert.equal(merged.includes("CUSTOM_KEEP=yes"), true);
});

test("buildSwitchLaunchEnv forces local APFS save/PSO dirs, replaces /Volumes TMPDIR, and emits DM_SAVE_SYNC only when enabled", async (t) => {
  const { NxRuntimeConfigService, createDefaultRuntimeConfig } =
    await loadRuntimeConfigService(t);

  const cfg = createDefaultRuntimeConfig(false);
  const env = NxRuntimeConfigService.buildSwitchLaunchEnv({
    titleId: "0400a3a01ee4c000",
    appPath: "/Volumes/SSD FN501 PRO/Games/Pokopia.app",
    isSwitch2: true,
    isOot: false,
    supports120Hz: false,
    config: cfg,
    profile: {
      enableRumble: true,
      rumbleStrength: 1.0,
      rumbleFloorBoost: false,
      mouseSensitivity: 1.0,
      mouseInvertX: false,
      mouseInvertY: false,
      mouseRightStickMode: "camera",
      mouseSwitch2Enabled: false,
      mouseSwitch2PointerSpeed: 1.0,
      mouseSwitch2LockCursor: false,
      mouseSwitch2PrimaryButton: "left",
      mouseSwitch2Side: "right",
      mouseSwitch2InvertY: false,
      mouseAsRightStick: false,
    },
    canonicalDataDir: "/Users/test/Library/Application Support/nxnative",
    appSupportDir: "/Volumes/SSD FN501 PRO/Emulations/NativePort/NxNative_Data/AppSupport",
    logsDir: "/Users/test/Library/Logs/nxnative",
    tmpDir: "/Volumes/SSD FN501 PRO/Staging/.tmp",
    icloudSyncRoot: "/Users/test/Library/Mobile Documents/com~apple~CloudDocs/nxnative_launcher",
    hostEnv: {
      HOME: "/Users/test",
      USER: "test",
      PATH: "/usr/bin:/bin",
    },
  });

  assert.equal(
    env.DM_SAVE,
    "/Users/test/Library/Application Support/nxnative/0400A3A01EE4C000/save"
  );
  assert.equal(
    env.DM_PSO_ARCHIVE,
    "/Users/test/Library/Application Support/nxnative/0400A3A01EE4C000/pso_archive"
  );
  assert.equal(
    env.DM_PSO_USER,
    "/Users/test/Library/Application Support/nxnative/0400A3A01EE4C000/pso_user.tsv"
  );
  assert.equal(env.TMPDIR.startsWith("/Volumes/"), false);
  assert.equal(
    env.DM_SAVE_SYNC,
    "/Users/test/Library/Mobile Documents/com~apple~CloudDocs/nxnative_launcher"
  );
  assert.equal(env.HOME, "/Users/test");
  assert.equal(env.USER, "test");
  assert.equal(env.PATH, "/usr/bin:/bin");
});
