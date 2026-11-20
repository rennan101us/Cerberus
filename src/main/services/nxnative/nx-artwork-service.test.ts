import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadArtworkService(
  t: TestContext,
  appSupportDir: string
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nx-art-test-"));
  const key = "__nxArtTest" + randomUUID();
  const globals = globalThis as unknown as Record<string, unknown>;
  globals[key] = { appSupportDir };

  t.after(async () => {
    delete globals[key];
    await fs.rm(root, { recursive: true, force: true });
  });

  const stubs: Record<string, string> = {
    "@main/services/window-manager": "export const WindowManager = { sendToAppWindows() {} };",
    "@main/services/app-log-hub": "export const AppLogHub = { info() {}, warn() {}, step() {}, error() {}, success() {} };",
    "@main/services/igdb-service": "export const IgdbService = { fetchGameDetailsByTitle: async () => null };",
    "./nx-paths": `export const NxPathsService = {
      getAppSupportDirectory: async () => harness.appSupportDir,
      getArtworkSearchDirectories: async () => [harness.appSupportDir],
      resolveNxnativePath: async () => ({ path: harness.appSupportDir, isValid: false }),
    };`,
  };

  const bundlePath = path.join(root, "nx-artwork.mjs");
  await build({
    entryPoints: [
      fileURLToPath(new URL("./nx-artwork-service.ts", import.meta.url)),
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
            contents:
              "const harness = globalThis[" +
              JSON.stringify(key) +
              "]; " +
              stubs[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });

  const mod = (await import(pathToFileURL(bundlePath).href)) as typeof import("./nx-artwork-service");
  return mod.NxArtworkService;
}

test("toLocalUrl escapes #, ? and spaces for Electron local: protocol", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nx-art-support-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const NxArtworkService = await loadArtworkService(t, dir);

  const uri = NxArtworkService.toLocalUrl("/Volumes/SSD FN501 PRO/covers/0400#1?v=2.jpg");
  assert.equal(
    uri,
    "local:/Volumes/SSD%20FN501%20PRO/covers/0400%231%3Fv=2.jpg"
  );
});

test("resolveCoversForBatch resolves Switch 2 covers from disk and online_artwork_cache", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nx-art-batch-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await fs.mkdir(path.join(dir, "covers"), { recursive: true });
  await fs.mkdir(path.join(dir, "artwork"), { recursive: true });

  // Disk cover >= 512 bytes (MIN_VALID_IMAGE_BYTES)
  const diskFile = path.join(dir, "covers", "040074A01BF12000.jpg");
  await fs.writeFile(diskFile, Buffer.alloc(1024, 0xff));

  await fs.writeFile(
    path.join(dir, "artwork", "online_artwork_cache.json"),
    JSON.stringify({
      "0400C76024710000": {
        coverUrl: "https://www.nintendo.com/eu/media/images/pragmata.jpg",
      },
    }),
    "utf8"
  );

  const NxArtworkService = await loadArtworkService(t, dir);
  const res = await NxArtworkService.resolveCoversForBatch([
    { titleId: "040074a01bf12000", title: "Donkey Kong Bananza" },
    { titleId: "0400c76024710000", title: "PRAGMATA" },
    { titleId: "0400000000000000", title: "Unknown Game" },
  ]);

  assert.equal(res.get("040074A01BF12000"), NxArtworkService.toLocalUrl(diskFile));
  assert.equal(
    res.get("0400C76024710000"),
    "https://www.nintendo.com/eu/media/images/pragmata.jpg"
  );
  assert.equal(res.get("0400000000000000"), null);
});
