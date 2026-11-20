import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SWITCH_ROM_EXTENSIONS = new Set([".nsp", ".nsz", ".xci", ".xcz", ".nup"]);

/** Sanitizes a game title into a valid, safe macOS/Android/iOS bundle filename (no colons or slashes). */
export function sanitizeOutputAppName(title: string): string {
  const withoutTags = title.replace(/\[[^\]]+\]/g, " ");
  const replacedColons = withoutTags.replace(/[:/\\]+/g, " - ");
  let noUnsafe = "";
  for (const ch of replacedColons) {
    const code = ch.charCodeAt(0);
    if (
      code < 0x20 ||
      ch === "*" ||
      ch === "?" ||
      ch === '"' ||
      ch === "<" ||
      ch === ">" ||
      ch === "|"
    ) {
      continue;
    }
    noUnsafe += ch;
  }
  const normalized = noUnsafe.replace(/\s+/g, " ").replace(/\.+$/g, "").trim();
  return normalized || "SwitchGame";
}

/** Rejects already-ported `.app`/`.framework`/`.apk` (or `.ipa` unless converting hub framework) bundles. */
export function isInvalidPortSourcePath(
  targetPath: string,
  options?: { allowIpa?: boolean }
): boolean {
  const lower = targetPath.trim().toLowerCase();
  if (!lower) return true;
  if (
    lower.endsWith(".app") ||
    lower.endsWith(".framework") ||
    lower.endsWith(".apk")
  ) {
    return true;
  }
  if (!options?.allowIpa && lower.endsWith(".ipa")) {
    return true;
  }
  return false;
}

export interface StagingWorkspaceResult {
  gameStagingDir: string;
  inputDir: string;
  workDir: string;
  tempDir: string;
  isDumpOrNup: boolean;
  linkedFiles: string[];
  cleanup: () => void;
}

function isSwitchRomFile(filePath: string): boolean {
  return SWITCH_ROM_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function resolveBaseTidPrefix(titleId?: string | null): string | null {
  if (!titleId) return null;
  const clean = titleId.trim().toUpperCase();
  if (!/^[0-9A-F]{16}$/.test(clean)) return null;
  // Switch base, update, and DLC IDs share the first 12-13 hex digits.
  return clean.slice(0, 12);
}

function extractFilenameTitleId(fileName: string): string | null {
  const m = /\[([0-9a-fA-F]{16})\]/.exec(fileName);
  return m ? m[1].toUpperCase() : null;
}

function linkFileIntoInputDir(
  sourceFile: string,
  inputDir: string
): string | null {
  const dest = path.join(inputDir, path.basename(sourceFile));
  try {
    if (fs.existsSync(dest) || fs.lstatSync(dest)) {
      fs.unlinkSync(dest);
    }
  } catch {
    // dest does not exist yet
  }
  try {
    fs.symlinkSync(path.resolve(sourceFile), dest);
    return dest;
  } catch {
    return null;
  }
}

/**
 * Prepares an isolated per-game staging workspace under `stagingDir/<sanitizedGame>` so
 * unrelated ROMs in a shared directory never pollute `build_ipa_from_nsp.py` or `porter port`.
 */
export function prepareStagingWorkspace(options: {
  stagingDir: string;
  gameTitle: string;
  titleId?: string | null;
  sourcePath: string;
  sourceFiles?: string[];
}): StagingWorkspaceResult {
  const safeName = sanitizeOutputAppName(options.gameTitle);
  const cleanTid = options.titleId?.trim().toUpperCase() || null;
  const gameStagingDir = path.join(path.resolve(options.stagingDir), safeName);
  const inputDir = path.join(gameStagingDir, "input");
  const workDir = path.join(gameStagingDir, `${cleanTid || "game"}_build`);
  const tempDir = path.join(path.resolve(options.stagingDir), ".tmp");

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  // Clean previous input symlinks so switching ROM versions never leaves stale symlinks behind
  for (const existing of fs.readdirSync(inputDir)) {
    const full = path.join(inputDir, existing);
    try {
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink() || st.isFile()) {
        fs.unlinkSync(full);
      }
    } catch {
      // ignore
    }
  }

  const resolvedSource = path.resolve(options.sourcePath);
  const isDir =
    fs.existsSync(resolvedSource) && fs.statSync(resolvedSource).isDirectory();
  const isDumpOrNup =
    resolvedSource.toLowerCase().endsWith(".nup") ||
    (isDir &&
      (fs.existsSync(path.join(resolvedSource, "base", "exefs", "main.npdm")) ||
        fs.existsSync(path.join(resolvedSource, "exefs", "main.npdm"))));

  const candidatesToLink: string[] = [];

  if (options.sourceFiles && options.sourceFiles.length > 0) {
    for (const f of options.sourceFiles) {
      if (fs.existsSync(f) && !fs.statSync(f).isDirectory()) {
        candidatesToLink.push(f);
      }
    }
  } else if (!isDir && fs.existsSync(resolvedSource)) {
    candidatesToLink.push(resolvedSource);
    const parentDir = path.dirname(resolvedSource);
    const tidPrefix =
      resolveBaseTidPrefix(cleanTid) ||
      resolveBaseTidPrefix(
        extractFilenameTitleId(path.basename(resolvedSource))
      );
    if (tidPrefix && fs.existsSync(parentDir)) {
      for (const entry of fs.readdirSync(parentDir)) {
        if (entry.startsWith("._")) continue;
        const full = path.join(parentDir, entry);
        if (path.resolve(full) === resolvedSource) continue;
        if (!isSwitchRomFile(full)) continue;
        const siblingTid = extractFilenameTitleId(entry);
        if (siblingTid && siblingTid.startsWith(tidPrefix)) {
          candidatesToLink.push(full);
        }
      }
    }
  } else if (isDir && !isDumpOrNup && fs.existsSync(resolvedSource)) {
    const tidPrefix = resolveBaseTidPrefix(cleanTid);
    const allRoms = fs
      .readdirSync(resolvedSource)
      .filter((e) => !e.startsWith("._"))
      .map((e) => path.join(resolvedSource, e))
      .filter((full) => {
        try {
          return !fs.statSync(full).isDirectory() && isSwitchRomFile(full);
        } catch {
          return false;
        }
      });

    if (tidPrefix) {
      const matching = allRoms.filter((full) => {
        const entryTid = extractFilenameTitleId(path.basename(full));
        return entryTid?.startsWith(tidPrefix);
      });
      candidatesToLink.push(...(matching.length > 0 ? matching : allRoms));
    } else {
      candidatesToLink.push(...allRoms);
    }
  }

  const linkedFiles: string[] = [];
  const seenResolved = new Set<string>();
  for (const file of candidatesToLink) {
    const abs = path.resolve(file);
    if (seenResolved.has(abs)) continue;
    seenResolved.add(abs);
    const linked = linkFileIntoInputDir(abs, inputDir);
    if (linked) linkedFiles.push(linked);
  }

  // If dump folder or no individual files were linked, fall back directly to sourcePath
  if (
    linkedFiles.length === 0 &&
    isDir &&
    !isDumpOrNup &&
    fs.existsSync(resolvedSource)
  ) {
    // Empty dir fallback
  }

  const cleanup = () => {
    for (const linked of linkedFiles) {
      try {
        if (fs.lstatSync(linked).isSymbolicLink()) {
          fs.unlinkSync(linked);
        }
      } catch {
        // ignore
      }
    }
  };

  return {
    gameStagingDir,
    inputDir: linkedFiles.length > 0 ? inputDir : resolvedSource,
    workDir,
    tempDir,
    isDumpOrNup,
    linkedFiles,
    cleanup,
  };
}

