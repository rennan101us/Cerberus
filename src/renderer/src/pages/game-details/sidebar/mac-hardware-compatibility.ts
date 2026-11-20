import type {
  MacChipFamily,
  MacChipTier,
  MacCompatibilityCheckItem,
  MacCompatibilityReport,
  MacDeckVerdict,
  MacHardwareCheckStatus,
  MacHardwareCompatibilityEvaluation,
  MacHardwareSpecs,
} from "@types";

export interface PcRequirementsInput {
  minimum?: string | null;
  recommended?: string | null;
}

export interface ParsedRequirementThresholds {
  minRamGB: number;
  recRamGB: number;
  minCpuCores: number;
  recCpuCores: number;
  minGpuCores: number;
  recGpuCores: number;
  hasExplicitRequirements: boolean;
}

const stripHtml = (html?: string | null): string => {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const parseRamGBFromText = (text: string): number | null => {
  if (!text) return null;

  const ramContextRegex =
    /(?:memory|memória|ram)[^0-9]{0,25}(\d{1,3})\s*(gb|mb)\b/i;
  const contextMatch = text.match(ramContextRegex);
  if (contextMatch) {
    const val = Number(contextMatch[1]);
    const unit = contextMatch[2].toUpperCase();
    if (unit === "MB") return Math.max(1, Math.round(val / 1024));
    if (val >= 1 && val <= 128) return val;
  }

  const inlineRamRegex = /\b(\d{1,2})\s*GB\s*(?:de\s*)?RAM\b/i;
  const inlineMatch = text.match(inlineRamRegex);
  if (inlineMatch) {
    const val = Number(inlineMatch[1]);
    if (val >= 1 && val <= 128) return val;
  }

  return null;
};

const parseCpuCoresFromText = (text: string): number | null => {
  if (!text) return null;
  const lower = text.toLowerCase();

  const explicitCoreMatch = lower.match(/\b(\d{1,2})\s*[-\s]?cores?\b/i);
  if (explicitCoreMatch) {
    const val = Number(explicitCoreMatch[1]);
    if (val >= 1 && val <= 32) return val;
  }

  if (/\bocta[-\s]?core\b/i.test(lower)) return 8;
  if (/\bhexa[-\s]?core\b/i.test(lower)) return 6;
  if (/\bquad[-\s]?core\b/i.test(lower)) return 4;
  if (/\bdual[-\s]?core\b/i.test(lower)) return 2;

  // Infer from well-known Intel / AMD desktop CPU families
  if (
    /\b(?:core\s*i9|ryzen\s*9|ryzen\s*7|core\s*i7[-\s]?(?:97|107|117|127|137|147))\d*\b/i.test(
      lower
    )
  ) {
    return 8;
  }
  if (
    /\b(?:ryzen\s*5|core\s*i5[-\s]?(?:84|86|94|96|104|106|114|116|124|126|134|144)\d*|core\s*i7)\b/i.test(
      lower
    )
  ) {
    return 6;
  }
  if (/\b(?:core\s*i5|ryzen\s*3|core\s*i3)\b/i.test(lower)) {
    return 4;
  }

  return null;
};

const parseGpuCoresFromText = (text: string): number | null => {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Heavy current-gen GPUs -> recommend Pro/Max GPU core counts (14-16+)
  if (
    /\b(?:rtx\s*(?:3080|3090|4070|4080|4090)|rx\s*(?:6800|6900|7800|7900))\b/i.test(
      lower
    )
  ) {
    return 14;
  }

  // Mid-range modern DX12 GPUs -> 10 GPU cores (M3/M4 base or M1/M2 Pro)
  if (
    /\b(?:rtx\s*(?:2060|2070|2080|3060|3070|4060)|rx\s*(?:5700|6600|6700|7600)|gtx\s*(?:1080|1660)|arc\s*a7)\b/i.test(
      lower
    )
  ) {
    return 10;
  }

  // Mainstream DX11/DX12 GPUs -> 8 GPU cores (M1/M2/M3/M4 base)
  if (
    /\b(?:gtx\s*(?:970|980|1050|1060|1070|1650)|rx\s*(?:470|480|570|580|590|5500|5600))\b/i.test(
      lower
    )
  ) {
    return 8;
  }

  // Older / light GPUs -> 7 GPU cores
  if (/\b(?:gtx\s*(?:660|750|760|770|950|960)|hd\s*7\d{3}|gt\s*1030)\b/i.test(lower)) {
    return 7;
  }

  // Fallback check on VRAM mentions (e.g., 8 GB VRAM -> 10 cores, 6 GB -> 8 cores)
  const vramMatch = lower.match(
    /(?:graphics|video|vram|placa de vídeo)[^0-9]{0,30}(\d{1,2})\s*gb\b/i
  );
  if (vramMatch) {
    const vram = Number(vramMatch[1]);
    if (vram >= 10) return 14;
    if (vram >= 6) return 10;
    if (vram >= 4) return 8;
  }

  return null;
};

export function parseGameHardwareThresholds(
  pcRequirements?: PcRequirementsInput | null,
  report?: MacCompatibilityReport | null
): ParsedRequirementThresholds {
  const minText = stripHtml(pcRequirements?.minimum);
  const recText = stripHtml(pcRequirements?.recommended);

  const parsedMinRam = parseRamGBFromText(minText);
  const parsedRecRam = parseRamGBFromText(recText);

  const parsedMinCpu = parseCpuCoresFromText(minText);
  const parsedRecCpu = parseCpuCoresFromText(recText);

  const parsedMinGpu = parseGpuCoresFromText(minText);
  const parsedRecGpu = parseGpuCoresFromText(recText);

  const hasExplicitRequirements = Boolean(
    parsedMinRam ||
      parsedRecRam ||
      parsedMinCpu ||
      parsedRecCpu ||
      parsedMinGpu ||
      parsedRecGpu
  );

  const usesD3DMetal =
    !report || report.recommendedSettings.graphicsBackend === "d3dmetal";

  // Unified memory needs headroom for Wine + D3DMetal translation when game asks >= 12 GB
  const minRamGB = parsedMinRam ?? 8;
  const rawRecRam =
    parsedRecRam ?? (parsedMinRam ? Math.max(parsedMinRam, 12) : 16);
  const recRamGB =
    usesD3DMetal && rawRecRam >= 12 ? Math.max(16, rawRecRam) : rawRecRam;

  const minCpuCores = parsedMinCpu ?? 6;
  const recCpuCores =
    parsedRecCpu ?? (parsedMinCpu ? Math.max(parsedMinCpu, 8) : 8);

  const minGpuCores = parsedMinGpu ?? 7;
  const recGpuCores =
    parsedRecGpu ??
    (parsedMinGpu ? Math.max(parsedMinGpu, 8) : usesD3DMetal ? 10 : 8);

  return {
    minRamGB,
    recRamGB: Math.max(minRamGB, recRamGB),
    minCpuCores,
    recCpuCores: Math.max(minCpuCores, recCpuCores),
    minGpuCores,
    recGpuCores: Math.max(minGpuCores, recGpuCores),
    hasExplicitRequirements,
  };
}

const getChipRank = (family: MacChipFamily, tier: MacChipTier): number => {
  const familyBase: Record<MacChipFamily, number> = {
    Intel: 0,
    Unknown: 5,
    M1: 10,
    M2: 14,
    M3: 18,
    M4: 22,
    M5: 26,
  };
  const tierBonus: Record<MacChipTier, number> = {
    unknown: 0,
    base: 0,
    pro: 5,
    max: 10,
    ultra: 16,
  };
  return (familyBase[family] ?? 0) + (tierBonus[tier] ?? 0);
};

const parseReportedChipRank = (chipsetLabel: string): number => {
  const upper = chipsetLabel.toUpperCase();
  let family: MacChipFamily = "Unknown";
  if (/\bM5\b/.test(upper)) family = "M5";
  else if (/\bM4\b/.test(upper)) family = "M4";
  else if (/\bM3\b/.test(upper)) family = "M3";
  else if (/\bM2\b/.test(upper)) family = "M2";
  else if (/\bM1\b/.test(upper)) family = "M1";

  let tier: MacChipTier = "base";
  if (/\bULTRA\b/.test(upper)) tier = "ultra";
  else if (/\bMAX\b/.test(upper)) tier = "max";
  else if (/\bPRO\b/.test(upper)) tier = "pro";

  return getChipRank(family, tier);
};

export function evaluateMacGameCompatibility(options: {
  hardware: MacHardwareSpecs;
  report: MacCompatibilityReport;
  pcRequirements?: PcRequirementsInput | null;
}): MacHardwareCompatibilityEvaluation {
  const { hardware, report, pcRequirements } = options;
  const thresholds = parseGameHardwareThresholds(pcRequirements, report);

  // 1. Evaluate Chip (Apple Silicon generation + community reports)
  let chipStatus: MacHardwareCheckStatus = "pass";
  let chipTarget = "Apple Silicon (M1+)";
  let chipReason = `${hardware.chipName} possui suporte nativo a D3DMetal e Rosetta 2.`;

  const userChipRank = getChipRank(hardware.chipFamily, hardware.chipTier);
  const matchingChipReport = report.chipsets.find(
    (c) =>
      c.chipset.toUpperCase() ===
        hardware.chipName.replace(/^Apple\s+/i, "").toUpperCase() ||
      hardware.chipName.toUpperCase().includes(c.chipset.toUpperCase())
  );

  const lowerOrEqualChipPassingReport = report.chipsets.find((c) => {
    const reportedRank = parseReportedChipRank(c.chipset);
    return (
      reportedRank <= userChipRank &&
      (c.medianFps === null || c.medianFps === undefined || c.medianFps >= 40)
    );
  });

  if (!hardware.isAppleSilicon || hardware.chipFamily === "Intel") {
    chipStatus = "fail";
    chipReason =
      "Processadores Intel não suportam aceleração D3DMetal (Game Porting Toolkit) no Red Wine.";
  } else if (report.overallRating === "UNPLAYABLE") {
    chipStatus = "fail";
    chipReason =
      "Relatórios indicam que este jogo possui bloqueios (ex: Anti-Cheat) ou falhas críticas no Red Wine.";
  } else if (matchingChipReport) {
    chipTarget = `Relatos em ${matchingChipReport.chipset}`;
    if (
      matchingChipReport.medianFps &&
      matchingChipReport.medianFps < 30
    ) {
      chipStatus = "warn";
      chipReason = `Relatos em ${matchingChipReport.chipset} apontam média de ~${matchingChipReport.medianFps} FPS.`;
    } else {
      chipStatus = "pass";
      chipReason = matchingChipReport.medianFps
        ? `Testado pela comunidade no ${matchingChipReport.chipset} (~${matchingChipReport.medianFps} FPS).`
        : `Confirmado pela comunidade em ${matchingChipReport.chipset} (${matchingChipReport.reports} relato(s)).`;
    }
  } else if (report.overallRating === "PLAYABLE") {
    chipStatus = lowerOrEqualChipPassingReport ? "pass" : "warn";
    chipReason =
      "Jogável no Apple Silicon, podendo exigir ajustes gráficos ou de sincronização.";
  } else if (lowerOrEqualChipPassingReport) {
    chipStatus = "pass";
    chipReason = `Superior ou equivalente ao chip ${lowerOrEqualChipPassingReport.chipset} verificado nos relatos.`;
  }

  const chipCheck: MacCompatibilityCheckItem = {
    key: "chip",
    label: "Chip",
    userValue: hardware.chipName.replace(/^Apple\s+/i, "Apple "),
    targetValue: chipTarget,
    status: chipStatus,
    reason: chipReason,
  };

  // 2. Evaluate RAM (Unified Memory)
  let ramStatus: MacHardwareCheckStatus = "pass";
  let ramReason = `${hardware.ramGB} GB de memória unificada atendem ao recomendado (${thresholds.recRamGB} GB).`;

  if (hardware.ramGB < thresholds.minRamGB) {
    ramStatus = "fail";
    ramReason = `Seu Mac possui ${hardware.ramGB} GB de RAM, abaixo do mínimo exigido (${thresholds.minRamGB} GB).`;
  } else if (hardware.ramGB < thresholds.recRamGB) {
    ramStatus = "warn";
    ramReason = `Seu Mac possui ${hardware.ramGB} GB (Mínimo: ${thresholds.minRamGB} GB / Recomendado no Red Wine: ${thresholds.recRamGB} GB).`;
  }

  const ramCheck: MacCompatibilityCheckItem = {
    key: "ram",
    label: "RAM",
    userValue: `${hardware.ramGB} GB`,
    targetValue: `${thresholds.recRamGB} GB rec.`,
    status: ramStatus,
    reason: ramReason,
  };

  // 3. Evaluate CPU Cores
  let cpuStatus: MacHardwareCheckStatus = "pass";
  const coreBreakdown =
    hardware.cpuPerformanceCores && hardware.cpuEfficiencyCores
      ? `${hardware.cpuCoresTotal} Cores (${hardware.cpuPerformanceCores}P+${hardware.cpuEfficiencyCores}E)`
      : `${hardware.cpuCoresTotal} Cores`;

  let cpuReason = `${coreBreakdown} superam ou atendem à recomendação (${thresholds.recCpuCores}+ núcleos).`;
  if (hardware.cpuCoresTotal < thresholds.minCpuCores) {
    cpuStatus = "fail";
    cpuReason = `${hardware.cpuCoresTotal} núcleos detectados; o jogo requer ao menos ${thresholds.minCpuCores} núcleos.`;
  } else if (hardware.cpuCoresTotal < thresholds.recCpuCores) {
    cpuStatus = "warn";
    cpuReason = `${hardware.cpuCoresTotal} núcleos atendem ao mínimo (${thresholds.minCpuCores}), abaixo do recomendado (${thresholds.recCpuCores}).`;
  }

  const cpuCheck: MacCompatibilityCheckItem = {
    key: "cpuCores",
    label: "CPU Cores",
    userValue: `${hardware.cpuCoresTotal} Cores`,
    targetValue: `${thresholds.recCpuCores}+ Cores`,
    status: cpuStatus,
    reason: cpuReason,
  };

  // 4. Evaluate GPU Cores
  let gpuStatus: MacHardwareCheckStatus = "pass";
  const detectedGpuCores = hardware.gpuCores ?? 8;
  const gpuUserValue = hardware.gpuCores
    ? `${hardware.gpuCores} Cores`
    : "Metal GPU";

  let gpuReason = `GPU Apple de ${detectedGpuCores} núcleos atende ao perfil recomendado (${thresholds.recGpuCores}+ núcleos).`;
  if (!hardware.isAppleSilicon) {
    gpuStatus = "fail";
    gpuReason = "GPU sem suporte a Apple Silicon D3DMetal.";
  } else if (detectedGpuCores < thresholds.minGpuCores) {
    gpuStatus = "fail";
    gpuReason = `GPU de ${detectedGpuCores} núcleos fica abaixo do mínimo estimado (${thresholds.minGpuCores} núcleos).`;
  } else if (detectedGpuCores < thresholds.recGpuCores) {
    gpuStatus = "warn";
    gpuReason = `GPU de ${detectedGpuCores} núcleos atende ao mínimo (${thresholds.minGpuCores}), mas ${thresholds.recGpuCores}+ núcleos são recomendados.`;
  }

  const gpuCheck: MacCompatibilityCheckItem = {
    key: "gpuCores",
    label: "GPU Cores",
    userValue: gpuUserValue,
    targetValue: `${thresholds.recGpuCores}+ Cores`,
    status: gpuStatus,
    reason: gpuReason,
  };

  const checks: MacCompatibilityCheckItem[] = [
    chipCheck,
    ramCheck,
    cpuCheck,
    gpuCheck,
  ];

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");

  let verdict: MacDeckVerdict = "verified";
  let verdictTitle = "Compatível com seu Mac";
  let verdictSubtitle = `Hardware verificado para ${hardware.chipName} (${hardware.ramGB} GB)`;

  if (hasFail) {
    verdict = "unsupported";
    verdictTitle =
      report.overallRating === "UNPLAYABLE"
        ? "Incompatível no Red Wine"
        : "Abaixo dos Requisitos no seu Mac";
    const failedLabels = checks
      .filter((c) => c.status === "fail")
      .map((c) => c.label)
      .join(", ");
    verdictSubtitle = `Limitação detectada em: ${failedLabels}`;
  } else if (hasWarn) {
    verdict = "playable";
    verdictTitle = "Jogável no seu Mac";
    const warnLabels = checks
      .filter((c) => c.status === "warn")
      .map((c) => c.label)
      .join(", ");
    verdictSubtitle = `Requer atenção em: ${warnLabels} (${hardware.chipName})`;
  }

  return {
    verdict,
    verdictTitle,
    verdictSubtitle,
    checks,
  };
}
