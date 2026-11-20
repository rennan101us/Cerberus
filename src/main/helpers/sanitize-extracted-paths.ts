import fs from "node:fs";
import path from "node:path";

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const PROTECTED_GAME_SUBDIRS = new Set([
  "engine",
  "content",
  "binaries",
  "data",
  "gamedata",
  "assets",
  "_commonredist",
  "redist",
  "directx",
  "support",
  "saves",
  "movies",
  "audio",
  "sound",
  "localization",
  "plugins",
  "streamingassets",
  "resources",
  "shadercache",
  "system",
  "config",
  "mods",
  "dlc",
  "patches",
  "update",
  "updates",
  "contents",
]);

const PROTECTED_BUNDLE_EXTS = new Set([
  ".app",
  ".framework",
  ".bundle",
  ".kext",
  ".pkg",
  ".xcframework",
]);

/**
 * Sanitizes a folder or archive name segment so Wine / CrossOver / Inno Setup /
 * ISDone.dll / Unarc.dll never choke on brackets, special symbols, or diacritics.
 */
export function sanitizePathSegment(rawName: string): string {
  const normalized = rawName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/[’‘´`'"]/g, "")
    .replace(/[™®©°§†‡•·]/g, "")
    // Replace brackets, parentheses, braces, and Wine/ISDone-unfriendly symbols with spaces
    .replace(/[\[\](){}!¡?¿#$%^&*+=~;,@|<>:\\/]/g, " ")
    // Strip any remaining non-ASCII or control characters
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/^[\s._-]+|[\s._-]+$/g, "")
    .trim();

  const candidate = normalized || "Game";
  if (WINDOWS_RESERVED_NAMES.has(candidate.toUpperCase())) {
    return `${candidate}_Dir`;
  }

  return candidate;
}

export function needsPathSanitization(name: string): boolean {
  return sanitizePathSegment(name) !== name;
}

async function renameDirectorySafely(
  currentPath: string,
  desiredName: string
): Promise<string | null> {
  const parentDir = path.dirname(currentPath);
  const currentName = path.basename(currentPath);
  if (currentName === desiredName) return null;

  let targetPath = path.join(parentDir, desiredName);

  // Handle case-only differences on case-insensitive APFS/HFS+ cleanly
  const isCaseOnlyRename =
    currentName.toLowerCase() === desiredName.toLowerCase();

  if (!isCaseOnlyRename && fs.existsSync(targetPath)) {
    let suffix = 2;
    while (fs.existsSync(path.join(parentDir, `${desiredName} ${suffix}`))) {
      suffix++;
    }
    targetPath = path.join(parentDir, `${desiredName} ${suffix}`);
  }

  try {
    if (isCaseOnlyRename) {
      const tempPath = path.join(
        parentDir,
        `.__cerberus_rename_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      );
      await fs.promises.rename(currentPath, tempPath);
      await fs.promises.rename(tempPath, targetPath);
    } else {
      await fs.promises.rename(currentPath, targetPath);
    }
    return targetPath;
  } catch {
    return null;
  }
}

export interface SanitizeExtractedResult {
  finalRootDir: string;
  renamedCount: number;
  renamedPaths: Array<{ from: string; to: string }>;
}

/**
 * Automatically checks and sanitizes extracted game/repack folder names
 * (removing brackets like `[DODI Repack]`, diacritics, and special symbols)
 * while leaving internal game engine folders and data files (.doi, .bin, .pak, .app)
 * completely untouched.
 */
export async function sanitizeExtractedDirectoryTree(
  rootDir: string,
  options?: {
    sanitizeRootName?: boolean;
    maxWrapperDepth?: number;
  }
): Promise<SanitizeExtractedResult> {
  const sanitizeRootName = options?.sanitizeRootName ?? true;
  const maxWrapperDepth = options?.maxWrapperDepth ?? 2;
  const renamedPaths: Array<{ from: string; to: string }> = [];

  if (!rootDir || !fs.existsSync(rootDir)) {
    return { finalRootDir: rootDir, renamedCount: 0, renamedPaths };
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(rootDir);
  } catch {
    return { finalRootDir: rootDir, renamedCount: 0, renamedPaths };
  }

  if (!stat.isDirectory()) {
    return { finalRootDir: rootDir, renamedCount: 0, renamedPaths };
  }

  let currentRoot = rootDir;

  if (sanitizeRootName) {
    const baseName = path.basename(currentRoot);
    const ext = path.extname(baseName).toLowerCase();
    if (!PROTECTED_BUNDLE_EXTS.has(ext) && needsPathSanitization(baseName)) {
      const sanitized = sanitizePathSegment(baseName);
      const renamed = await renameDirectorySafely(currentRoot, sanitized);
      if (renamed) {
        renamedPaths.push({ from: currentRoot, to: renamed });
        currentRoot = renamed;
      }
    }
  }

  const walkWrapperDirs = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxWrapperDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const childDirs = entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith(".")
    );

    for (const entry of childDirs) {
      const lowerName = entry.name.toLowerCase();
      const ext = path.extname(lowerName);
      if (
        PROTECTED_GAME_SUBDIRS.has(lowerName) ||
        PROTECTED_BUNDLE_EXTS.has(ext)
      ) {
        continue;
      }

      let childPath = path.join(dir, entry.name);
      if (needsPathSanitization(entry.name)) {
        const sanitized = sanitizePathSegment(entry.name);
        const renamed = await renameDirectorySafely(childPath, sanitized);
        if (renamed) {
          renamedPaths.push({ from: childPath, to: renamed });
          childPath = renamed;
        }
      }

      // Only recurse deeper into wrapper directories (e.g. archive containing a single repack subfolder)
      if (childDirs.length <= 2) {
        await walkWrapperDirs(childPath, depth + 1);
      }
    }
  };

  await walkWrapperDirs(currentRoot, 1);

  return {
    finalRootDir: currentRoot,
    renamedCount: renamedPaths.length,
    renamedPaths,
  };
}
