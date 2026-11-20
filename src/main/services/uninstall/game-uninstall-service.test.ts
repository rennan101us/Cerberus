import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadUninstallService(t: TestContext) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "uninstall-test-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const stubs: Record<string, string> = {
    electron: "export const shell = { trashItem: async () => {} };",
    "@main/level":
      "export const gamesSublevel = { get: async () => null }; export const downloadsSublevel = { del: async () => {} }; export const levelKeys = { game: (s, o) => `${s}:${o}` };",
    "@main/services/game-record-updater":
      "export const updateGameRecord = async () => {};",
    "@main/helpers/update-executable-path":
      "export const updateGameExecutablePath = (g) => g;",
    "@main/helpers/remove-library-game":
      "export const removeLibraryGame = async () => {};",
    "@main/services/ludusavi":
      "export const Ludusavi = { previewGame: async () => null };",
    "@main/services/icloud-save-service":
      "export const ICloudSaveService = { getGameSaveInfo: async () => ({ localSavePaths: [], customSavePath: null }) };",
    "@main/services/crossover/crossover-detector":
      "export const DEFAULT_BOTTLE_NAME = 'Head Bottle'; export const CrossOverDetector = { getBottlesDirectory: async () => '/tmp' };",
    "@main/services/crossover/crossover-runner":
      "export const CrossOverRunner = { runCommandAndWait: async () => ({ ok: true, exitCode: 0 }) };",
    "@main/services/nxnative/nx-paths":
      "export const NxPathsService = { getStagingDirectory: async () => '/tmp', getAppSupportDirectory: async () => '/tmp', getCachesDirectory: () => '/tmp' };",
    "@main/services/nxnative/nx-runtime-config-service":
      "export const NxRuntimeConfigService = { getCanonicalMacNxNativeDataDir: () => '/tmp' };",
    "@main/services/window-manager":
      "export const WindowManager = { sendToAppWindows() {} };",
    "@main/services/app-log-hub":
      "export const AppLogHub = { info() {}, warn() {}, step() {}, error() {}, success() {} };",
    "@main/services/logger":
      "export const logger = { info() {}, warn() {}, error() {} };",
  };

  const bundlePath = path.join(root, "game-uninstall-service.mjs");
  await build({
    entryPoints: [
      fileURLToPath(new URL("./game-uninstall-service.ts", import.meta.url)),
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

  return (await import(
    pathToFileURL(bundlePath).href
  )) as typeof import("./game-uninstall-service");
}

test("isSafeRemovableInstallDir blocks system/bottle roots and allows game subdirectories", async (t) => {
  const { isSafeRemovableInstallDir } = await loadUninstallService(t);

  assert.equal(isSafeRemovableInstallDir("/"), false);
  assert.equal(isSafeRemovableInstallDir(os.homedir()), false);
  assert.equal(isSafeRemovableInstallDir("/Applications"), false);
  assert.equal(isSafeRemovableInstallDir("/Applications/Cerberus.app"), false);
  assert.equal(isSafeRemovableInstallDir("/Volumes/SSD"), false);
  assert.equal(
    isSafeRemovableInstallDir("/Users/test/CrossOver/Bottles/Head Bottle"),
    false
  );
  assert.equal(
    isSafeRemovableInstallDir(
      "/Users/test/CrossOver/Bottles/Head Bottle/drive_c"
    ),
    false
  );
  assert.equal(
    isSafeRemovableInstallDir(
      "/Users/test/CrossOver/Bottles/Head Bottle/drive_c/Program Files (x86)"
    ),
    false
  );
  assert.equal(
    isSafeRemovableInstallDir(
      "/Users/test/CrossOver/Bottles/Head Bottle/drive_c/Program Files (x86)/My Awesome Game"
    ),
    true
  );
});

test("findUninstallerInDirectory detects unins000.exe and uninstall.exe", async (t) => {
  const { findUninstallerInDirectory } = await loadUninstallService(t);

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "uninst-scan-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));

  assert.equal(findUninstallerInDirectory(dir), null);

  const sub = path.join(dir, "redist");
  await fsp.mkdir(sub, { recursive: true });
  await fsp.writeFile(path.join(sub, "uninstall.exe"), "ignored-redist");
  assert.equal(findUninstallerInDirectory(dir), null);

  const nestedUninst = path.join(dir, "uninstall.exe");
  await fsp.writeFile(nestedUninst, "exe");
  assert.equal(findUninstallerInDirectory(dir), nestedUninst);

  const innoUnins = path.join(dir, "unins000.exe");
  await fsp.writeFile(innoUnins, "exe");
  assert.equal(findUninstallerInDirectory(dir), innoUnins);
});

test("parseWineRegistryUninstallString parses UninstallString from system.reg", async (t) => {
  const { parseWineRegistryUninstallString } = await loadUninstallService(t);

  const reg = `WINE REGISTRY Version 2

[Software\\\\Wow6432Node\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\Other App] 1700000000
"DisplayName"="Other App"
"UninstallString"="C:\\\\Program Files\\\\Other\\\\uninstall.exe"

[Software\\\\Wow6432Node\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\Elden Ring_is1] 1700000100
"DisplayName"="ELDEN RING"
"InstallLocation"="C:\\\\Games\\\\Elden Ring\\\\"
"UninstallString"="\\"C:\\\\Games\\\\Elden Ring\\\\unins000.exe\\" /SILENT"
`;

  const found = parseWineRegistryUninstallString(
    reg,
    "Elden Ring",
    "/tmp/Head Bottle/drive_c/Games/Elden Ring"
  );
  assert.equal(found, "C:\\Games\\Elden Ring\\unins000.exe");
});

test("computePathsSizeBytes, formatMegabytes, and Switch uninstall flow respect staging & save checkboxes", async (t) => {
  const {
    computePathsSizeBytes,
    formatMegabytes,
    buildSwitchUninstallPreview,
    executeSwitchUninstall,
  } = await loadUninstallService(t);

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "switch-uninst-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const appPath = path.join(root, "Apps", "Pokopia.app");
  const stagingDir = path.join(root, "Staging");
  const tidStaging = path.join(stagingDir, "0400A3A01EE4C000");
  const tmpShared = path.join(stagingDir, ".tmp");
  const canonicalDataDir = path.join(root, "CanonicalData");
  const saveDir = path.join(canonicalDataDir, "0400A3A01EE4C000", "save");

  await fsp.mkdir(path.join(appPath, "Contents"), { recursive: true });
  await fsp.mkdir(tidStaging, { recursive: true });
  await fsp.mkdir(tmpShared, { recursive: true });
  await fsp.mkdir(saveDir, { recursive: true });

  await fsp.writeFile(
    path.join(appPath, "Contents", "rom.bin"),
    Buffer.alloc(2 * 1024 * 1024)
  );
  await fsp.writeFile(
    path.join(tidStaging, "work.bin"),
    Buffer.alloc(512 * 1024)
  );
  await fsp.writeFile(
    path.join(saveDir, "slot0.sav"),
    Buffer.alloc(1024 * 1024)
  );
  await fsp.writeFile(path.join(tmpShared, "keep.tmp"), Buffer.alloc(64));

  const preview = await buildSwitchUninstallPreview({
    titleId: "0400A3A01EE4C000",
    title: "Pokemon Pokopia",
    appPath,
    stagingDir,
    canonicalDataDir,
    appSupportDir: canonicalDataDir,
    cachesDir: null,
  });

  assert.equal(preview.kind, "switch");
  assert.equal(preview.installSizeBytes, 2 * 1024 * 1024);
  assert.equal(preview.stagingSizeBytes, 512 * 1024);
  assert.equal(preview.saveSizeBytes, 1024 * 1024);
  assert.equal(formatMegabytes(preview.saveSizeBytes), "1.0 MB");
  assert.equal(formatMegabytes(0), "0 MB");
  assert.equal(
    await computePathsSizeBytes([saveDir, path.join(saveDir, "slot0.sav")]),
    1024 * 1024
  );

  // Uninstall keeping saves and staging
  await executeSwitchUninstall(preview, {
    deleteSaves: false,
    deleteStaging: false,
  });
  assert.equal(fs.existsSync(appPath), false);
  assert.equal(fs.existsSync(tidStaging), true);
  assert.equal(fs.existsSync(saveDir), true);
  assert.equal(fs.existsSync(tmpShared), true);

  // Uninstall deleting staging & saves
  await executeSwitchUninstall(preview, {
    deleteSaves: true,
    deleteStaging: true,
  });
  assert.equal(fs.existsSync(tidStaging), false);
  assert.equal(fs.existsSync(saveDir), false);
  assert.equal(fs.existsSync(tmpShared), true);
});

test("resolveWindowsInstallDir never climbs into a multi-game container like DODI-Repacks", async (t) => {
  const { GameUninstallService, isSafeRemovableInstallDir } =
    await loadUninstallService(t);

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "uninst-dodi-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const container = path.join(
    root,
    "Bottles",
    "Head Bottle",
    "drive_c",
    "Program Files (x86)",
    "DODI-Repacks"
  );
  const metaphor = path.join(container, "Metaphor ReFantazio");
  const castle = path.join(container, "Castlevania Belmont Curse");
  await fsp.mkdir(path.join(castle, "Uninstall"), { recursive: true });
  await fsp.mkdir(metaphor, { recursive: true });
  await fsp.writeFile(path.join(castle, "Uninstall", "unins000.exe"), "x");
  await fsp.writeFile(path.join(castle, "Castle.exe"), "x");
  await fsp.writeFile(path.join(metaphor, "METAPHOR.exe"), "x");

  assert.equal(isSafeRemovableInstallDir(container), false);

  const resolve = (
    GameUninstallService as unknown as {
      resolveWindowsInstallDir: (e: string, o?: string[]) => string | null;
    }
  ).resolveWindowsInstallDir.bind(GameUninstallService);

  // Metaphor has no uninstaller of its own: must NOT adopt the sibling's.
  assert.equal(
    resolve(path.join(metaphor, "METAPHOR.exe"), [
      path.join(castle, "Castle.exe"),
    ]),
    metaphor
  );

  // Own uninstaller at the game root: stops there.
  await fsp.writeFile(path.join(metaphor, "unins000.exe"), "x");
  assert.equal(resolve(path.join(metaphor, "METAPHOR.exe")), metaphor);
});

test("resolveWindowsInstallDir still climbs out of engine subfolders to the game root", async (t) => {
  const { GameUninstallService } = await loadUninstallService(t);

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "uninst-engine-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const game = path.join(root, "Games", "MyGame");
  const exeDir = path.join(game, "Binaries", "Win64");
  await fsp.mkdir(exeDir, { recursive: true });
  await fsp.writeFile(path.join(exeDir, "MyGame.exe"), "x");
  await fsp.writeFile(path.join(game, "unins000.exe"), "x");

  const resolve = (
    GameUninstallService as unknown as {
      resolveWindowsInstallDir: (e: string, o?: string[]) => string | null;
    }
  ).resolveWindowsInstallDir.bind(GameUninstallService);

  assert.equal(resolve(path.join(exeDir, "MyGame.exe")), game);
});
