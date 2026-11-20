export type SwitchGeneration = "switch1" | "switch2";

export type NxTargetPlatform = "macApp" | "ios" | "android";

export type NxCompatibilityPlatform =
  | "all"
  | "macOS"
  | "iOS"
  | "iPadOS"
  | "android";

export type NxDependencyCategory = "core" | "apple" | "ios" | "android";

export type LauncherHighlightThemeId =
  | "cerberus"
  | "electricPurple"
  | "nintendoRed"
  | "neonBlue"
  | "emeraldGreen"
  | "sunsetOrange"
  | "cyberRose"
  | "hyruleGold"
  | "deepCobalt"
  | "neonBlack"
  | "custom";

export interface NxCompatibleGame {
  id: string;
  title: string;
  titleId: string;
  generation: SwitchGeneration;
  versionTested: string;
  sdk: string;
  engine: string;
  graphicsApi: string;
  readmeRelPath: string;
  githubUrl: string;
  macReq: string;
  iosReq: string;
  androidReq: string;
  androidGpuTier: string;
  storageReq: string;
  minRamGB: number;
  minChipTier: string;
  isNew: boolean;
  addedTimestamp: number;
  isMacSupported: boolean;
  isIosSupported: boolean;
  isIpadOsSupported: boolean;
  isAndroidSupported: boolean;
  coverUrl: string | null;
  genres: string[];
  cloudSources: string[];
}

export interface NxCloudAvailableGame {
  titleId: string;
  gameTitle: string;
  matchedVersion: string;
  downloadURL: string;
  isTorrent: boolean;
  fileSizeFormatted: string;
  sourceId: string;
  sourceName: string;
}

export interface NxRomFileItem {
  path: string;
  name: string;
  sizeBytes: number;
  type: "base" | "update" | "dlc" | "switch2Dump" | "unknown";
  titleId: string | null;
  versionString: string | null;
}

export interface NxRomGame {
  id: string;
  name: string;
  titleId: string | null;
  generation: SwitchGeneration;
  folderPath: string;
  baseFilePath: string;
  files: NxRomFileItem[];
  updateCount: number;
  dlcCount: number;
  totalSizeBytes: number;
  isNup: boolean;
  isDumpFolder: boolean;
}

export interface NxPortedGame {
  name: string;
  appPath: string;
  platform: NxTargetPlatform;
  titleId: string | null;
  bundleId: string | null;
  version: string | null;
  sizeBytes: number;
  generation: SwitchGeneration;
  modificationDate: number;
}

export interface NxGameRuntimeConfig {
  enable60FPS: boolean;
  enableMetalHUD: boolean;
  isDockedMode: boolean;
  renderScale: number;
  enableMetalFXUpscale: boolean;
  enableGameMode: boolean;
  enableGamepadProfile: boolean;
  controllerProfileId: string | null;
  playerProfileIds: Record<string, string> | null;
  gameLanguage: string | null;
  // Zelda OoT Enhanced Mode & Framegen
  ootUpscalerMode: "off" | "metalfx" | "game";
  ootSharpen: number;
  ootFixedResolution: boolean;
  ootFixedScale: number;
  ootGfxScaleTier: 0 | 1 | 2;
  ootMicrophone: boolean;
  oot16GBRamMode: boolean;
  ootResolutionPreset: "normal" | "potato";
  ootExperimentalFrameGen: boolean;
  ootFrameGenMaxK: 2 | 4;
  ootMotionBlur: boolean;
}

export interface NxGamePreset {
  id: string;
  name: string;
  titleId: string | null;
  isBuiltIn: boolean;
  config: NxGameRuntimeConfig;
  createdAt: string;
  notes?: string;
}

export interface NxGameModItem {
  id: string;
  name: string;
  folderPath: string;
  isEnabled: boolean;
  hasCodePatches: boolean;
  hasAssetPatches: boolean;
  resolvedRomfsPath: string | null;
}

export interface NxBuildEstimate {
  formattedRange: string;
  isCached: boolean;
  shaderCount: number;
  speedCategory: "cached" | "fast" | "moderate" | "heavy" | "veryHeavy";
  chipName: string;
  coreCount: number;
  explanation: string;
}

export interface NxMetalToolchainInfo {
  rawVersion: string;
  shortVersion: string;
  isAvailable: boolean;
  isVerified: boolean;
}

export interface NxIosDevice {
  id: string;
  name: string;
  model: string;
  osVersion: string;
  isAvailable?: boolean;
  isUsb?: boolean;
}

export interface NxSigningTeam {
  id: string;
  name: string;
  displayName: string;
  isFreeProvisioningTeam?: boolean;
  hasCertificateInKeychain?: boolean;
}

export interface NxHubRegisteredGame {
  titleID: string;
  name: string;
  framework: string;
}

export interface NxHubStatus {
  bundleId: string;
  teamId: string;
  games: NxHubRegisteredGame[];
}

export interface NxResolvedPaths {
  nxnativePath: string;
  nxnativeValid: boolean;
  nx2androidPath: string;
  nx2androidValid: boolean;
  nxnativeRepoPath?: string;
  nx2androidRepoPath?: string;
  outputDir: string;
  defaultOutputDir: string;
  appSupportDir: string;
  defaultAppSupportDir: string;
  stagingDir: string;
  defaultStagingDir: string;
  cerberusCacheRoot: string;
  defaultCerberusCacheRoot: string;
  appBundleDir: string;
  nx2androidHomeDir: string;
  defaultNx2androidHomeDir: string;
  tempDir: string;
  outputFreeBytes: number;
  stagingFreeBytes: number;
  cacheRootFreeBytes: number;
  pythonPath?: string | null;
  pythonVersion?: string;
  hasAndroidModules?: boolean;
  metalVersion?: string;
}

