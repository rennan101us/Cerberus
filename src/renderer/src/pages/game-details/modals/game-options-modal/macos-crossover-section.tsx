import { useState, useEffect, useCallback } from "react";
import {
  Button,
  CheckboxField,
  SelectField,
  TextField,
  ProgressBar,
} from "@renderer/components";
import type {
  LibraryGame,
  CrossOverStatus,
  CrossOverGraphicsBackend,
  CrossOverSyncMode,
  CrossOverProvisionProgress,
} from "@types";
import {
  SyncIcon,
  CheckCircleIcon,
  DownloadIcon,
} from "@primer/octicons-react";
import "./macos-crossover-section.scss";

interface MacOsCrossOverSectionProps {
  game: LibraryGame;
  onUpdateGame?: () => void;
}

export function MacOsCrossOverSection({
  game,
  onUpdateGame,
}: Readonly<MacOsCrossOverSectionProps>) {
  const [status, setStatus] = useState<CrossOverStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Settings
  const initialCompat = game.macOSCompatibility;
  const [bottleName, setBottleName] = useState(
    initialCompat?.bottleName || "HydraGames"
  );
  const [graphicsBackend, setGraphicsBackend] =
    useState<CrossOverGraphicsBackend>(
      initialCompat?.graphicsBackend ?? "d3dmetal"
    );
  const [syncMode, setSyncMode] = useState<CrossOverSyncMode>(
    initialCompat?.syncMode ?? "msync"
  );
  const [highRes, setHighRes] = useState(
    initialCompat?.highResolutionMode ?? false
  );
  const [metalHud, setMetalHud] = useState(initialCompat?.metalHud ?? false);
  const [rosettaAvx, setRosettaAvx] = useState(
    initialCompat?.rosettaAvx ?? true
  );

  const envString = Object.entries(initialCompat?.environmentVariables ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const [envVars, setEnvVars] = useState(envString);

  // CrossOver operations state
  const [provisionProgress, setProvisionProgress] =
    useState<CrossOverProvisionProgress | null>(null);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [trialMessage, setTrialMessage] = useState<string | null>(null);
  const [newBottleInput, setNewBottleInput] = useState("");
  const [showNewBottle, setShowNewBottle] = useState(false);

  const fetchStatus = useCallback(
    async (forceRefresh = false) => {
      try {
        setLoadingStatus(true);
        const res =
          await globalThis.window.electron.getCrossOverStatus(forceRefresh);
        setStatus(res);
        if (!initialCompat?.bottleName && res.defaultBottle) {
          setBottleName(res.defaultBottle);
        }
      } catch {
        // ignore
      } finally {
        setLoadingStatus(false);
      }
    },
    [initialCompat?.bottleName]
  );

  useEffect(() => {
    fetchStatus();

    const unsubscribe = globalThis.window.electron.onCrossOverProvisionProgress(
      (progress) => {
        setProvisionProgress(progress);
        if (progress.phase === "done" || progress.phase === "error") {
          setIsProvisioning(false);
          fetchStatus(true);
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [fetchStatus]);

  const handleSaveSettings = async (overrides?: {
    bottle?: string;
    backend?: CrossOverGraphicsBackend;
    sync?: CrossOverSyncMode;
    highResolution?: boolean;
    hud?: boolean;
    avx?: boolean;
    env?: string;
  }) => {
    const targetBottle = overrides?.bottle ?? bottleName;
    const targetBackend = overrides?.backend ?? graphicsBackend;
    const targetSync = overrides?.sync ?? syncMode;
    const targetHighRes = overrides?.highResolution ?? highRes;
    const targetHud = overrides?.hud ?? metalHud;
    const targetAvx = overrides?.avx ?? rosettaAvx;
    const targetEnv = overrides?.env ?? envVars;

    const parsedEnv: Record<string, string> = {};
    for (const line of targetEnv.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (key) parsedEnv[key] = val;
      }
    }

    try {
      await globalThis.window.electron.updateCrossOverSettings(
        game.shop,
        game.objectId,
        {
          bottleName: targetBottle,
          graphicsBackend: targetBackend,
          syncMode: targetSync,
          highResolutionMode: targetHighRes,
          metalHud: targetHud,
          rosettaAvx: targetAvx,
          environmentVariables: parsedEnv,
        }
      );
      onUpdateGame?.();
    } catch {
      // ignore
    }
  };

  const handleInstallCrossOver = async () => {
    setIsProvisioning(true);
    setProvisionProgress({
      phase: "checking",
      progress: 0,
      message: "Starting CrossOver installation...",
    });
    try {
      await globalThis.window.electron.installCrossOverDemo();
    } catch (err) {
      setProvisionProgress({
        phase: "error",
        progress: 0,
        error: err instanceof Error ? err.message : "Installation failed",
      });
      setIsProvisioning(false);
    }
  };

  const handleResetTrial = async () => {
    try {
      const res = await globalThis.window.electron.resetCrossOverTrial();
      setTrialMessage(res.message);
      setTimeout(() => setTrialMessage(null), 4000);
    } catch {
      setTrialMessage("Trial reset failed");
      setTimeout(() => setTrialMessage(null), 4000);
    }
  };

  const handleCreateBottle = async () => {
    if (!newBottleInput.trim()) return;
    try {
      const res = await globalThis.window.electron.createCrossOverBottle(
        newBottleInput.trim()
      );
      if (res.bottleDir) {
        setBottleName(newBottleInput.trim());
        setShowNewBottle(false);
        setNewBottleInput("");
        await fetchStatus(true);
        handleSaveSettings({ bottle: newBottleInput.trim() });
      }
    } catch {
      // ignore
    }
  };

  const bottleOptions = (status?.bottles ?? ["HydraGames"]).map((b) => ({
    key: b,
    value: b,
    label: b === "HydraGames" ? `${b} (Default)` : b,
  }));

  return (
    <div className="macos-crossover-section">
      {/* 1. Fine Wine Status & Provisioning */}
      <div className="macos-crossover-section__card">
        <div className="macos-crossover-section__card-header">
          <div>
            <h4 className="macos-crossover-section__card-title">
              Fine Wine Engine
            </h4>
            <p className="macos-crossover-section__card-desc">
              Executes Windows (.exe) games and repacks natively on Apple
              Silicon
            </p>
          </div>
          <div className="macos-crossover-section__status-row">
            {loadingStatus ? (
              <span className="macos-crossover-section__status-badge">
                Checking...
              </span>
            ) : status?.installed ? (
              <span className="macos-crossover-section__status-badge macos-crossover-section__status-badge--installed">
                Fine Wine {status.version ? `v${status.version}` : "(Ready)"}
              </span>
            ) : (
              <span className="macos-crossover-section__status-badge macos-crossover-section__status-badge--missing">
                Not Setup
              </span>
            )}

            {status?.updateAvailable && (
              <span className="macos-crossover-section__status-badge macos-crossover-section__status-badge--update">
                Update available (v{status.latestVersion})
              </span>
            )}
          </div>
        </div>

        {/* Progress box if downloading/installing */}
        {isProvisioning && provisionProgress && (
          <div className="macos-crossover-section__progress-box">
            <span style={{ fontSize: "12px", color: "#ffffff" }}>
              {provisionProgress.message || "Working..."}
            </span>
            <ProgressBar
              now={provisionProgress.progress}
              max={100}
              label="Fine Wine setup progress"
              completed={provisionProgress.progress === 100}
            />
          </div>
        )}

        <div className="macos-crossover-section__actions">
          {!status?.installed ? (
            <Button
              theme="outline"
              onClick={handleInstallCrossOver}
              disabled={isProvisioning}
            >
              <span style={{ marginRight: "6px", display: "inline-flex" }}>
                <DownloadIcon size={14} />
              </span>
              Download & Setup Fine Wine
            </Button>
          ) : status.updateAvailable ? (
            <Button
              theme="outline"
              onClick={handleInstallCrossOver}
              disabled={isProvisioning}
            >
              <span style={{ marginRight: "6px", display: "inline-flex" }}>
                <SyncIcon size={14} />
              </span>
              Update Fine Wine Engine (v{status.latestVersion})
            </Button>
          ) : null}

          <Button
            theme="outline"
            onClick={handleResetTrial}
            disabled={!status?.installed}
          >
            <span style={{ marginRight: "6px", display: "inline-flex" }}>
              <CheckCircleIcon size={14} />
            </span>
            Fine Reset
          </Button>

          {trialMessage && (
            <span style={{ fontSize: "12px", color: "#10b981" }}>
              {trialMessage}
            </span>
          )}
        </div>
      </div>

      {/* 2. Bottle Selection */}
      <div className="macos-crossover-section__card">
        <h4 className="macos-crossover-section__card-title">
          Fine Wine Environment (Bottle)
        </h4>
        <p className="macos-crossover-section__card-desc">
          Windows virtual environment containing your game files and libraries
        </p>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <SelectField
              label="Selected Environment"
              value={bottleName}
              options={bottleOptions}
              onChange={(e) => {
                setBottleName(e.target.value);
                handleSaveSettings({ bottle: e.target.value });
              }}
            />
          </div>
          <Button
            theme="outline"
            style={{ marginTop: "22px" }}
            onClick={() => setShowNewBottle(!showNewBottle)}
          >
            {showNewBottle ? "Cancel" : "+ New Environment"}
          </Button>
        </div>

        {showNewBottle && (
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            <div style={{ flex: 1 }}>
              <TextField
                placeholder="New environment name (e.g. RPGs, Steam)"
                value={newBottleInput}
                onChange={(e) => setNewBottleInput(e.target.value)}
              />
            </div>
            <Button theme="outline" onClick={handleCreateBottle}>
              Create
            </Button>
          </div>
        )}

        {status?.bottlesDir && (
          <span style={{ fontSize: "11px", color: "#777777" }}>
            Environment path: {status.bottlesDir}/{bottleName}
          </span>
        )}
      </div>

      {/* 3. Graphics Backend */}
      <div className="macos-crossover-section__card">
        <h4 className="macos-crossover-section__card-title">
          Graphics Backend
        </h4>
        <p className="macos-crossover-section__card-desc">
          Choose the DirectX translation layer for Apple Silicon Metal
        </p>

        <div className="macos-crossover-section__grid">
          <button
            type="button"
            className={`macos-crossover-section__option-card ${
              graphicsBackend === "d3dmetal"
                ? "macos-crossover-section__option-card--selected"
                : ""
            }`}
            onClick={() => {
              setGraphicsBackend("d3dmetal");
              handleSaveSettings({ backend: "d3dmetal" });
            }}
          >
            <div className="macos-crossover-section__option-title">
              D3DMetal (Apple GPTK)
            </div>
            <div className="macos-crossover-section__option-desc">
              DirectX 11 / 12 to Metal translation by Apple. Best performance
              and compatibility for modern AAA titles.
            </div>
          </button>

          <button
            type="button"
            className={`macos-crossover-section__option-card ${
              graphicsBackend === "dxmt"
                ? "macos-crossover-section__option-card--selected"
                : ""
            }`}
            onClick={() => {
              setGraphicsBackend("dxmt");
              handleSaveSettings({ backend: "dxmt" });
            }}
          >
            <div className="macos-crossover-section__option-title">DXMT</div>
            <div className="macos-crossover-section__option-desc">
              DirectX 11 to Metal translation. High performance alternative with
              NVEXT support.
            </div>
          </button>

          <button
            type="button"
            className={`macos-crossover-section__option-card ${
              graphicsBackend === "dxvk"
                ? "macos-crossover-section__option-card--selected"
                : ""
            }`}
            onClick={() => {
              setGraphicsBackend("dxvk");
              handleSaveSettings({ backend: "dxvk" });
            }}
          >
            <div className="macos-crossover-section__option-title">DXVK</div>
            <div className="macos-crossover-section__option-desc">
              Vulkan-based translation via MoltenVK. Ideal for DirectX 9, 10,
              and older DirectX 11 games.
            </div>
          </button>

          <button
            type="button"
            className={`macos-crossover-section__option-card ${
              graphicsBackend === "wined3d"
                ? "macos-crossover-section__option-card--selected"
                : ""
            }`}
            onClick={() => {
              setGraphicsBackend("wined3d");
              handleSaveSettings({ backend: "wined3d" });
            }}
          >
            <div className="macos-crossover-section__option-title">WineD3D</div>
            <div className="macos-crossover-section__option-desc">
              Standard built-in Wine OpenGL/Metal layer. Highest compatibility
              for legacy titles.
            </div>
          </button>
        </div>
      </div>

      {/* 4. Synchronization Engine */}
      <div className="macos-crossover-section__card">
        <h4 className="macos-crossover-section__card-title">
          Synchronization Mode
        </h4>
        <p className="macos-crossover-section__card-desc">
          Controls thread synchronization between Windows APIs and macOS Darwin
          kernel
        </p>

        <div className="macos-crossover-section__grid">
          <button
            type="button"
            className={`macos-crossover-section__option-card ${
              syncMode === "msync"
                ? "macos-crossover-section__option-card--selected"
                : ""
            }`}
            onClick={() => {
              setSyncMode("msync");
              handleSaveSettings({ sync: "msync" });
            }}
          >
            <div className="macos-crossover-section__option-title">
              MSync (Mach Ports) - Recommended
            </div>
            <div className="macos-crossover-section__option-desc">
              Native Apple Mach semaphore synchronization. Provides highest FPS
              and eliminates CPU thread bottlenecks.
            </div>
          </button>

          <button
            type="button"
            className={`macos-crossover-section__option-card ${
              syncMode === "esync"
                ? "macos-crossover-section__option-card--selected"
                : ""
            }`}
            onClick={() => {
              setSyncMode("esync");
              handleSaveSettings({ sync: "esync" });
            }}
          >
            <div className="macos-crossover-section__option-title">
              ESync (Eventfd)
            </div>
            <div className="macos-crossover-section__option-desc">
              Eventfd-based synchronization. Compatible with games that exhibit
              race conditions under MSync.
            </div>
          </button>
        </div>
      </div>

      {/* 5. Display & Performance Flags */}
      <div className="macos-crossover-section__card">
        <h4 className="macos-crossover-section__card-title">
          Performance & Display Flags
        </h4>
        <div className="macos-crossover-section__flags">
          <CheckboxField
            label="High-Resolution Mode (Retina)"
            checked={highRes}
            onChange={(e) => {
              setHighRes(e.target.checked);
              handleSaveSettings({ highResolution: e.target.checked });
            }}
          />
          <CheckboxField
            label="Metal Performance HUD (Real-time FPS, Frame Time, and GPU Load)"
            checked={metalHud}
            onChange={(e) => {
              setMetalHud(e.target.checked);
              handleSaveSettings({ hud: e.target.checked });
            }}
          />
          <CheckboxField
            label="Rosetta AVX Emulation (Required for modern titles with AVX instruction sets)"
            checked={rosettaAvx}
            onChange={(e) => {
              setRosettaAvx(e.target.checked);
              handleSaveSettings({ avx: e.target.checked });
            }}
          />
        </div>
      </div>

      {/* 6. Custom Environment Variables */}
      <div className="macos-crossover-section__card">
        <h4 className="macos-crossover-section__card-title">
          Environment Variables
        </h4>
        <p className="macos-crossover-section__card-desc">
          Add custom environment variables in KEY=VALUE format (one per line)
        </p>
        <textarea
          className="macos-crossover-section__env-textarea"
          value={envVars}
          placeholder="MVK_CONFIG_LOG_LEVEL=1&#10;WINE_SIMULATE_WRITECOPY=1"
          onChange={(e) => setEnvVars(e.target.value)}
          onBlur={() => handleSaveSettings({ env: envVars })}
        />
      </div>
    </div>
  );
}
