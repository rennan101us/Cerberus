import crypto from "node:crypto";
import type { AppLogEntry, AppLogLevel, AppLogSource } from "@types";
import { WindowManager } from "./window-manager";
import { logger } from "./logger";

const MAX_LOG_ENTRIES = 5000;

class AppLogHubService {
  private entries: AppLogEntry[] = [];

  public append(
    level: AppLogLevel,
    source: AppLogSource,
    message: string
  ): AppLogEntry {
    const trimmed = message.replace(/\r+$/, "");
    const entry: AppLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      source,
      message: trimmed,
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_LOG_ENTRIES);
    }

    if (level === "error") {
      logger.error(`[${source}] ${trimmed}`);
    } else if (level === "warning") {
      logger.warn(`[${source}] ${trimmed}`);
    } else {
      logger.info(`[${source}] ${trimmed}`);
    }

    try {
      WindowManager.sendToAppWindows("on-nx-log", entry);
    } catch {
      // Window may not be initialized yet
    }

    return entry;
  }

  public info(source: AppLogSource, message: string): AppLogEntry {
    return this.append("info", source, message);
  }

  public step(source: AppLogSource, message: string): AppLogEntry {
    return this.append("step", source, message);
  }

  public success(source: AppLogSource, message: string): AppLogEntry {
    return this.append("success", source, message);
  }

  public warn(source: AppLogSource, message: string): AppLogEntry {
    return this.append("warning", source, message);
  }

  public error(source: AppLogSource, message: string): AppLogEntry {
    return this.append("error", source, message);
  }

  public getAll(): AppLogEntry[] {
    return [...this.entries];
  }

  public clear(): void {
    this.entries = [];
  }
}

export const AppLogHub = new AppLogHubService();
