import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkAndroidProfileSupport,
  formatPortErrorHint,
  getCurrentShaderChain,
  isInvalidPortSourcePath,
  prepareStagingWorkspace,
  sanitizeOutputAppName,
  validateFramework,
} from "./nx-build-helpers.js";

describe("nx-build-helpers", () => {
  it("sanitizes game titles with colons, brackets, and unsafe chars", () => {
    assert.equal(
      sanitizeOutputAppName("Castlevania: Belmont's Curse [0100ABCD12340000]"),
      "Castlevania - Belmont's Curse"
    );
    assert.equal(
      sanitizeOutputAppName("The Legend of Zelda: Tears/Kingdom?"),
      "The Legend of Zelda - Tears - Kingdom"
    );
  });

  it("rejects already-ported .app, .framework, .apk, and .ipa sources when appropriate", () => {
    assert.equal(isInvalidPortSourcePath("/Volumes/Ports/Game.app"), true);
    assert.equal(isInvalidPortSourcePath("/Volumes/Hub/DmGame123.framework"), true);
    assert.equal(isInvalidPortSourcePath("/Volumes/Ports/Game.apk"), true);
    assert.equal(isInvalidPortSourcePath("/Volumes/Ports/Game.ipa"), true);
    assert.equal(
      isInvalidPortSourcePath("/Volumes/Ports/Game.ipa", { allowIpa: true }),
      false
    );
    assert.equal(isInvalidPortSourcePath("/Volumes/ROMs/Game [01001234].nsp"), false);
  });

  it("isolates a single game + update in per-game staging input via symlinks without unrelated games", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nx-staging-test-"));
    try {
      const romsDir = path.join(tmp, "SharedRoms");
      const stagingDir = path.join(tmp, "Cerberus_Cache", "Staging");
      fs.mkdirSync(romsDir, { recursive: true });

      const gameBase = path.join(romsDir, "GameA [0100111122220000][v0].nsp");
      const gameUpd = path.join(romsDir, "GameA Update [0100111122220800][v65536].nsp");
      const otherGame = path.join(romsDir, "OtherGame [0100999988880000][v0].nsp");
      fs.writeFileSync(gameBase, "base");
      fs.writeFileSync(gameUpd, "upd");
      fs.writeFileSync(otherGame, "other");

      const ws = prepareStagingWorkspace({
        stagingDir,
        gameTitle: "Game A: Remastered",
        titleId: "0100111122220000",
        sourcePath: gameBase,
      });

      assert.equal(ws.linkedFiles.length, 2);
      const entries = fs.readdirSync(ws.inputDir);
      assert.equal(entries.includes(path.basename(gameBase)), true);
      assert.equal(entries.includes(path.basename(gameUpd)), true);
      assert.equal(entries.includes(path.basename(otherGame)), false);
      assert.equal(
        ws.workDir,
        path.join(stagingDir, "Game A - Remastered", "0100111122220000_build")
      );

      ws.cleanup();
      assert.equal(fs.readdirSync(ws.inputDir).length, 0);
      // Source files untouched
      assert.equal(fs.existsSync(gameBase), true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("parses DMSH_CHAIN and rejects frameworks with mismatched shader chain", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nx-chain-test-"));
    try {
      const dmDir = path.join(tmp, "nxnative", "dm", "gfx", "nvn");
      fs.mkdirSync(dmDir, { recursive: true });
      fs.writeFileSync(
        path.join(dmDir, "dmsh_chain.h"),
        '#pragma once\n#define DMSH_CHAIN "82cb7bb335cc"\n'
      );

      const expected = getCurrentShaderChain(path.join(tmp, "nxnative"));
      assert.equal(expected, "b-82cb7bb335cc");

      const staleFw = path.join(tmp, "DmGame0100111122220000.framework");
      fs.mkdirSync(staleFw, { recursive: true });
      fs.writeFileSync(path.join(staleFw, "DmGame0100111122220000"), "bin");
      fs.writeFileSync(path.join(staleFw, "Info.plist"), "<plist/>");
      fs.writeFileSync(
        path.join(staleFw, "game.manifest.json"),
        JSON.stringify({ chain: "b-bc8830d4ba5a" })
      );

      const staleResult = validateFramework(staleFw, expected);
      assert.equal(staleResult.valid, false);
      assert.match(staleResult.reason || "", /Shader chain mismatch/);

      fs.writeFileSync(
        path.join(staleFw, "game.manifest.json"),
        JSON.stringify({ chain: "b-82cb7bb335cc" })
      );
      const validResult = validateFramework(staleFw, expected);
      assert.equal(validResult.valid, true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("checks android.tsv support and formats prod.keys missing master key errors", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nx-android-tsv-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "android.tsv"),
        "01007EF00011E000\tZelda BotW\nok\n"
      );
      assert.equal(
        checkAndroidProfileSupport(tmp, "01007EF00011E000").supported,
        true
      );
      assert.equal(
        checkAndroidProfileSupport(tmp, "0100FFFFFFFF0000").supported,
        false
      );

      const hint = formatPortErrorHint(
        "KeyError: 'key_area_key_application_15'"
      );
      assert.ok(hint);
      assert.match(hint!, /master_key_15/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
