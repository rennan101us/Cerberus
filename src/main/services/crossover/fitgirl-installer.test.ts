import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildInstallerEnvOverrides,
  buildInstallerWineArgs,
  cleanupStaleInnoTempDirs,
  detectRepackInstaller,
  prepareShortInstallerLink,
  removeShortInstallerLink,
} from "./fitgirl-installer-helpers.js";

describe("FitGirl / repack safe installer mode helpers", () => {
  it("detects FitGirl installer by directory contents and path", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fg-detect-"));
    try {
      const setupPath = path.join(tmp, "setup.exe");
      fs.writeFileSync(setupPath, "mz");
      fs.writeFileSync(path.join(tmp, "fg-01.bin"), "bin");

      const detected = detectRepackInstaller(setupPath);
      assert.equal(detected.isRepack, true);
      assert.equal(detected.isFitGirl, true);

      const nonRepackDir = fs.mkdtempSync(path.join(os.tmpdir(), "normal-setup-"));
      const normalExe = path.join(nonRepackDir, "installer.exe");
      fs.writeFileSync(normalExe, "mz");
      const notRepack = detectRepackInstaller(normalExe);
      assert.equal(notRepack.isRepack, false);
      assert.equal(notRepack.isFitGirl, false);
      fs.rmSync(nonRepackDir, { recursive: true, force: true });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("builds safe env overrides disabling msync, d3dmetal, and rosetta avx for repacks", () => {
    const env = buildInstallerEnvOverrides(true);
    assert.equal(env.WINEMSYNC, "0");
    assert.equal(env.WINEESYNC, "0");
    assert.equal(env.WINED3DMETAL, "0");
    assert.equal(env.D3DM_MTL4, "0");
    assert.equal(env.ROSETTA_ADVERTISE_AVX, "0");
    assert.equal(env.WINE_CPU_TOPOLOGY, "4:0,1,2,3");
    assert.equal(env.NUMBER_OF_PROCESSORS, "4");
    assert.equal(env.OMP_NUM_THREADS, "4");

    const normal = buildInstallerEnvOverrides(false);
    assert.equal(normal.WINED3DMETAL, "0");
    assert.equal(normal.WINEMSYNC, undefined);
  });

  it("builds CrossOver CLI args with --winver win7, --dll, and single --env flag", () => {
    const envOverrides = buildInstallerEnvOverrides(true);
    const args = buildInstallerWineArgs({
      bottleName: "Head Bottle",
      windowsWorkingDir: String.raw`C:\_fg_inst`,
      windowsPath: String.raw`C:\_fg_inst\setup.exe`,
      ext: ".exe",
      isRepack: true,
      extraArgs: ["/VERYSILENT"],
      envOverrides,
    });

    const winverIdx = args.indexOf("--winver");
    assert.notEqual(winverIdx, -1);
    assert.equal(args[winverIdx + 1], "win7");

    const dllIdx = args.indexOf("--dll");
    assert.notEqual(dllIdx, -1);
    assert.equal(args[dllIdx + 1], "isdone,unarc=n,b");

    const envFlagCount = args.filter((item) => item === "--env").length;
    assert.equal(envFlagCount, 1);
    const envIdx = args.indexOf("--env");
    assert.match(args[envIdx + 1], /\bWINEMSYNC=0\b/);
    assert.match(args[envIdx + 1], /\bROSETTA_ADVERTISE_AVX=0\b/);

    const cxAppIdx = args.indexOf("--cx-app");
    assert.equal(args[cxAppIdx + 1], String.raw`C:\_fg_inst\setup.exe`);
    assert.equal(args.at(-1), "/VERYSILENT");
  });

  it("prepares and cleans short _fg_inst symlink and stale Inno temp dirs", () => {
    const tmpBottle = fs.mkdtempSync(path.join(os.tmpdir(), "fg-bottle-"));
    const tmpInstallerDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "fg-source-verylong-folder-")
    );
    try {
      const tempDir = path.join(
        tmpBottle,
        "drive_c",
        "users",
        "crossover",
        "Temp"
      );
      fs.mkdirSync(path.join(tempDir, "is-7UK4M.tmp"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "keep-me"), { recursive: true });

      const removed = cleanupStaleInnoTempDirs(tmpBottle);
      assert.equal(removed, 1);
      assert.equal(fs.existsSync(path.join(tempDir, "is-7UK4M.tmp")), false);
      assert.equal(fs.existsSync(path.join(tempDir, "keep-me")), true);

      const link = prepareShortInstallerLink(
        tmpBottle,
        tmpInstallerDir,
        "setup.exe"
      );
      assert.ok(link.linkPath);
      assert.equal(link.windowsWorkingDir, String.raw`C:\_fg_inst`);
      assert.equal(link.windowsPath, String.raw`C:\_fg_inst\setup.exe`);
      assert.equal(fs.lstatSync(link.linkPath!).isSymbolicLink(), true);

      removeShortInstallerLink(link.linkPath);
      assert.equal(fs.existsSync(link.linkPath!), false);
    } finally {
      fs.rmSync(tmpBottle, { recursive: true, force: true });
      fs.rmSync(tmpInstallerDir, { recursive: true, force: true });
    }
  });
});
