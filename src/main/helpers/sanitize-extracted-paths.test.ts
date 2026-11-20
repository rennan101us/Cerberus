import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  needsPathSanitization,
  sanitizeExtractedDirectoryTree,
  sanitizePathSegment,
} from "./sanitize-extracted-paths.js";

test("sanitizePathSegment removes brackets, diacritics, and special symbols", () => {
  assert.equal(
    sanitizePathSegment("Metaphor ReFantazio [DODI Repack]"),
    "Metaphor ReFantazio DODI Repack"
  );
  assert.equal(
    sanitizePathSegment("Pokémon™: Legends Z-A! (v1.2) [FitGirl]"),
    "Pokemon Legends Z-A v1.2 FitGirl"
  );
  assert.equal(
    sanitizePathSegment("Senua’s Saga – Hellblade II [ElAmigos]"),
    "Senuas Saga - Hellblade II ElAmigos"
  );
  assert.equal(sanitizePathSegment("CON"), "CON_Dir");
  assert.equal(sanitizePathSegment("!!![]"), "Game");
  assert.equal(needsPathSanitization("Clean Folder Name"), false);
  assert.equal(needsPathSanitization("Game [DODI]"), true);
});

test("sanitizeExtractedDirectoryTree cleans repack folders while preserving .doi/.bin and .app bundles", async () => {
  const tmpBase = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "cerberus-sanitize-")
  );

  try {
    const dirtyRoot = path.join(tmpBase, "Metaphor ReFantazio [DODI Repack]");
    const nestedWrapper = path.join(dirtyRoot, "Repack (v1.0) [Pt-Br]");
    const protectedApp = path.join(dirtyRoot, "My Game [Native].app");
    const protectedData = path.join(nestedWrapper, "Data");

    await fs.promises.mkdir(protectedData, { recursive: true });
    await fs.promises.mkdir(protectedApp, { recursive: true });
    await fs.promises.writeFile(
      path.join(nestedWrapper, "data1.doi"),
      "stub"
    );
    await fs.promises.writeFile(
      path.join(nestedWrapper, "Setup.exe"),
      "stub"
    );

    const result = await sanitizeExtractedDirectoryTree(dirtyRoot, {
      sanitizeRootName: true,
    });

    const expectedRoot = path.join(tmpBase, "Metaphor ReFantazio DODI Repack");
    const expectedWrapper = path.join(expectedRoot, "Repack v1.0 Pt-Br");

    assert.equal(result.finalRootDir, expectedRoot);
    assert.equal(result.renamedCount, 2);
    assert.ok(fs.existsSync(expectedRoot));
    assert.ok(fs.existsSync(expectedWrapper));
    assert.ok(fs.existsSync(path.join(expectedWrapper, "data1.doi")));
    assert.ok(fs.existsSync(path.join(expectedWrapper, "Setup.exe")));
    assert.ok(fs.existsSync(path.join(expectedWrapper, "Data")));
    // .app bundle must not be renamed
    assert.ok(fs.existsSync(path.join(expectedRoot, "My Game [Native].app")));
  } finally {
    await fs.promises.rm(tmpBase, { recursive: true, force: true });
  }
});
