import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CERBERUS_CACHE_FOLDER_NAME,
  CerberusPathsService,
  resolveAppBundleContainerDir,
} from "./cerberus-paths.js";

describe("CerberusPathsService", () => {
  it("resolves the parent folder of Cerberus.app on packaged macOS builds", () => {
    const container = resolveAppBundleContainerDir({
      execPath:
        "/Volumes/SSD FN501 PRO/Emulations/Cerberus Launcher/dist/mac-arm64/Cerberus.app/Contents/MacOS/Cerberus",
      isPackaged: true,
      cwd: "/",
    });
    assert.equal(
      container,
      "/Volumes/SSD FN501 PRO/Emulations/Cerberus Launcher/dist/mac-arm64"
    );
  });

  it("falls back cleanly to cwd in unpacked dev runs", () => {
    const container = resolveAppBundleContainerDir({
      execPath:
        "/Users/dev/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      isPackaged: false,
      cwd: "/Users/dev/repo",
    });
    assert.equal(container, "/Users/dev/repo");

    const nonAppContainer = resolveAppBundleContainerDir({
      execPath: "/usr/local/bin/node",
      isPackaged: false,
      cwd: "/Users/dev/repo",
    });
    assert.equal(nonAppContainer, "/Users/dev/repo");
  });

  it("honors custom cerberusCacheRoot when provided", async () => {
    const customRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "cerb-custom-cache-")
    );
    try {
      const resolved = await CerberusPathsService.getCacheRoot({
        cerberusCacheRoot: customRoot,
      });
      assert.equal(resolved, path.resolve(customRoot));

      const crossOverCache =
        await CerberusPathsService.getCrossOverToolsCacheDir({
          cerberusCacheRoot: customRoot,
        });
      assert.equal(
        crossOverCache,
        path.join(path.resolve(customRoot), "CrossOverTools")
      );
      assert.equal(fs.existsSync(crossOverCache), true);
    } finally {
      fs.rmSync(customRoot, { recursive: true, force: true });
    }
  });

  it("uses Cerberus_Cache folder name next to app bundle by default", () => {
    const ideal = CerberusPathsService.getIdealAppAdjacentCacheRoot();
    assert.equal(path.basename(ideal), CERBERUS_CACHE_FOLDER_NAME);
  });
});
