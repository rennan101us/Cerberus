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