/** Parses `dm/gfx/nvn/dmsh_chain.h` for current `#define DMSH_CHAIN "<hash>"` -> `b-<hash>`. */
export function getCurrentShaderChain(nxnativeDir: string): string | null {
  const headerPath = path.join(nxnativeDir, "dm", "gfx", "nvn", "dmsh_chain.h");
  if (!fs.existsSync(headerPath)) return null;
  try {
    const content = fs.readFileSync(headerPath, "utf8");
    const m = /#define\s+DMSH_CHAIN\s+"([0-9a-fA-F]+)"/.exec(content);
    return m ? `b-${m[1].toLowerCase()}` : null;
  } catch {
    return null;
  }
}

/** Strips Finder/macOS AppleDouble (`._*`) junk and quarantine xattrs inside a .framework bundle. */
export function sanitizeFrameworkArtifacts(frameworkPath: string): void {
  if (!fs.existsSync(frameworkPath)) return;
  const walkAndRemoveAppleDouble = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith("._")) {
        fs.rmSync(full, { recursive: true, force: true });
        continue;
      }
      if (entry.isDirectory()) {
        walkAndRemoveAppleDouble(full);
      }
    }
  };
  walkAndRemoveAppleDouble(frameworkPath);

  if (process.platform === "darwin") {
    try {
      execFileSync("/usr/bin/xattr", ["-cr", frameworkPath], {
        timeout: 5000,
        stdio: "ignore",
      });
    } catch {
      // Best effort
    }
  }
}

export interface FrameworkValidationResult {
  valid: boolean;
  reason?: string;
  chain?: string;
}

