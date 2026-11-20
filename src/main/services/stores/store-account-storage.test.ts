import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadStorageClass(t: TestContext) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "store-acct-test-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const bundlePath = path.join(root, "store-account-storage.mjs");
  await build({
    entryPoints: ["src/main/services/stores/store-account-storage.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: bundlePath,
    plugins: [
      {
        name: "stub-electron",
        setup(b) {
          b.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "stub",
          }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: `export const app = { getPath: () => ${JSON.stringify(root)} }; export const safeStorage = { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (buf) => buf.toString() };`,
            loader: "js",
          }));
        },
      },
    ],
  });

  const mod = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);
  return { root, StoreAccountStorage: mod.StoreAccountStorage };
}

test("StoreAccountStorage persists and reloads Steam & Epic accounts with encryption", async (t) => {
  const { root, StoreAccountStorage } = await loadStorageClass(t);
  const filePath = path.join(root, "accounts.json");

  const mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) =>
      Buffer.from(`ENC:${Buffer.from(plain, "utf8").toString("base64")}`),
    decryptString: (buf: Buffer) => {
      const str = buf.toString("utf8");
      assert.ok(str.startsWith("ENC:"));
      return Buffer.from(str.slice(4), "base64").toString("utf8");
    },
  };

  const storage = new StoreAccountStorage(filePath, mockSafeStorage);
  assert.deepEqual(storage.load(), {});

  storage.setSteam({
    steamId64: "76561198000000001",
    accountName: "player1",
    displayName: "Player One",
    avatarUrl: "https://example.com/a.jpg",
    refreshToken: "tok_steam_123",
    lastSyncAt: "2026-11-20T00:00:00.000Z",
    syncedGamesCount: 42,
  });

  storage.setEpic({
    accountId: "abc123epic",
    displayName: "EpicPlayer",
    lastSyncAt: "2026-11-20T01:00:00.000Z",
    syncedGamesCount: 15,
  });

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(raw.encrypted, true);
  assert.ok(!raw.payload.includes("tok_steam_123"));

  const reloaded = new StoreAccountStorage(filePath, mockSafeStorage);
  assert.equal(reloaded.getSteam()?.displayName, "Player One");
  assert.equal(reloaded.getSteam()?.refreshToken, "tok_steam_123");
  assert.equal(reloaded.getEpic()?.accountId, "abc123epic");

  reloaded.setSteam(null);
  assert.equal(reloaded.getSteam(), null);
  assert.equal(reloaded.getEpic()?.displayName, "EpicPlayer");
});

test("StoreAccountStorage falls back cleanly when encryption is unavailable", async (t) => {
  const { root, StoreAccountStorage } = await loadStorageClass(t);
  const filePath = path.join(root, "plain-accounts.json");

  const noCrypto = {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  };

  const storage = new StoreAccountStorage(filePath, noCrypto);
  storage.setEpic({
    accountId: "epic999",
    displayName: "PlainUser",
    lastSyncAt: null,
    syncedGamesCount: 3,
  });

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(raw.encrypted, false);
  assert.equal(storage.getEpic()?.displayName, "PlainUser");
});
