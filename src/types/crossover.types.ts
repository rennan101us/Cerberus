export type CrossOverGraphicsBackend = "d3dmetal" | "dxmt" | "dxvk" | "wined3d";

export type CrossOverSyncMode = "msync" | "esync" | "none";

export interface MacOSCompatibilityOptions {
  bottleName?: string;
  graphicsBackend?: CrossOverGraphicsBackend;
  syncMode?: CrossOverSyncMode;
  highResolutionMode?: boolean;
  metalHud?: boolean;
  rosettaAvx?: boolean;
  environmentVariables?: Record<string, string>;
}

export interface CrossOverStatus {
  installed: boolean;
  version: string | null;
  build: string | null;
  appPath: string | null;
  bottlesDir: string | null;
  bottles: string[];
  defaultBottle: string;
  updateAvailable: boolean;
  latestVersion: string | null;
  downloadUrl: string | null;
}

export interface CrossOverProvisionProgress {
  phase:
    | "idle"
    | "checking"
    | "downloading"
    | "extracting"
    | "configuring"
    | "done"
    | "error";
  progress: number;
  message?: string;
  error?: string;
}

export interface CrossOverTool {
  id: string;
  name: string;
  description: string;
  category: "storefront" | "runtime" | "utility";
  bottleName: string;
  downloadUrl: string;
  installerFilename: string;
  installedExecutables: string[];
  officialUrl: string;
}

export interface CrossOverToolWithStatus extends CrossOverTool {
  installed: boolean;
  executablePath: string | null;
  bottleExists: boolean;
}

export interface CrossOverToolDownloadProgress {
  toolId: string;
  phase: "downloading" | "preparing_bottle" | "installing" | "done" | "error";
  progress: number;
  loadedBytes?: number;
  totalBytes?: number | null;
  message?: string;
  error?: string;
}

export type MacCompatibilityRating =
  | "PERFECT"
  | "VERY_GOOD"
  | "GOOD"
  | "PLAYABLE"
  | "UNPLAYABLE"
  | "UNKNOWN";

export type MacCompatibilitySourceId =
  | "macgamingdb"
  | "codeweavers"
  | "applegamingwiki";

export interface MacCompatibilityComment {
  id: string;
  source: MacCompatibilitySourceId;
  chipset?: string | null;
  crossoverVersion?: string | null;
  rating?: MacCompatibilityRating | string | null;
  fps?: string | null;
  graphicsBackend?: string | null;
  text: string;
  date?: string | null;
  url?: string | null;
}

export interface MacCompatibilityChipsetSummary {
  chipset: string;
  reports: number;
  medianFps?: number | null;
}

export interface MacCompatibilitySourceInfo {
  id: MacCompatibilitySourceId;
  name: string;
  url: string;
  ratingLabel?: string | null;
  found: boolean;
}

export interface HeadBottleDependenciesStatus {
  bottleReady: boolean;
  bottleDir: string | null;
  vcredist: boolean;
  directx: boolean;
  steam: boolean;
  epic: boolean;
}

export interface MacCompatibilityReport {
  gameTitle: string;
  steamAppId?: string | null;
  overallRating: MacCompatibilityRating;
  summaryText?: string | null;
  medianFps?: number | null;
  crossoverReportCount: number;
  totalReportCount: number;
  latestCrossoverVersion?: string | null;
  chipsets: MacCompatibilityChipsetSummary[];
  recommendedSettings: {
    graphicsBackend: CrossOverGraphicsBackend;
    syncMode: CrossOverSyncMode;
    rosettaAvx: boolean;
    notes: string[];
  };
  sources: {
    macgamingdb: MacCompatibilitySourceInfo;
    codeweavers: MacCompatibilitySourceInfo;
    applegamingwiki: MacCompatibilitySourceInfo;
  };
  comments: MacCompatibilityComment[];
  updatedAt: number;
}

export type MacChipFamily =
  | "M1"
  | "M2"
  | "M3"
  | "M4"
  | "M5"
  | "Intel"
  | "Unknown";

export type MacChipTier = "base" | "pro" | "max" | "ultra" | "unknown";

export interface MacHardwareSpecs {
  chipName: string;
  chipFamily: MacChipFamily;
  chipTier: MacChipTier;
  ramGB: number;
  cpuCoresTotal: number;
  cpuPerformanceCores: number | null;
  cpuEfficiencyCores: number | null;
  gpuCores: number | null;
  isAppleSilicon: boolean;
}

export type MacHardwareCheckStatus = "pass" | "warn" | "fail";

export type MacDeckVerdict = "verified" | "playable" | "unsupported";

export interface MacCompatibilityCheckItem {
  key: "chip" | "ram" | "cpuCores" | "gpuCores";
  label: string;
  userValue: string;
  targetValue: string;
  status: MacHardwareCheckStatus;
  reason: string;
}

export interface MacHardwareCompatibilityEvaluation {
  verdict: MacDeckVerdict;
  verdictTitle: string;
  verdictSubtitle: string;
  checks: MacCompatibilityCheckItem[];
}

export interface RedWineBottleConfig {
  graphicsBackend: CrossOverGraphicsBackend;
  syncMode: CrossOverSyncMode;
  windowsVersion: "win10" | "win11" | "win7";
  rosettaAvx: boolean;
  metalHud: boolean;
  highResolutionMode: boolean;
  audioDriver: "coreaudio";
  sdlGamepadEnabled: boolean;
  tlsModernEnabled: boolean;
}

