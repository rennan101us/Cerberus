import { BrowserWindow, session } from "electron";
import { randomUUID } from "node:crypto";
import { logger } from "@main/services/logger";

export interface GogAuthWindowCallbacks {
  onCode: (code: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => Promise<void>;
  onError: (error: string) => Promise<void>;
}

export function openGogAuthWindow(callbacks: GogAuthWindowCallbacks) {
  const isolatedSession = session.fromPartition(`gog-auth-${randomUUID()}`);
  let completed = false;

  const authWindow = new BrowserWindow({
    width: 820,
    height: 720,
    title: "GOG Galaxy - Login",
    webPreferences: {
      session: isolatedSession,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  const checkUrl = (rawUrl: string): boolean => {
    try {
      const parsed = new URL(rawUrl);
      if (
        parsed.hostname === "embed.gog.com" &&
        parsed.pathname.includes("on_login_success")
      ) {
        const code = parsed.searchParams.get("code");
        if (code && !completed) {
          completed = true;
          authWindow.hide();
          void callbacks.onCode(code).finally(() => {
            if (!authWindow.isDestroyed()) authWindow.close();
          });
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  };

  authWindow.webContents.on("will-navigate", (event, url) => {
    if (checkUrl(url)) {
      event.preventDefault();
    }
  });

  authWindow.webContents.on("will-redirect", (event, url) => {
    if (checkUrl(url)) {
      event.preventDefault();
    }
  });

  authWindow.on("closed", () => {
    if (!completed) {
      completed = true;
      void callbacks.onCancel().catch(() => undefined);
    }
  });

  const loginUrl =
    "https://auth.gog.com/auth?client_id=46899977096215655&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=client2";

  authWindow.loadURL(loginUrl).catch((err) => {
    logger.error("[GOG] Failed to load login URL", err);
    if (!completed) {
      completed = true;
      void callbacks.onError("failed-to-load").finally(() => {
        if (!authWindow.isDestroyed()) authWindow.close();
      });
    }
  });

  return {
    close: () => {
      if (!authWindow.isDestroyed()) authWindow.close();
    },
  };
}