/** Validates a cached iOS `DmGame<TID>.framework` including `DMSH_CHAIN` shader binary compatibility. */
export function validateFramework(
  frameworkPath: string,
  expectedChain: string | null
): FrameworkValidationResult {
  if (!fs.existsSync(frameworkPath)) {
    return { valid: false, reason: "Framework directory not found" };
  }

  const fwName = path.basename(frameworkPath, ".framework");
  const binaryPath = path.join(frameworkPath, fwName);
  const plistPath = path.join(frameworkPath, "Info.plist");
  const manifestPath = path.join(frameworkPath, "game.manifest.json");

  if (!fs.existsSync(binaryPath)) {
    return { valid: false, reason: `Missing framework binary ${fwName}` };
  }
  if (!fs.existsSync(plistPath)) {
    return { valid: false, reason: "Missing Info.plist" };
  }
  if (!fs.existsSync(manifestPath)) {
    return { valid: false, reason: "Missing game.manifest.json" };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      chain?: string;
    };
    const manifestChain = manifest.chain?.trim().toLowerCase();
    if (expectedChain) {
      const expectedNorm = expectedChain.trim().toLowerCase();
      if (!manifestChain) {
        return {
          valid: false,
          reason: `Framework missing shader chain field (expected ${expectedNorm})`,
        };
      }
      if (manifestChain !== expectedNorm) {
        return {
          valid: false,
          chain: manifestChain,
          reason: `Shader chain mismatch: framework has ${manifestChain}, current dmsh_chain.h requires ${expectedNorm}`,
        };
      }
    }
    return { valid: true, chain: manifestChain };
  } catch (err) {
    return {
      valid: false,
      reason: `Invalid game.manifest.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Checks `nx2android` `android.tsv` to see whether a Title ID has an official Android profile. */
export function checkAndroidProfileSupport(
  nx2androidDir: string | null,
  titleId?: string | null
): { supported: boolean; profileName?: string } {
  const cleanTid = titleId?.trim().toUpperCase();
  if (!nx2androidDir || !cleanTid) {
    return { supported: false };
  }

  const candidates = [
    path.join(nx2androidDir, "android.tsv"),
    path.join(nx2androidDir, "porter", "android.tsv"),
    path.join(nx2androidDir, "dm", "android.tsv"),
  ];

  const tsvPath = candidates.find((p) => fs.existsSync(p));
  if (!tsvPath) {
    return { supported: false };
  }

  try {
    const content = fs.readFileSync(tsvPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const cols = line.split("\t");
      const rowTid = cols[0]?.trim().toUpperCase();
      if (rowTid === cleanTid) {
        return {
          supported: true,
          profileName: cols[1]?.trim() || cleanTid,
        };
      }
    }
  } catch {
    return { supported: false };
  }

  return { supported: false };
}

/** Resolves an installed Android NDK directory across `NX2A_HOME`, env vars, and macOS SDK paths. */
export function findAndroidNdkDirectory(
  nx2aHome?: string | null
): string | null {
  const scanToolchains = (toolchainsDir: string): string | null => {
    if (!fs.existsSync(toolchainsDir)) return null;
    try {
      const dirs = fs
        .readdirSync(toolchainsDir)
        .filter((d) => d.toLowerCase().startsWith("android-ndk"))
        .sort()
        .reverse();
      for (const d of dirs) {
        const full = path.join(toolchainsDir, d);
        if (fs.existsSync(path.join(full, "ndk-build"))) return full;
      }
    } catch {
      // ignore
    }
    return null;
  };

  if (nx2aHome) {
    const found = scanToolchains(path.join(nx2aHome, "toolchains"));
    if (found) return found;
  }

  for (const envVar of [
    process.env.ANDROID_NDK_HOME,
    process.env.ANDROID_NDK_ROOT,
  ]) {
    if (envVar && fs.existsSync(envVar)) return envVar;
  }

  const home = os.homedir();
  const userLegacy = scanToolchains(
    path.join(
      home,
      "Library",
      "Application Support",
      "nx2android",
      "toolchains"
    )
  );
  if (userLegacy) return userLegacy;

  const sdkNdk = path.join(home, "Library", "Android", "sdk", "ndk");
  if (fs.existsSync(sdkNdk)) {
    try {
      const vers = fs.readdirSync(sdkNdk).sort().reverse();
      for (const v of vers) {
        const full = path.join(sdkNdk, v);
        if (fs.existsSync(path.join(full, "ndk-build"))) return full;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/** Finds a built `.apk` inside candidate directories (newest first). */
export function findGeneratedApk(searchDirs: string[]): string | null {
  const apks: Array<{ path: string; mtimeMs: number }> = [];
  for (const dir of searchDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (entry.startsWith("._") || !entry.toLowerCase().endsWith(".apk")) {
          continue;
        }
        const full = path.join(dir, entry);
        const st = fs.statSync(full);
        if (st.isFile() && st.size > 0) {
          apks.push({ path: full, mtimeMs: st.mtimeMs });
        }
      }
    } catch {
      // ignore
    }
  }
  apks.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return apks[0]?.path ?? null;
}

/** Translates cryptographic key errors from nxnative/porter into actionable guidance. */
export function formatPortErrorHint(rawLog: string): string | null {
  const keyMatch = /key_area_key_application_([0-9a-fA-F]+)/.exec(rawLog);
  if (keyMatch) {
    const rev = Number.parseInt(keyMatch[1], 16);
    const keyName = `master_key_${rev.toString(16).padStart(2, "0")}`;
    return `O seu arquivo prod.keys não possui a chave ${keyName} exigida por este jogo. Atualize seu prod.keys com um dump de firmware mais recente nos Ajustes ou no botão acima.`;
  }
  if (
    /missing header_key|header_key/i.test(rawLog) &&
    /prod\.keys/i.test(rawLog)
  ) {
    return "prod.keys inválido ou incompleto. Selecione um arquivo prod.keys válido extraído do console.";
  }
  return null;
}