export interface NxPortBuildOptions {
  shop: "switch1" | "switch2";
  objectId: string;
  gameTitle: string;
  titleId: string | null;
  gameDirectory: string;
  sourceFiles?: string[];
  platform: NxTargetPlatform;
  customOutputFolder?: string | null;
  stagingWorkDirectory?: string | null;
  appName?: string | null;
  bundleId?: string | null;
  language?: string | null;
  showFps: boolean;
  keepExtracted: boolean;
  surveyOnly: boolean;
  romfsSeparate: boolean;
  romfsSplitLimitGB: number;
  allowOtherMetal: boolean;
  androidExperimental?: boolean;
  autoDeployToIos?: boolean;
  iosDeviceId?: string | null;
  iosSigningTeamId?: string | null;
  isSwitch2?: boolean;
  isNup?: boolean;
}

export interface NxBuildJobEvent {
  jobId: string;
  objectId: string;
  shop: "switch1" | "switch2";
  gameTitle: string;
  platform: NxTargetPlatform;
  phase:
    | "start"
    | "stage"
    | "step"
    | "progress"
    | "done"
    | "error"
    | "cancelled";
  stageName?: string;
  stageIndex?: number;
  stageTotal?: number;
  step?: string;
  fraction?: number;
  doneBytes?: number;
  totalBytes?: number;
  etaSeconds?: number;
  outputPath?: string;
  error?: string;
}

export interface NxDependencyStatus {
  id: string;
  name: string;
  isAvailable: boolean;
  details: string;
  recommendation?: string;
  isProtected: boolean;
  downloadSizeBadge?: string;
  installedSizeBadge?: string;
  category: NxDependencyCategory;
}

export interface NxInstallerProgressEvent {
  action: "install" | "repair" | "uninstall" | "installAll" | "repairAll";
  dependencyId?: string;
  itemName?: string;
  phase: "start" | "output" | "item_done" | "complete";
  line?: string;
  success?: boolean;
}

export interface NxRepoInfo {
  path: string;
  isValid: boolean;
  localCommit: string;
  remoteCommit: string;
  upstreamBehindCount: number;
  isGitRepo: boolean;
  error?: string;
}

export interface NxReposStatus {
  nxnative: NxRepoInfo;
  nx2android: NxRepoInfo;
}

export interface NxProdKeysInfo {
  path: string | null;
  sourceName: string | null;
  isValid: boolean;
  firmwareSummary?: string;
  error?: string;
}

export interface NxStorageStats {
  buildCacheBytes: number;
  artworkCacheBytes: number;
  iCloudBytes: number;
  iCloudAvailable: boolean;
  iCloudSyncEnabled: boolean;
  outputFreeBytes: number;
  stagingFreeBytes: number;
}

export interface NxSystemHardwareInfo {
  chipName: string;
  coreCount: number;
  physicalRamGB: number;
  supports120Hz: boolean;
}

// --- Controller & Keyboard Profiles ---

export type SwitchButton =
  | "A"
  | "B"
  | "X"
  | "Y"
  | "L"
  | "R"
  | "ZL"
  | "ZR"
  | "Plus"
  | "Minus"
  | "L3"
  | "R3"
  | "Up"
  | "Down"
  | "Left"
  | "Right"
  | "Home"
  | "Capture";

export type MouseInputMode =
  | "auto"
  | "rightStick"
  | "nativeSwitch2"
  | "touchscreen";

export interface ControllerProfile {
  id: string;
  name: string;
  isDefault: boolean;
  targetDeviceName: string;
  gamepadBindings: Record<string, SwitchButton>;
  keyboardBindings: Record<string, SwitchButton>; // macOS virtual keycode string -> SwitchButton
  keyboardMovement: {
    up: number;
    left: number;
    down: number;
    right: number;
  };
  analogDeadzone: number;
  mouseMode: MouseInputMode;
  mouseAsRightStick: boolean;
  mouseSensitivity: number;
  mouseInvertX: boolean;
  mouseInvertY: boolean;
  mouseRightStickMode: "cursorLock" | "rightDrag";
  mouseSwitch2Enabled: boolean;
  mouseSwitch2PointerSpeed: number;
  mouseSwitch2LockCursor: boolean;
  mouseSwitch2PrimaryButton: "left" | "right";
  mouseSwitch2Side: "right" | "left";
  mouseSwitch2InvertY: boolean;
  enableRumble: boolean;
  rumbleStrength: number;
  rumbleFloorBoost: boolean;
}

export interface ControllersState {
  profiles: ControllerProfile[];
  activeProfileId: string;
  /** Player slot ("0".."7" for P1..P8) -> Profile ID */
  playerProfileIds: Record<string, string>;
}

// --- Logs ---

export type AppLogLevel = "info" | "step" | "success" | "warning" | "error";

export type AppLogSource =
  | "nxnative"
  | "nx2android"
  | "build"
  | "installer"
  | "sources"
  | "crossover"
  | "controllers"
  | "system";

export interface AppLogEntry {
  id: string;
  timestamp: string;
  level: AppLogLevel;
  source: AppLogSource;
  message: string;
}
