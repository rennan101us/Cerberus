import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Layers,
  Sliders,
  XCircle,
  Zap,
} from "lucide-react";
import type {
  Game,
  GameShop,
  MacChipFamily,
  MacChipTier,
  MacCompatibilityReport,
  MacHardwareCheckStatus,
  MacHardwareSpecs,
} from "@types";
import { Button } from "@renderer/components/button/button";
import { useToast } from "@renderer/hooks";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import {
  evaluateMacGameCompatibility,
  type PcRequirementsInput,
} from "./mac-hardware-compatibility";

export interface RedWineRecommendedSectionProps {
  gameTitle: string;
  shop?: GameShop;
  objectId?: string;
  game?: Game | null;
  pcRequirements?: PcRequirementsInput | null;
}

const parseFallbackMacHardwareSpecs = (
  chipName: string,
  ramGB: number,
  cpuCoresTotal: number
): MacHardwareSpecs => {
  const upper = chipName.toUpperCase();
  let chipFamily: MacChipFamily = "M1";
  if (/\bM5\b/.test(upper)) chipFamily = "M5";
  else if (/\bM4\b/.test(upper)) chipFamily = "M4";
  else if (/\bM3\b/.test(upper)) chipFamily = "M3";
  else if (/\bM2\b/.test(upper)) chipFamily = "M2";
  else if (/\bM1\b/.test(upper)) chipFamily = "M1";
  else if (/INTEL|CORE|XEON/.test(upper)) chipFamily = "Intel";

  let chipTier: MacChipTier = "base";
  if (/\bULTRA\b/.test(upper)) chipTier = "ultra";
  else if (/\bMAX\b/.test(upper)) chipTier = "max";
  else if (/\bPRO\b/.test(upper)) chipTier = "pro";

  const isAppleSilicon = chipFamily !== "Intel";
  const gpuCores = !isAppleSilicon
    ? null
    : chipTier === "ultra"
      ? 60
      : chipTier === "max"
        ? 32
        : chipTier === "pro"
          ? 16
          : chipFamily === "M3" || chipFamily === "M4" || chipFamily === "M5"
            ? 10
            : Math.max(8, cpuCoresTotal);

  return {
    chipName,
    chipFamily,
    chipTier,
    ramGB,
    cpuCoresTotal,
    cpuPerformanceCores: null,
    cpuEfficiencyCores: null,
    gpuCores,
    isAppleSilicon,
  };
};

const formatBackendLabel = (backend: string): string => {
  switch (backend) {
    case "d3dmetal":
      return "D3DMetal (GPTK)";
    case "dxmt":
      return "DXMT";
    case "dxvk":
      return "DXVK";
    case "wined3d":
      return "WineD3D";
    default:
      return backend.toUpperCase();
  }
};

const renderCheckStatusIcon = (status: MacHardwareCheckStatus) => {
  switch (status) {
    case "pass":
      return (
        <CheckCircle2
          size={15}
          className="red-wine-recommended__check-icon red-wine-recommended__check-icon--pass"
        />
      );
    case "warn":
      return (
        <AlertTriangle
          size={15}
          className="red-wine-recommended__check-icon red-wine-recommended__check-icon--warn"
        />
      );
    case "fail":
      return (
        <XCircle
          size={15}
          className="red-wine-recommended__check-icon red-wine-recommended__check-icon--fail"
        />
      );
  }
};

