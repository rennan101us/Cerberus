import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import type {
  NxDependencyCategory,
  NxDependencyStatus,
  NxInstallerProgressEvent,
  NxStorageStats,
  NxTargetPlatform,
  UserPreferences,
} from "@types";
import { db, levelKeys } from "@main/level";
import { WindowManager } from "@main/services/window-manager";
import { AppLogHub } from "@main/services/app-log-hub";
import { NxPathsService } from "./nx-paths";
import { findAndroidNdkDirectory } from "./nx-build-helpers";

interface DependencyDef {
  id: string;
  name: string;
  category: NxDependencyCategory;
  isProtected: boolean;
  downloadSizeBadge: string;
  installedSizeBadge: string;
  recommendation?: string;
  installCommand: string;
  repairCommand: string;
  uninstallCommand?: string;
  check: () => { isAvailable: boolean; details: string };
}

function quickCmd(cmd: string, args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: 3000,
      env: { ...process.env, PATH: NxPathsService.getAugmentedPath() },
    }).trim();
    return { ok: true, out };
  } catch {
    return { ok: false, out: "" };
  }
}

function findBin(candidates: string[]): string | null {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const DEPENDENCY_DEFS: DependencyDef[] = [
  {
    id: "xcode",
    name: "Xcode & Command Line Tools",
    category: "apple",
    isProtected: true,
    downloadSizeBadge: "~1.5 GB",
    installedSizeBadge: "~3.5 GB",
    installCommand: "xcode-select --install",
    repairCommand: "xcode-select --reset",
    check: () => {
      const res = quickCmd("/usr/bin/xcode-select", ["-p"]);
      return res.ok && res.out
        ? { isAvailable: true, details: res.out }
        : { isAvailable: false, details: "Não instalado" };
    },
  },
  {
    id: "homebrew",
    name: "Homebrew Package Manager",
    category: "core",
    isProtected: true,
    downloadSizeBadge: "~50 MB",
    installedSizeBadge: "~120 MB",
    recommendation: "Necessário para instalar compiladores, SDKs e ferramentas",
    installCommand:
      'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" && (if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; elif [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi)',
    repairCommand: "brew update",
    check: () => {
      const bin = findBin(["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]);
      if (!bin) return { isAvailable: false, details: "Não encontrado" };
      const v = quickCmd(bin, ["--version"]);
      return {
        isAvailable: true,
        details: v.out.split(/\r?\n/)[0] || bin,
      };
    },
  },
  {
    id: "git",
    name: "Git Version Control",
    category: "core",
    isProtected: true,
    downloadSizeBadge: "~60 MB",
    installedSizeBadge: "~110 MB",
    installCommand: "brew install git",
    repairCommand: "brew reinstall git",
    check: () => {
      const bin = findBin([
        "/opt/homebrew/bin/git",
        "/usr/local/bin/git",
        "/usr/bin/git",
      ]);
      if (!bin) return { isAvailable: false, details: "Não encontrado" };
      const v = quickCmd(bin, ["--version"]);
      return { isAvailable: v.ok, details: v.out || bin };
    },
  },
  {
    id: "python",
    name: "Python 3 (3.12 – 3.14)",
    category: "core",
    isProtected: false,
    downloadSizeBadge: "~85 MB",
    installedSizeBadge: "~160 MB",
    installCommand: "brew install python@3.13",
    repairCommand: "brew reinstall python@3.13",
    uninstallCommand: "brew uninstall python@3.13",
    check: () => {
      const py = NxPathsService.findBestPython();
      return {
        isAvailable: Boolean(py.path && py.isStable),
        details: py.path ? `${py.version} (${py.path})` : "Não encontrado",
      };
    },
  },
  {
    id: "python_packages",
    name: "Python Modules (lz4, capstone, fonttools, zbic, pillow, pyyaml)",
    category: "core",
    isProtected: false,
    downloadSizeBadge: "~65 MB",
    installedSizeBadge: "~140 MB",
    installCommand:
      'PY_BIN="${CERBERUS_PYTHON_BIN:-}"; if [ -z "$PY_BIN" ]; then for c in /opt/homebrew/bin/python3.13 /usr/local/bin/python3.13 /opt/homebrew/bin/python3.14 /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3 /usr/local/bin/python3 $(which python3); do if [ -x "$c" ]; then PY_BIN="$c"; break; fi; done; fi; if [ -n "$PY_BIN" ]; then if "$PY_BIN" -m pip install --help 2>&1 | grep -q -- \'--break-system-packages\'; then "$PY_BIN" -m pip install --break-system-packages lz4 capstone fonttools zbic pycryptodome pillow pyyaml backports.zstd && ("$PY_BIN" -m pip install --break-system-packages nsz 2>/dev/null || true); else "$PY_BIN" -m pip install lz4 capstone fonttools zbic pycryptodome pillow pyyaml backports.zstd && ("$PY_BIN" -m pip install nsz 2>/dev/null || true); fi; fi',
    repairCommand:
      'PY_BIN="${CERBERUS_PYTHON_BIN:-}"; if [ -z "$PY_BIN" ]; then for c in /opt/homebrew/bin/python3.13 /usr/local/bin/python3.13 /opt/homebrew/bin/python3.14 /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3 /usr/local/bin/python3 $(which python3); do if [ -x "$c" ]; then PY_BIN="$c"; break; fi; done; fi; if [ -n "$PY_BIN" ]; then if "$PY_BIN" -m pip install --help 2>&1 | grep -q -- \'--break-system-packages\'; then "$PY_BIN" -m pip install --force-reinstall --break-system-packages lz4 capstone fonttools zbic pycryptodome pillow pyyaml backports.zstd && ("$PY_BIN" -m pip install --force-reinstall --break-system-packages nsz 2>/dev/null || true); else "$PY_BIN" -m pip install --force-reinstall lz4 capstone fonttools zbic pycryptodome pillow pyyaml backports.zstd && ("$PY_BIN" -m pip install --force-reinstall nsz 2>/dev/null || true); fi; fi',
    uninstallCommand:
      'PY_BIN="${CERBERUS_PYTHON_BIN:-}"; if [ -z "$PY_BIN" ]; then for c in /opt/homebrew/bin/python3.13 /usr/local/bin/python3.13 /opt/homebrew/bin/python3.14 /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3 /usr/local/bin/python3 $(which python3); do if [ -x "$c" ]; then PY_BIN="$c"; break; fi; done; fi; if [ -n "$PY_BIN" ]; then "$PY_BIN" -m pip uninstall -y --break-system-packages lz4 capstone fonttools zbic pycryptodome pillow pyyaml backports.zstd nsz 2>/dev/null || "$PY_BIN" -m pip uninstall -y lz4 capstone fonttools zbic pycryptodome pillow pyyaml backports.zstd nsz 2>/dev/null || true; fi',
    check: () => {
      const py = NxPathsService.findBestPython();
      const allPresent = py.isSufficient && Boolean(py.hasAndroidModules);
      return {
        isAvailable: allPresent,
        details: allPresent
          ? "lz4, capstone, fontTools, zbic, pillow, pyyaml instalados"
          : py.isSufficient
            ? "Módulos core OK, módulos Android ausentes (pillow/pyyaml)"
            : "Módulos Python ausentes",
      };
    },
  },
  {
    id: "dotnet",
    name: ".NET SDK",
    category: "core",
    isProtected: false,
    downloadSizeBadge: "~220 MB",
    installedSizeBadge: "~900 MB",
    installCommand: "brew install --cask dotnet-sdk",
    repairCommand: "brew reinstall --cask dotnet-sdk",
    uninstallCommand: "brew uninstall --cask dotnet-sdk",
    check: () => {
      const bin = findBin([
        "/usr/local/share/dotnet/dotnet",
        "/opt/homebrew/bin/dotnet",
        "/usr/local/bin/dotnet",
      ]);
      if (!bin) return { isAvailable: false, details: "Não encontrado" };
      const v = quickCmd(bin, ["--version"]);
      return { isAvailable: v.ok, details: v.ok ? `v${v.out}` : "Erro" };
    },
  },
  {
    id: "xcodegen",
    name: "XcodeGen",
    category: "apple",
    isProtected: false,
    downloadSizeBadge: "~15 MB",
    installedSizeBadge: "~35 MB",
    installCommand: "brew install xcodegen",
    repairCommand: "brew reinstall xcodegen",
    uninstallCommand: "brew uninstall xcodegen",
    check: () => {
      const bin = findBin([
        "/opt/homebrew/bin/xcodegen",
        "/usr/local/bin/xcodegen",
      ]);
      if (!bin) return { isAvailable: false, details: "Não encontrado" };
      const v = quickCmd(bin, ["--version"]);
      return { isAvailable: v.ok, details: v.out || bin };
    },
  },
  {
    id: "zstd",
    name: "zstd",
    category: "core",
    isProtected: false,
    downloadSizeBadge: "~5 MB",
    installedSizeBadge: "~12 MB",
    installCommand: "brew install zstd",
    repairCommand: "brew reinstall zstd",
    uninstallCommand: "brew uninstall zstd",
    check: () => {
      const bin = findBin(["/opt/homebrew/bin/zstd", "/usr/local/bin/zstd"]);
      if (!bin) return { isAvailable: false, details: "Não encontrado" };
      const v = quickCmd(bin, ["--version"]);
      return { isAvailable: v.ok, details: v.out.slice(0, 48) || bin };
    },
  },
  {
    id: "spirv_cross",
    name: "spirv-cross",
    category: "core",
    isProtected: false,
    downloadSizeBadge: "~10 MB",
    installedSizeBadge: "~25 MB",
    installCommand: "brew install spirv-cross",
    repairCommand: "brew reinstall spirv-cross",
    uninstallCommand: "brew uninstall spirv-cross",
    check: () => {
      const bin = findBin([
        "/opt/homebrew/bin/spirv-cross",
        "/usr/local/bin/spirv-cross",
      ]);
      return bin
        ? { isAvailable: true, details: bin }
        : { isAvailable: false, details: "Não encontrado" };
    },
  },
  {
    id: "glslang",
    name: "glslang",
    category: "core",
    isProtected: false,
    downloadSizeBadge: "~25 MB",
    installedSizeBadge: "~60 MB",
    installCommand: "brew install glslang",
    repairCommand: "brew reinstall glslang",
    uninstallCommand: "brew uninstall glslang",
    check: () => {
      const bin = findBin([
        "/opt/homebrew/bin/glslangValidator",
        "/opt/homebrew/bin/glslang",
        "/usr/local/bin/glslangValidator",
        "/usr/local/bin/glslang",
      ]);
      return bin
        ? { isAvailable: true, details: bin }
        : { isAvailable: false, details: "Não encontrado" };
    },
  },
  {
    id: "libimobiledevice",
    name: "libimobiledevice (afcclient)",
    category: "ios",
    isProtected: false,
    downloadSizeBadge: "~20 MB",
    installedSizeBadge: "~45 MB",
    installCommand: "brew install libimobiledevice",
    repairCommand: "brew reinstall libimobiledevice",
    uninstallCommand: "brew uninstall libimobiledevice",
    check: () => {
      const bin = findBin([
        "/opt/homebrew/bin/afcclient",
        "/opt/homebrew/bin/idevice_id",
        "/usr/local/bin/afcclient",
        "/usr/local/bin/idevice_id",
      ]);
      return bin
        ? { isAvailable: true, details: bin }
        : { isAvailable: false, details: "Não encontrado" };
    },
  },
  {
    id: "android_adb",
    name: "Android Platform-Tools (adb)",
    category: "android",
    isProtected: false,
    downloadSizeBadge: "~15 MB",
    installedSizeBadge: "~50 MB",
    recommendation:
      "Necessário para comunicação USB, instalação de APK e push RomFS",
    installCommand:
      'NX2A="${NX2A_HOME:-$HOME/Library/Application Support/nx2android}"; TMPDIR="${CERBERUS_TEMP_DIR:-/tmp}"; if which brew >/dev/null 2>&1; then brew install --cask android-platform-tools; else mkdir -p "$NX2A/toolchains" && curl -fsSL https://dl.google.com/android/repository/platform-tools-latest-darwin.zip -o "$TMPDIR/platform-tools.zip" && unzip -qo "$TMPDIR/platform-tools.zip" -d "$NX2A/toolchains" && rm -f "$TMPDIR/platform-tools.zip"; fi',
    repairCommand:
      'NX2A="${NX2A_HOME:-$HOME/Library/Application Support/nx2android}"; TMPDIR="${CERBERUS_TEMP_DIR:-/tmp}"; if which brew >/dev/null 2>&1; then brew reinstall --cask android-platform-tools; else rm -rf "$NX2A/toolchains/platform-tools" && mkdir -p "$NX2A/toolchains" && curl -fsSL https://dl.google.com/android/repository/platform-tools-latest-darwin.zip -o "$TMPDIR/platform-tools.zip" && unzip -qo "$TMPDIR/platform-tools.zip" -d "$NX2A/toolchains" && rm -f "$TMPDIR/platform-tools.zip"; fi',
    uninstallCommand:
      'NX2A="${NX2A_HOME:-$HOME/Library/Application Support/nx2android}"; brew uninstall --cask android-platform-tools 2>/dev/null || rm -rf "$NX2A/toolchains/platform-tools"',
    check: () => {
      const defaultNx2a = NxPathsService.getDefaultNx2AndroidHomeDirectory();
      const bin = findBin([
        "/opt/homebrew/bin/adb",
        "/usr/local/bin/adb",
        path.join(defaultNx2a, "toolchains", "platform-tools", "adb"),
        path.join(
          os.homedir(),
          "Library",
          "Application Support",
          "nx2android",
          "toolchains",
          "platform-tools",
          "adb"
        ),
        path.join(
          os.homedir(),
          "Library",
          "Android",
          "sdk",
          "platform-tools",
          "adb"
        ),
      ]);
      return bin
        ? { isAvailable: true, details: bin }
        : { isAvailable: false, details: "Não encontrado" };
    },
  },
  {
    id: "android_ndk",
    name: "Android NDK (r27c)",
    category: "android",
    isProtected: false,
    downloadSizeBadge: "~1.1 GB",
    installedSizeBadge: "~2.6 GB",
    recommendation:
      "Necessário para compilar a camada nativa ARM64/Vulkan no Android",
    installCommand:
      'NX2A="${NX2A_HOME:-$HOME/Library/Application Support/nx2android}"; TMPDIR="${CERBERUS_TEMP_DIR:-/tmp}"; mkdir -p "$NX2A/toolchains" && curl -fsSL https://dl.google.com/android/repository/android-ndk-r27c-darwin.zip -o "$TMPDIR/android-ndk-r27c.zip" && unzip -qo "$TMPDIR/android-ndk-r27c.zip" -d "$NX2A/toolchains" && rm -f "$TMPDIR/android-ndk-r27c.zip"',
    repairCommand:
      'NX2A="${NX2A_HOME:-$HOME/Library/Application Support/nx2android}"; TMPDIR="${CERBERUS_TEMP_DIR:-/tmp}"; rm -rf "$NX2A/toolchains/android-ndk-r27c" && mkdir -p "$NX2A/toolchains" && curl -fsSL https://dl.google.com/android/repository/android-ndk-r27c-darwin.zip -o "$TMPDIR/android-ndk-r27c.zip" && unzip -qo "$TMPDIR/android-ndk-r27c.zip" -d "$NX2A/toolchains" && rm -f "$TMPDIR/android-ndk-r27c.zip"',
    uninstallCommand:
      'NX2A="${NX2A_HOME:-$HOME/Library/Application Support/nx2android}"; rm -rf "$NX2A/toolchains/android-ndk-r27c"',
    check: () => {
      const defaultNx2a = NxPathsService.getDefaultNx2AndroidHomeDirectory();
      const found = findAndroidNdkDirectory(defaultNx2a);
      return found
        ? { isAvailable: true, details: found }
        : { isAvailable: false, details: "Não encontrado" };
    },
  },
];

const RECLAIMABLE_BUILD_ENTRIES = new Set([
  "extract",
  "exefs",
  "shader",
  "pso",
  "xcode",
  "xcode-derived-data",
  "ipa",
  "tools",
  "tmp",
  "aoc",
  "font",
]);

function isReclaimableBuildItem(entryName: string): boolean {
  let base = entryName;
  for (const suffix of [".key", ".partial"]) {
    if (base.endsWith(suffix)) base = base.slice(0, -suffix.length);
  }
  return (
    RECLAIMABLE_BUILD_ENTRIES.has(base) ||
    base.startsWith("patched_") ||
    base.startsWith("nro_") ||
    base.endsWith("_build")
  );
}

function getFolderSizeBytes(target: string): number {
  if (!fs.existsSync(target)) return 0;
  try {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) return stat.size;
    let sum = 0;
    for (const entry of fs.readdirSync(target)) {
      sum += getFolderSizeBytes(path.join(target, entry));
    }
    return sum;
  } catch {
    return 0;
  }
}

export class NxToolchainService {
  private static isBusy = false;
  private static prereqsCache: { at: number; list: NxDependencyStatus[] } | null =
    null;

  public static invalidateCache(): void {
    this.prereqsCache = null;
  }

  public static checkPrerequisites(force = false): NxDependencyStatus[] {
    if (
      !force &&
      this.prereqsCache &&
      Date.now() - this.prereqsCache.at < 60_000
    ) {
      return this.prereqsCache.list;
    }

    const list = DEPENDENCY_DEFS.map((def) => {
      const res = def.check();
      return {
        id: def.id,
        name: def.name,
        isAvailable: res.isAvailable,
        details: res.details,
        recommendation: def.recommendation,
        isProtected: def.isProtected,
        downloadSizeBadge: def.downloadSizeBadge,
        installedSizeBadge: def.installedSizeBadge,
        category: def.category,
      };
    });
    this.prereqsCache = { at: Date.now(), list };
    return list;
  }

  public static getMissingForPlatform(
    platform: NxTargetPlatform,
    force = false
  ): NxDependencyStatus[] {
    const all = this.checkPrerequisites(force);
    return all.filter((dep) => {
      if (dep.isAvailable) return false;
      if (dep.category === "core") return true;
      if (dep.category === "apple") {
        return platform === "macApp" || platform === "ios";
      }
      if (dep.category === "ios") return platform === "ios";
      if (dep.category === "android") return platform === "android";
      return false;
    });
  }

  private static emitProgress(ev: NxInstallerProgressEvent): void {
    try {
      WindowManager.sendToAppWindows("on-nx-installer-progress", ev);
    } catch {
      // ignore
    }
  }

  private static async getShellContextEnv(): Promise<Record<string, string>> {
    const [pythonInfo, nx2aHome, tempDir] = await Promise.all([
      NxPathsService.findBestPython(),
      NxPathsService.getNx2AndroidHomeDirectory(),
      NxPathsService.getTempDirectory(),
    ]);
    return {
      CERBERUS_PYTHON_BIN: pythonInfo.path || "",
      NX2A_HOME: nx2aHome,
      CERBERUS_TEMP_DIR: tempDir,
    };
  }

  private static runShellCommand(
    command: string,
    onLine: (line: string) => void,
    extraEnv?: Record<string, string>
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const tempDir = extraEnv?.CERBERUS_TEMP_DIR || os.tmpdir();
      fs.mkdirSync(tempDir, { recursive: true });
      const askPassPath = path.join(
        tempDir,
        `cerberus_nx_askpass_${Date.now()}.sh`
      );
      const askPassContent = `#!/bin/bash
exec osascript -e 'display dialog "Cerberus requer privilégios de administrador para instalar dependências de compilação.\\n\\nDigite sua senha do macOS:" default answer "" with hidden answer with icon caution with title "Cerberus"' -e 'text returned of result'
`;
      try {
        fs.writeFileSync(askPassPath, askPassContent, { mode: 0o755 });
      } catch {
        // ignore
      }

      const child = spawn("/bin/zsh", ["-l", "-c", command], {
        env: {
          ...process.env,
          PATH: NxPathsService.getAugmentedPath(),
          SUDO_ASKPASS: askPassPath,
          ...extraEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let captured = "";
      const handle = (buf: Buffer) => {
        const text = buf.toString("utf8");
        captured += text;
        for (const l of text.split(/\r?\n/)) {
          const t = l.trim();
          if (t) onLine(t);
        }
      };
      child.stdout.on("data", handle);
      child.stderr.on("data", handle);
      const cleanup = () => {
        try {
          if (fs.existsSync(askPassPath)) fs.unlinkSync(askPassPath);
        } catch {
          // ignore
        }
      };
      child.on("close", (code) => {
        cleanup();
        const ok =
          code === 0 ||
          (command.includes("xcode-select") &&
            (captured.includes("install requested") ||
              captured.includes("already installed")));
        resolve(ok);
      });
      child.on("error", () => {
        cleanup();
        resolve(false);
      });
    });
  }

  public static async runDependencyAction(
    action: "install" | "repair" | "uninstall",
    dependencyId: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.isBusy) {
      return {
        ok: false,
        error: "Já existe uma operação de dependência em andamento.",
      };
    }
    const def = DEPENDENCY_DEFS.find((d) => d.id === dependencyId);
    if (!def) return { ok: false, error: "Dependência desconhecida." };
    if (action === "uninstall" && (def.isProtected || !def.uninstallCommand)) {
      return {
        ok: false,
        error: `${def.name} é uma ferramenta essencial do sistema e não pode ser removida.`,
      };
    }

    const cmd =
      action === "install"
        ? def.installCommand
        : action === "repair"
          ? def.repairCommand
          : def.uninstallCommand!;

    this.isBusy = true;
    this.emitProgress({
      action,
      dependencyId,
      itemName: def.name,
      phase: "start",
    });
    AppLogHub.step("installer", `==> ${action.toUpperCase()}: ${def.name}`);

    try {
      const shellEnv = await this.getShellContextEnv();
      const ok = await this.runShellCommand(
        cmd,
        (line) => {
          AppLogHub.info("installer", line);
          this.emitProgress({
            action,
            dependencyId,
            itemName: def.name,
            phase: "output",
            line,
          });
        },
        shellEnv
      );

      AppLogHub.append(
        ok ? "success" : "error",
        "installer",
        ok ? `[OK] ${def.name} concluído.` : `[FAIL] Falha em ${def.name}.`
      );
      this.emitProgress({
        action,
        dependencyId,
        itemName: def.name,
        phase: "complete",
        success: ok,
      });
      this.invalidateCache();
      return { ok };
    } finally {
      this.isBusy = false;
    }
  }

  public static async installMissingDependencies(
    platform?: NxTargetPlatform
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.isBusy) {
      return { ok: false, error: "Já existe uma instalação em andamento." };
    }
    const missing = platform
      ? this.getMissingForPlatform(platform, true)
      : this.checkPrerequisites(true).filter((d) => !d.isAvailable);

    if (missing.length === 0) return { ok: true };

    this.isBusy = true;
    let allOk = true;
    this.emitProgress({ action: "installAll", phase: "start" });

    try {
      const shellEnv = await this.getShellContextEnv();
      for (const item of missing) {
        const def = DEPENDENCY_DEFS.find((d) => d.id === item.id);
        if (!def) continue;
        AppLogHub.step("installer", `==> Instalando: ${def.name}`);
        this.emitProgress({
          action: "installAll",
          dependencyId: def.id,
          itemName: def.name,
          phase: "start",
        });
        const ok = await this.runShellCommand(
          def.installCommand,
          (line) => {
            AppLogHub.info("installer", line);
            this.emitProgress({
              action: "installAll",
              dependencyId: def.id,
              itemName: def.name,
              phase: "output",
              line,
            });
          },
          shellEnv
        );
        if (!ok) allOk = false;
        this.emitProgress({
          action: "installAll",
          dependencyId: def.id,
          itemName: def.name,
          phase: "item_done",
          success: ok,
        });
      }

      this.invalidateCache();
      this.emitProgress({
        action: "installAll",
        phase: "complete",
        success: allOk,
      });
      return { ok: allOk };
    } finally {
      this.isBusy = false;
    }
  }

  // --- Storage & Caches Audit / Cleanup ---

  public static async getStorageStats(): Promise<NxStorageStats> {
    const [outputDir, stagingDir, appSupportDir, tempDir] = await Promise.all([
      NxPathsService.getOutputDirectory(),
      NxPathsService.getStagingDirectory(),
      NxPathsService.getAppSupportDirectory(),
      NxPathsService.getTempDirectory(),
    ]);

    let buildCacheBytes = 0;
    for (const dir of Array.from(new Set([stagingDir, outputDir, tempDir]))) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (isReclaimableBuildItem(entry)) {
          buildCacheBytes += getFolderSizeBytes(full);
        } else if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
          for (const subEntry of fs.readdirSync(full)) {
            if (isReclaimableBuildItem(subEntry)) {
              buildCacheBytes += getFolderSizeBytes(path.join(full, subEntry));
            }
          }
        }
      }
    }

    const artworkCacheBytes =
      getFolderSizeBytes(path.join(appSupportDir, "covers")) +
      getFolderSizeBytes(path.join(appSupportDir, "artwork"));

    const iCloudAvailable = NxPathsService.isICloudDriveAvailable();
    const iCloudBytes = iCloudAvailable
      ? getFolderSizeBytes(NxPathsService.getICloudRootDirectory())
      : 0;

    let iCloudSyncEnabled = false;
    try {
      const prefs = (await db.get<string, UserPreferences>(
        levelKeys.userPreferences,
        { valueEncoding: "json" }
      )) as UserPreferences;
      iCloudSyncEnabled = Boolean(prefs?.nxICloudSyncEnabled);
    } catch {
      iCloudSyncEnabled = false;
    }

    return {
      buildCacheBytes,
      artworkCacheBytes,
      iCloudBytes,
      iCloudAvailable,
      iCloudSyncEnabled,
      outputFreeBytes: NxPathsService.getDiskFreeBytes(outputDir),
      stagingFreeBytes: NxPathsService.getDiskFreeBytes(stagingDir),
    };
  }

  public static async cleanBuildCache(): Promise<number> {
    const [outputDir, stagingDir, tempDir] = await Promise.all([
      NxPathsService.getOutputDirectory(),
      NxPathsService.getStagingDirectory(),
      NxPathsService.getTempDirectory(),
    ]);
    let freed = 0;
    for (const dir of Array.from(new Set([stagingDir, outputDir, tempDir]))) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (isReclaimableBuildItem(entry)) {
          freed += getFolderSizeBytes(full);
          fs.rmSync(full, { recursive: true, force: true });
        } else if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
          for (const subEntry of fs.readdirSync(full)) {
            if (!isReclaimableBuildItem(subEntry)) continue;
            const subFull = path.join(full, subEntry);
            freed += getFolderSizeBytes(subFull);
            fs.rmSync(subFull, { recursive: true, force: true });
          }
        }
      }
    }
    AppLogHub.success(
      "system",
      `Cache de compilação limpo (${(freed / (1024 * 1024)).toFixed(1)} MB liberados).`
    );
    return freed;
  }

  public static async cleanArtworkCache(): Promise<number> {
    const appSupportDir = await NxPathsService.getAppSupportDirectory();
    let freed = 0;
    for (const sub of ["covers", "artwork"]) {
      const dir = path.join(appSupportDir, sub);
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (entry.endsWith(".custom.jpg")) continue;
        const full = path.join(dir, entry);
        freed += getFolderSizeBytes(full);
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
    AppLogHub.success(
      "system",
      `Cache de arte dos jogos limpo (${(freed / (1024 * 1024)).toFixed(1)} MB liberados).`
    );
    return freed;
  }

  public static async purgeICloudBackups(): Promise<number> {
    const root = NxPathsService.getICloudRootDirectory();
    if (!fs.existsSync(root)) return 0;
    const size = getFolderSizeBytes(root);
    fs.rmSync(root, { recursive: true, force: true });
    AppLogHub.success(
      "system",
      `Backups iCloud removidos (${(size / (1024 * 1024)).toFixed(1)} MB liberados).`
    );
    return size;
  }
}
