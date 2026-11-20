import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type InternalAxiosRequestConfig } from "axios";
import { build } from "esbuild";

type Request = {
  method?: string;
  url?: string;
  data: unknown;
  config: InternalAxiosRequestConfig;
};

async function fixture(t: TestContext, apiUrl = "https://api.example.test") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-api-ro-"));
  const key = "__hydraReadOnlyTest" + randomUUID();
  const globals = globalThis as unknown as Record<string, unknown>;
  const requests: Request[] = [];

  const harness = {
    adapter: async (config: InternalAxiosRequestConfig) => {
      const request: Request = {
        method: config.method,
        url: config.url,
        config,
        data:
          typeof config.data === "string"
            ? JSON.parse(config.data)
            : config.data,
      };
      requests.push(request);
      return {
        data: { ok: true, url: config.url },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    },
    logger: {
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };
  globals[key] = harness;
  t.after(async () => {
    delete globals[key];
    await fs.rm(root, { recursive: true, force: true });
  });

  const stubs: Record<string, string> = {
    axios:
      "import axios from 'real-axios'; export { AxiosError } from 'real-axios'; export default { create: options => axios.create({ ...options, adapter: harness.adapter }) };",
    "./logger": "export const networkLogger = harness.logger;",
    "@shared":
      "export class UserNotLoggedInError extends Error {} export class SubscriptionRequiredError extends Error {}",
    "@main/constants": "export const appVersion = '1.0.0';",
  };

  const bundlePath = path.join(root, "api.mjs");
  await build({
    stdin: {
      contents:
        "export { HydraApi, HydraApiWriteBlockedError } from './hydra-api';",
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      loader: "ts",
    },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    define: {
      "import.meta.env.MAIN_VITE_API_URL": JSON.stringify(apiUrl),
    },
    plugins: [
      {
        name: "environment",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === "real-axios") {
              return { path: import.meta.resolve("axios"), external: true };
            }
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

  const mod = (await import(pathToFileURL(bundlePath).href)) as typeof import("./hydra-api");
  await mod.HydraApi.setupApi();
  return { ...mod, requests };
}

test("HydraApi allows anonymous catalogue GET without Authorization header", async (t) => {
  const { HydraApi, requests } = await fixture(t);

  assert.equal(HydraApi.isLoggedIn(), false);
  assert.equal(HydraApi.hasActiveSubscription(), false);
  assert.equal(HydraApi.getAuthContext(), null);

  const data = await HydraApi.get("/catalogue/featured", { take: 10 }, { needsAuth: false });
  assert.deepEqual(data, { ok: true, url: "/catalogue/featured" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].config.headers.Authorization, undefined);
});

test("HydraApi blocks authenticated or subscription-gated requests locally", async (t) => {
  const { HydraApi, requests } = await fixture(t);

  await assert.rejects(HydraApi.get("/profile/me"));
  await assert.rejects(HydraApi.get("/profile/me", undefined, { needsAuth: true }));
  await assert.rejects(
    HydraApi.get("/catalogue/featured", undefined, {
      needsAuth: false,
      needsSubscription: true,
    })
  );
  assert.equal(requests.length, 0);
});

test("HydraApi blocks PUT, PATCH, DELETE and non-allowlisted POST", async (t) => {
  const { HydraApi, HydraApiWriteBlockedError, requests } = await fixture(t);

  await assert.rejects(
    HydraApi.put("/profile/games/steam/10/favorite", {}),
    HydraApiWriteBlockedError
  );
  await assert.rejects(HydraApi.patch("/profile", {}), HydraApiWriteBlockedError);
  await assert.rejects(HydraApi.delete("/profile/games/1"), HydraApiWriteBlockedError);
  await assert.rejects(
    HydraApi.post("/profile/games/batch", [], { needsAuth: false }),
    HydraApiWriteBlockedError
  );
  await assert.rejects(
    HydraApi.post("/games/steam/10/download", null, { needsAuth: false }),
    HydraApiWriteBlockedError
  );
  assert.equal(requests.length, 0);
});

test("HydraApi allows pure read-only allowlisted POST lookups", async (t) => {
  const { HydraApi, requests } = await fixture(t);

  await HydraApi.post("/catalogue/search", { take: 12, skip: 0 }, { needsAuth: false });
  await HydraApi.post("/games/shop-details", { shop: "steam", objectIds: ["10"] }, { needsAuth: false });
  await HydraApi.post("/hosters/availability", { urls: [] }, { needsAuth: false });
  assert.equal(requests.length, 3);
  assert.deepEqual(
    await HydraApi.checkDownloadSourcesChanges([], [], "2026-01-01"),
    []
  );
  assert.equal(requests.length, 3);
});