export function RedWineRecommendedSection({
  gameTitle,
  shop,
  objectId,
  game,
  pcRequirements,
}: Readonly<RedWineRecommendedSectionProps>) {
  const { showSuccessToast, showErrorToast } = useToast();
  const [report, setReport] = useState<MacCompatibilityReport | null>(null);
  const [hardware, setHardware] = useState<MacHardwareSpecs | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadHardware = async () => {
      try {
        if (typeof window.electron.getMacHardwareSpecs === "function") {
          const specs = await window.electron.getMacHardwareSpecs();
          if (!cancelled && specs) {
            setHardware(specs);
            return;
          }
        }
      } catch {
        // Fallback to nxGetSystemHardwareInfo below
      }

      try {
        if (typeof window.electron.nxGetSystemHardwareInfo === "function") {
          const nxHw = await window.electron.nxGetSystemHardwareInfo();
          if (!cancelled && nxHw) {
            setHardware(
              parseFallbackMacHardwareSpecs(
                nxHw.chipName || "Apple Silicon",
                nxHw.physicalRamGB || 16,
                nxHw.coreCount || navigator.hardwareConcurrency || 8
              )
            );
            return;
          }
        }
      } catch {
        // Final navigator fallback
      }

      if (!cancelled) {
        setHardware(
          parseFallbackMacHardwareSpecs(
            "Apple Silicon",
            16,
            navigator.hardwareConcurrency || 8
          )
        );
      }
    };

    void loadHardware();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!gameTitle) {
      setReport(null);
      return;
    }

    let cancelled = false;
    const steamAppId = shop === "steam" ? (objectId ?? null) : null;

    window.electron
      .getMacCompatibility(gameTitle, steamAppId, false)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch(() => {
        if (!cancelled) setReport(null);
      });

    return () => {
      cancelled = true;
    };
  }, [gameTitle, shop, objectId]);

  const hardwareEvaluation = useMemo(() => {
    if (!hardware || !report) return null;
    return evaluateMacGameCompatibility({
      hardware,
      report,
      pcRequirements,
    });
  }, [hardware, report, pcRequirements]);

  if (!gameTitle || !report) return null;

  const { recommendedSettings } = report;

  const handleApplySettings = async () => {
    if (!shop || !objectId) return;
    setIsApplying(true);
    try {
      await window.electron.updateCrossOverSettings(shop, objectId, {
        ...(game?.macOSCompatibility ?? {}),
        graphicsBackend: recommendedSettings.graphicsBackend,
        syncMode: recommendedSettings.syncMode,
        rosettaAvx: recommendedSettings.rosettaAvx,
      });
      showSuccessToast(
        `Configurações Red Wine (${formatBackendLabel(recommendedSettings.graphicsBackend)} + ${recommendedSettings.syncMode.toUpperCase()}) aplicadas para ${gameTitle}.`
      );
    } catch {
      showErrorToast("Não foi possível aplicar as configurações do Red Wine.");
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <SidebarSection title="Configuração Recomendada (Red Wine)">
      <div className="stats__section red-wine-recommended">
        {hardwareEvaluation && (
          <div
            className={`red-wine-recommended__deck-card red-wine-recommended__deck-card--${hardwareEvaluation.verdict}`}
          >
            <div className="red-wine-recommended__deck-header">
              <div className="red-wine-recommended__deck-badge-icon">
                {hardwareEvaluation.verdict === "verified" ? (
                  <CheckCircle2 size={20} />
                ) : hardwareEvaluation.verdict === "playable" ? (
                  <AlertTriangle size={20} />
                ) : (
                  <XCircle size={20} />
                )}
              </div>
              <div className="red-wine-recommended__deck-titles">
                <span className="red-wine-recommended__deck-title">
                  {hardwareEvaluation.verdictTitle}
                </span>
                <span className="red-wine-recommended__deck-subtitle">
                  {hardwareEvaluation.verdictSubtitle}
                </span>
              </div>
            </div>

            <div className="red-wine-recommended__checks-grid">
              {hardwareEvaluation.checks.map((item) => (
                <div
                  key={item.key}
                  className={`red-wine-recommended__check-item red-wine-recommended__check-item--${item.status}`}
                  title={item.reason}
                >
                  <div className="red-wine-recommended__check-top">
                    {renderCheckStatusIcon(item.status)}
                    <span className="red-wine-recommended__check-label">
                      {item.label}
                    </span>
                  </div>
                  <strong className="red-wine-recommended__check-value">
                    {item.userValue}
                  </strong>
                  <span className="red-wine-recommended__check-target">
                    {item.targetValue}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="stats__category">
          <p className="stats__category-title">
            <Layers size={16} />
            Backend
          </p>
          <p>{formatBackendLabel(recommendedSettings.graphicsBackend)}</p>
        </div>

        <div className="stats__category">
          <p className="stats__category-title">
            <Zap size={16} />
            Sincronização
          </p>
          <p>{recommendedSettings.syncMode.toUpperCase()}</p>
        </div>

        <div className="stats__category">
          <p className="stats__category-title">
            <Cpu size={16} />
            Rosetta AVX
          </p>
          <p>{recommendedSettings.rosettaAvx ? "Ativado" : "Desativado"}</p>
        </div>

        {recommendedSettings.notes.length > 0 && (
          <ul className="red-wine-recommended__notes">
            {recommendedSettings.notes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        )}

        {game && shop && objectId && window.electron.platform === "darwin" && (
          <Button
            theme="primary"
            onClick={() => void handleApplySettings()}
            disabled={isApplying}
            className="red-wine-recommended__apply-btn"
          >
            <Sliders size={14} />
            {isApplying ? "Aplicando..." : "Aplicar no Red Wine"}
          </Button>
        )}
      </div>
    </SidebarSection>
  );
}
