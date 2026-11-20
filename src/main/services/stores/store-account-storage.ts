import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface StoredSteamAccount {
  steamId64: string;
  accountName: string;
  displayName: string;
  avatarUrl: string | null;
  refreshToken: string;
  lastSyncAt: string | null;
  syncedGamesCount: number;
}

export interface StoredEpicAccount {
  accountId: string;
  displayName: string;
  lastSyncAt: string | null;
  syncedGamesCount: number;
}

export interface StoredGogAccount {
  userId: string;
  username: string;
  email?: string;
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  lastSyncAt: string | null;
  syncedGamesCount: number;
}

export interface StoredAccountsData {
  steam?: StoredSteamAccount;
  epic?: StoredEpicAccount;
  gog?: StoredGogAccount;
}

interface SerializedAccountsEnvelope {
  encrypted: boolean;
  payload: string;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const getDefaultSafeStorage = (): SafeStorageLike | null => {
  try {
    return safeStorage ?? null;
  } catch {
    return null;
  }
};

export const getDefaultStoreAccountsFilePath = () =>
  path.join(app.getPath("userData"), "stores", "accounts.json");

export class StoreAccountStorage {
  private readonly filePath: string;
  private readonly cryptoBackend: SafeStorageLike | null;

  constructor(
    filePath: string = getDefaultStoreAccountsFilePath(),
    cryptoBackend: SafeStorageLike | null = getDefaultSafeStorage()
  ) {
    this.filePath = filePath;
    this.cryptoBackend = cryptoBackend;
  }

  public load(): StoredAccountsData {
    try {
      if (!fs.existsSync(this.filePath)) return {};
      const raw = fs.readFileSync(this.filePath, "utf8");
      if (!raw.trim()) return {};

      const parsed = JSON.parse(raw) as
        | SerializedAccountsEnvelope
        | StoredAccountsData;

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "payload" in parsed &&
        typeof parsed.payload === "string"
      ) {
        if (parsed.encrypted) {
          if (!this.cryptoBackend?.isEncryptionAvailable()) {
            return {};
          }
          const decrypted = this.cryptoBackend.decryptString(
            Buffer.from(parsed.payload, "base64")
          );
          return JSON.parse(decrypted) as StoredAccountsData;
        }
        return JSON.parse(parsed.payload) as StoredAccountsData;
      }

      return parsed as StoredAccountsData;
    } catch {
      return {};
    }
  }

  public save(data: StoredAccountsData): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(data);

    let envelope: SerializedAccountsEnvelope;
    if (this.cryptoBackend?.isEncryptionAvailable()) {
      envelope = {
        encrypted: true,
        payload: this.cryptoBackend
          .encryptString(serialized)
          .toString("base64"),
      };
    } else {
      envelope = {
        encrypted: false,
        payload: serialized,
      };
    }

    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(envelope, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tempPath, this.filePath);
  }

  public getSteam(): StoredSteamAccount | null {
    return this.load().steam ?? null;
  }

  public setSteam(account: StoredSteamAccount | null): void {
    const current = this.load();
    if (account) {
      current.steam = account;
    } else {
      delete current.steam;
    }
    this.save(current);
  }

  public getEpic(): StoredEpicAccount | null {
    return this.load().epic ?? null;
  }

  public setEpic(account: StoredEpicAccount | null): void {
    const current = this.load();
    if (account) {
      current.epic = account;
    } else {
      delete current.epic;
    }
    this.save(current);
  }

  public getGog(): StoredGogAccount | null {
    return this.load().gog ?? null;
  }

  public setGog(account: StoredGogAccount | null): void {
    const current = this.load();
    if (account) {
      current.gog = account;
    } else {
      delete current.gog;
    }
    this.save(current);
  }
}
