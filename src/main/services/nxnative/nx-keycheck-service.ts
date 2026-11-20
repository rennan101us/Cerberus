import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NxProdKeysInfo, UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { AppLogHub } from "@main/services/app-log-hub";
import { CerberusPathsService } from "@main/services/cerberus-paths";

const FIRMWARE_REVISIONS = [
  "1.0.0",
  "3.0.0",
  "3.0.1",
  "4.0.0",
  "5.0.0",
  "6.0.0",
  "6.2.0",
  "7.0.0",
  "8.1.0",
  "9.0.0",
  "9.1.0",
  "12.1.0",
  "13.0.0",
  "14.0.0",
  "15.0.0",
  "16.0.0",
  "17.0.0",
  "18.0.0",
  "19.0.0",
  "20.0.0",
  "21.0.0",
];

export class NxKeyCheckService {
  public static parseProdKeys(text: string): Record<string, Buffer> {
    const keys: Record<string, Buffer> = {};
    for (const rawLine of text.split(/\r?\n/)) {
      const idx = rawLine.indexOf("=");
      if (idx < 0) continue;
      const name = rawLine.slice(0, idx).trim().toLowerCase();
      const valStr = rawLine
        .slice(idx + 1)
        .split(/[;#]/)[0]
        .trim();
      if (!name || !valStr || valStr.length % 2 !== 0) continue;
      if (!/^[0-9a-fA-F]+$/.test(valStr)) continue;
      keys[name] = Buffer.from(valStr, "hex");
    }
    return keys;
  }

  public static inspectKeysFile(filePath: string): {
    isValid: boolean;
    firmwareSummary?: string;
    highestMasterKey: number;
    error?: string;
  } {
    if (!fs.existsSync(filePath)) {
      return {
        isValid: false,
        highestMasterKey: -1,
        error: "Arquivo prod.keys não encontrado.",
      };
    }
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const keys = this.parseProdKeys(content);
      const headerKey =
        keys.header_key || keys.header_key_00 || keys.nca_header_key;
      if (!headerKey || headerKey.length !== 32) {
        return {
          isValid: false,
          highestMasterKey: -1,
          error: "header_key ausente ou inválida (esperados 32 bytes).",
        };
      }

      let highestMaster = -1;
      for (const k of Object.keys(keys)) {
        const m = /^master_key_([0-9a-f]{2})$/.exec(k);
        if (m) {
          const rev = Number.parseInt(m[1], 16);
          if (rev > highestMaster) highestMaster = rev;
        }
      }

      const fw =
        highestMaster >= 0 && highestMaster < FIRMWARE_REVISIONS.length
          ? `Firmware até ${FIRMWARE_REVISIONS[highestMaster]} (${Object.keys(keys).length} chaves)`
          : `${Object.keys(keys).length} chaves válidas`;

      return { isValid: true, firmwareSummary: fw, highestMasterKey: highestMaster };
    } catch (err) {
      return {
        isValid: false,
        highestMasterKey: -1,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public static async resolveProdKeys(): Promise<NxProdKeysInfo> {
    let savedPath: string | null = null;
    let cacheRoot: string | null = null;
    try {
      const prefs = (await db.get<string, UserPreferences>(
        levelKeys.userPreferences,
        { valueEncoding: "json" }
      )) as UserPreferences;
      savedPath = prefs?.nxProdKeysPath?.trim() || null;
      cacheRoot = await CerberusPathsService.getCacheRoot(prefs);
    } catch {
      savedPath = null;
      cacheRoot = CerberusPathsService.getDefaultCacheRoot();
    }

    if (savedPath && fs.existsSync(savedPath)) {
      const savedCheck = this.inspectKeysFile(savedPath);
      if (savedCheck.isValid) {
        return {
          path: savedPath,
          sourceName: "Selecionado pelo usuário",
          isValid: true,
          firmwareSummary: savedCheck.firmwareSummary,
        };
      }
    }

    const home = os.homedir();
    const candidates: Array<{ path: string; sourceName: string }> = [
      ...(cacheRoot
        ? [
            {
              path: path.join(cacheRoot, "keys", "prod.keys"),
              sourceName: "Cerberus Cache (keys)",
            },
            {
              path: path.join(cacheRoot, "prod.keys"),
              sourceName: "Cerberus Cache",
            },
          ]
        : []),
      {
        path: path.join(
          home,
          "Library",
          "Application Support",
          "Ryujinx",
          "system",
          "prod.keys"
        ),
        sourceName: "Ryujinx (App Support)",
      },
      {
        path: path.join(
          home,
          "Library",
          "Application Support",
          "Ryubing",
          "system",
          "prod.keys"
        ),
        sourceName: "Ryubing (App Support)",
      },
      {
        path: path.join(home, ".config", "Ryujinx", "system", "prod.keys"),
        sourceName: "Ryujinx Config",
      },
      {
        path: path.join(home, ".switch", "prod.keys"),
        sourceName: "Switch Homebrew (~/.switch)",
      },
      {
        path: "/Volumes/SSD FN501 PRO/Emulations/Riujinx/system/prod.keys",
        sourceName: "Pasta Emulations/Riujinx",
      },
    ];

    let bestMatch: {
      path: string;
      sourceName: string;
      firmwareSummary?: string;
      highestMasterKey: number;
    } | null = null;

    for (const c of candidates) {
      if (!fs.existsSync(c.path)) continue;
      const check = this.inspectKeysFile(c.path);
      if (!check.isValid) continue;
      if (!bestMatch || check.highestMasterKey > bestMatch.highestMasterKey) {
        bestMatch = {
          path: c.path,
          sourceName: c.sourceName,
          firmwareSummary: check.firmwareSummary,
          highestMasterKey: check.highestMasterKey,
        };
      }
    }

    if (bestMatch) {
      return {
        path: bestMatch.path,
        sourceName: bestMatch.sourceName,
        isValid: true,
        firmwareSummary: bestMatch.firmwareSummary,
      };
    }

    return {
      path: savedPath,
      sourceName: null,
      isValid: false,
      error:
        "prod.keys não encontrado. Necessário para jogos Switch 1 (.nsp/.xci).",
    };
  }

  public static async setProdKeysPath(
    filePath: string
  ): Promise<NxProdKeysInfo> {
    const check = this.inspectKeysFile(filePath);
    if (!check.isValid) {
      return {
        path: filePath,
        sourceName: "Selecionado pelo usuário",
        isValid: false,
        error: check.error,
      };
    }

    let prefs: UserPreferences = {};
    try {
      prefs = (await db.get<string, UserPreferences>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      )) as UserPreferences;
    } catch {
      prefs = {};
    }
    await db.put(
      levelKeys.userPreferences,
      { ...prefs, nxProdKeysPath: filePath },
      { valueEncoding: "json" }
    );

    AppLogHub.success(
      "nxnative",
      `prod.keys configurado: ${filePath} (${check.firmwareSummary})`
    );
    return {
      path: filePath,
      sourceName: "Selecionado pelo usuário",
      isValid: true,
      firmwareSummary: check.firmwareSummary,
    };
  }
}
