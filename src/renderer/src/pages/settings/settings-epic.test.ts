import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type { StoreAccountsState } from "@types";

const requireModule = createRequire(import.meta.url);

it("SettingsEpic loads connected account, syncs library, and disconnects cleanly", async (t) => {
  const dom = new JSDOM("<div id='root'></div>");
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }

  let currentAccounts: StoreAccountsState = {
    steam: { provider: "steam", connected: false },
    gog: { provider: "gog", connected: false },
    epic: {
      provider: "epic",
      connected: true,
      accountId: "epic-user-123",
      displayName: "EpicPlayer",
      lastSyncAt: "2026-11-20T00:00:00.000Z",
      syncedGamesCount: 12,
    },
  };

  let syncCalls = 0;
  let disconnectCalls = 0;
  let accountsListener: () => void = () => {};

  const bridge = {
    storesGetAccounts: async () => currentAccounts,
    storesStartEpicLogin: async () => ({ ok: true }),
    storesSyncEpicLibrary: async () => {
      syncCalls++;
      return { syncedGamesCount: 15 };
    },
    storesDisconnectEpic: async () => {
      disconnectCalls++;
      currentAccounts = {
        ...currentAccounts,
        epic: { provider: "epic", connected: false },
      };
    },
    onStoreAccountsUpdated: (cb: () => void) => {
      accountsListener = cb;
      return () => {};
    },
  };
  Object.assign(dom.window, { electron: bridge });

  const icon = () => null;
  const noop = () => {};
  const stubs: Record<string, unknown> = {
    "react-i18next": { useTranslation: () => ({ t: (k: string) => k }) },
    "@primer/octicons-react": {
      LinkExternalIcon: icon,
      PersonIcon: icon,
      SyncIcon: icon,
    },
    "@renderer/assets/epic-integration-logo.svg?react": icon,
    "@renderer/hooks": {
      useToast: () => ({ showSuccessToast: noop, showErrorToast: noop }),
    },
    "@renderer/components": {
      Button: ({
        theme: _theme,
        ...props
      }: React.ButtonHTMLAttributes<HTMLButtonElement> & { theme: string }) =>
        React.createElement("button", props),
    },
    "./settings-integration-card": {
      SettingsIntegrationCard: ({
        children,
        actions,
        status,
      }: {
        children: React.ReactNode;
        actions: React.ReactNode;
        status: string;
      }) =>
        React.createElement(
          "section",
          null,
          React.createElement("span", { "data-status": true }, status),
          actions,
          children
        ),
      SettingsIntegrationLastSynced: icon,
    },
  };

  const filename = "src/renderer/src/pages/settings/settings-epic.tsx";
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });

  const exports: Record<string, React.ElementType> = {};
  new Function("exports", "require", outputText)(
    exports,
    (name: string) => stubs[name] ?? requireModule(name)
  );

  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  const button = (text: string) =>
    [...dom.window.document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes(text)
    );

  await React.act(async () => {
    root.render(React.createElement(exports.SettingsEpic));
  });

  assert.equal(
    dom.window.document.querySelector("[data-status]")?.textContent,
    "connected"
  );
  assert.ok(dom.window.document.body.textContent?.includes("EpicPlayer"));

  await React.act(async () => {
    button("Sincronizar")!.click();
  });
  assert.equal(syncCalls, 1);

  await React.act(async () => {
    button("Desconectar")!.click();
  });
  assert.equal(disconnectCalls, 1);
  assert.equal(
    dom.window.document.querySelector("[data-status]")?.textContent,
    "disconnected"
  );

  currentAccounts = {
    ...currentAccounts,
    epic: {
      provider: "epic",
      connected: true,
      accountId: "epic-reconnected",
      displayName: "BackOnline",
    },
  };
  await React.act(async () => {
    accountsListener();
  });
  assert.ok(dom.window.document.body.textContent?.includes("BackOnline"));
});
