import axios from "axios";
import path from "node:path";
import fs from "node:fs";
import { crc32 } from "crc";
import WinReg from "winreg";
import { parseBuffer, writeBuffer } from "steam-shortcut-editor";

import type { SteamShortcut } from "@types";

import { logger } from "./logger";
import { SystemPath } from "./system-path";
import { CrossOverDetector } from "./crossover/crossover-detector";
import {
  parseSteamAppDetailsResponse,
  type SteamAppDetailsResponse,
} from "./steam-app-details";

const getDarwinWineSteamInstallations = async (): Promise<
  { bottleDir: string; steamLocation: string }[]
> => {
  if (process.platform !== "darwin") return [];

  const installations: { bottleDir: string; steamLocation: string }[] = [];
  try {
    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    const bottles = await CrossOverDetector.listBottles(bottlesDir);

    const relativeSteamPaths = [
      path.join("drive_c", "Program Files (x86)", "Steam"),
      path.join("drive_c", "Program Files", "Steam"),
    ];

    for (const bottle of bottles) {
      const bottleDir = path.join(bottlesDir, bottle);
      for (const relPath of relativeSteamPaths) {
        const candidate = path.join(bottleDir, relPath);
        if (
          fs.existsSync(candidate) &&
          fs.existsSync(path.join(candidate, "steamapps"))
        ) {
          installations.push({ bottleDir, steamLocation: candidate });
        }
      }
    }
  } catch (error) {
    logger.warn(
      "[getSteamLocation] Error checking Fine Wine Steam installations",
      error
    );
  }

  return installations;
};

const resolveBottleWindowsPath = (
  bottleDir: string,
  rawPath: string
): string | null => {
  const normalized = rawPath.replaceAll("/", "\\");
  const match = normalized.match(/^([a-zA-Z]):\\(.*)$/);
  if (!match) {
    if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) return rawPath;
    return null;
  }

  const driveLetter = match[1].toLowerCase();
  const restParts = match[2].split("\\").filter(Boolean);

  if (driveLetter === "c") {
    const candidate = path.join(bottleDir, "drive_c", ...restParts);
    return fs.existsSync(candidate) ? candidate : null;
  }

  const dosdevice = path.join(bottleDir, "dosdevices", `${driveLetter}:`);
  if (fs.existsSync(dosdevice)) {
    try {
      const realTarget = fs.realpathSync(dosdevice);
      const candidate = path.join(realTarget, ...restParts);
      return fs.existsSync(candidate) ? candidate : null;
    } catch {
      return null;
    }
  }

  return null;
};

export const getSteamLocation = async () => {
  if (process.platform === "linux") {
    const home = SystemPath.getPath("home");
    const possiblePaths = [
      path.join(home, ".steam", "steam"),
      path.join(home, ".local", "share", "Steam"),
      path.join(
        home,
        ".var",
        "app",
        "com.valvesoftware.Steam",
        ".local",
        "share",
        "Steam"
      ),
      path.join(home, "snap", "steam", "common", ".local", "share", "Steam"),
    ];

    return possiblePaths.find((p) => fs.existsSync(p)) || possiblePaths[0];
  }

  if (process.platform === "darwin") {
    const nativePath = path.join(
      SystemPath.getPath("home"),
      "Library",
      "Application Support",
      "Steam"
    );
    if (fs.existsSync(path.join(nativePath, "steamapps"))) {
      return nativePath;
    }

    const wineSteamInstalls = await getDarwinWineSteamInstallations();
    if (wineSteamInstalls.length > 0) {
      return wineSteamInstalls[0].steamLocation;
    }

    return nativePath;
  }

  const regKey = new WinReg({
    hive: WinReg.HKCU,
    key: "\\Software\\Valve\\Steam",
  });

  return new Promise<string>((resolve, reject) => {
    regKey.get("SteamPath", (err, value) => {
      if (err) {
        reject(err);
      }

      if (!value) {
        reject(new Error("SteamPath not found in registry"));
      }

      resolve(value.value);
    });
  });
};

const LIBRARY_FOLDER_MANIFESTS = [
  ["steamapps", "libraryfolders.vdf"],
  ["config", "libraryfolders.vdf"],
];

const parseLibraryFolderPaths = (content: string) => {
  const values = [
    ...content.matchAll(/"path"\s*"([^"]+)"/g),
    ...content.matchAll(/"\d+"\s*"([^"]+)"/g),
  ].map((match) => match[1].replaceAll("\\\\", "\\"));

  return values.filter((value) => path.isAbsolute(value));
};

export const getSteamLibraryFolders = async (): Promise<string[]> => {
  const libraryFolders: string[] = [];

  const steamLocation = await getSteamLocation().catch(() => null);
  if (steamLocation && fs.existsSync(steamLocation)) {
    libraryFolders.push(steamLocation);

    for (const manifest of LIBRARY_FOLDER_MANIFESTS) {
      const content = await fs.promises
        .readFile(path.join(steamLocation, ...manifest), "utf8")
        .catch(() => null);

      if (!content) continue;

      const parsed = parseLibraryFolderPaths(content);
      if (parsed.length > 0) {
        libraryFolders.push(...parsed);
      }
    }
  }

  if (process.platform === "darwin") {
    const wineSteamInstalls = await getDarwinWineSteamInstallations();
    for (const { bottleDir, steamLocation: wineLoc } of wineSteamInstalls) {
      libraryFolders.push(wineLoc);

      for (const manifest of LIBRARY_FOLDER_MANIFESTS) {
        const content = await fs.promises
          .readFile(path.join(wineLoc, ...manifest), "utf8")
          .catch(() => null);

        if (!content) continue;

        const rawPaths = [
          ...content.matchAll(/"path"\s*"([^"]+)"/g),
          ...content.matchAll(/"\d+"\s*"([^"]+)"/g),
        ].map((m) => m[1]);

        for (const raw of rawPaths) {
          const resolved = resolveBottleWindowsPath(bottleDir, raw);
          if (resolved) {
            libraryFolders.push(resolved);
          }
        }
      }
    }
  }

  return [...new Set(libraryFolders.filter((f) => fs.existsSync(f)))];
};

const steamLanguageByLocale: Record<string, string> = {
  ar: "arabic",
  bg: "bulgarian",
  cs: "czech",
  da: "danish",
  de: "german",
  en: "english",
  es: "spanish",
  fi: "finnish",
  fr: "french",
  hu: "hungarian",
  id: "indonesian",
  it: "italian",
  ja: "japanese",
  ko: "koreana",
  nb: "norwegian",
  nl: "dutch",
  pl: "polish",
  "pt-BR": "brazilian",
  "pt-PT": "portuguese",
  ro: "romanian",
  ru: "russian",
  sv: "swedish",
  tr: "turkish",
  uk: "ukrainian",
  "zh-CN": "schinese",
  "zh-TW": "tchinese",
  zh: "schinese",
};

export const getSteamLanguage = (language: string) => {
  return (
    steamLanguageByLocale[language] ??
    steamLanguageByLocale[language.split("-")[0]] ??
    "english"
  );
};

export const getSteamAppDetails = async (
  objectId: string,
  language: string
) => {
  const searchParams = new URLSearchParams({
    appids: objectId,
    l: getSteamLanguage(language),
    cc: "us",
  });

  return axios
    .get<SteamAppDetailsResponse>(
      `http://store.steampowered.com/api/appdetails?${searchParams.toString()}`
    )
    .then((response) => parseSteamAppDetailsResponse(response.data, objectId))
    .catch((err) => {
      logger.error("Error on getSteamAppDetails", {
        message: err?.message,
        code: err?.code,
        name: err?.name,
      });
      return null;
    });
};

export const getSteamUsersIds = async () => {
  const steamLocation = await getSteamLocation().catch(() => null);

  if (!steamLocation) {
    return [];
  }

  const userDataPath = path.join(steamLocation, "userdata");

  if (!fs.existsSync(userDataPath)) {
    return [];
  }

  const userIds = fs.readdirSync(userDataPath, {
    withFileTypes: true,
  });

  return userIds
    .filter((dir) => dir.isDirectory())
    .map((dir) => Number(dir.name));
};

export const getSteamShortcuts = async (steamUserId: number) => {
  const shortcutsPath = path.join(
    await getSteamLocation(),
    "userdata",
    steamUserId.toString(),
    "config",
    "shortcuts.vdf"
  );

  if (!fs.existsSync(shortcutsPath)) {
    return [];
  }

  const shortcuts = parseBuffer(fs.readFileSync(shortcutsPath));

  return shortcuts.shortcuts as SteamShortcut[];
};

export const generateSteamShortcutAppId = (
  exePath: string,
  gameName: string
) => {
  const input = exePath + gameName;
  const crcValue = crc32(input) >>> 0;
  const steamAppId = (crcValue | 0x80000000) >>> 0;
  return steamAppId;
};

export interface CreateSteamShortcutOptions {
  openVr?: boolean;
}

interface SteamShortcutLaunchConfig {
  appIdSeed?: string;
  launchOptions?: string;
}

export const composeSteamShortcut = (
  title: string,
  executablePath: string,
  iconPath: string | null,
  options?: CreateSteamShortcutOptions,
  launchConfig: SteamShortcutLaunchConfig = {}
): SteamShortcut => {
  return {
    appid: generateSteamShortcutAppId(
      executablePath,
      launchConfig.appIdSeed ?? title
    ),
    appname: title,
    Exe: `"${executablePath}"`,
    StartDir: `"${path.dirname(executablePath)}"`,
    icon: iconPath ?? "",
    ShortcutPath: "",
    LaunchOptions: launchConfig.launchOptions ?? "",
    IsHidden: false,
    AllowDesktopConfig: true,
    AllowOverlay: true,
    OpenVR: Boolean(options?.openVr),
    Devkit: false,
    DevkitGameID: "",
    DevkitOverrideAppID: false,
    LastPlayTime: 0,
    FlatpakAppID: "",
  };
};

export const writeSteamShortcuts = async (
  steamUserId: number,
  shortcuts: SteamShortcut[]
) => {
  const buffer = writeBuffer({ shortcuts });

  return fs.promises.writeFile(
    path.join(
      await getSteamLocation(),
      "userdata",
      steamUserId.toString(),
      "config",
      "shortcuts.vdf"
    ),
    buffer
  );
};
