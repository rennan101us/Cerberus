import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MacCompatibilityReport, MacHardwareSpecs } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as compatModule from "./mac-hardware-compatibility.ts";

const { evaluateMacGameCompatibility, parseGameHardwareThresholds } =
  compatModule;

const createReport = (
  overrides: Partial<MacCompatibilityReport> = {}
): MacCompatibilityReport => ({
  gameTitle: "Cyberpunk 2077",
  steamAppId: "1091500",
  overallRating: "VERY_GOOD",
  summaryText: "Red Wine: roda very good com mediana de 58 FPS.",
  medianFps: 58,
  crossoverReportCount: 12,
  totalReportCount: 15,
  latestCrossoverVersion: "v26.0",
  chipsets: [
    { chipset: "M3 Pro", reports: 5, medianFps: 60 },
    { chipset: "M4", reports: 4, medianFps: 55 },
  ],
  recommendedSettings: {
    graphicsBackend: "d3dmetal",
    syncMode: "msync",
    rosettaAvx: true,
    notes: [],
  },
  sources: {
    macgamingdb: {
      id: "macgamingdb",
      name: "MacGamingDB",
      url: "https://macgamingdb.app",
      ratingLabel: "VERY GOOD",
      found: true,
    },
    codeweavers: {
      id: "codeweavers",
      name: "CodeWeavers",
      url: "https://codeweavers.com",
      ratingLabel: "4/5 Estrelas",
      found: true,
    },
    applegamingwiki: {
      id: "applegamingwiki",
      name: "AppleGamingWiki",
      url: "https://applegamingwiki.com",
      ratingLabel: "Perfect",
      found: true,
    },
  },
  comments: [],
  updatedAt: Date.now(),
  ...overrides,
});

const createHardware = (
  overrides: Partial<MacHardwareSpecs> = {}
): MacHardwareSpecs => ({
  chipName: "Apple M4",
  chipFamily: "M4",
  chipTier: "base",
  ramGB: 16,
  cpuCoresTotal: 10,
  cpuPerformanceCores: 4,
  cpuEfficiencyCores: 6,
  gpuCores: 10,
  isAppleSilicon: true,
  ...overrides,
});

describe("parseGameHardwareThresholds", () => {
  it("extracts RAM, CPU cores and GPU cores from Steam HTML pc_requirements", () => {
    const thresholds = parseGameHardwareThresholds(
      {
        minimum:
          "<strong>Minimum:</strong><br><ul><li><strong>Processor:</strong> Intel Core i5-8400 or AMD Ryzen 3 3300X</li><li><strong>Memory:</strong> 12 GB RAM</li><li><strong>Graphics:</strong> NVIDIA GeForce GTX 1060 6GB</li></ul>",
        recommended:
          "<strong>Recommended:</strong><br><ul><li><strong>Processor:</strong> Intel Core i7-12700 or Ryzen 7 7800X3D (8-core)</li><li><strong>Memory:</strong> 16 GB RAM</li><li><strong>Graphics:</strong> NVIDIA GeForce RTX 2060 SUPER</li></ul>",
      },
      createReport()
    );

    assert.equal(thresholds.minRamGB, 12);
    assert.equal(thresholds.recRamGB, 16);
    assert.equal(thresholds.minCpuCores, 6);
    assert.equal(thresholds.recCpuCores, 8);
    assert.equal(thresholds.minGpuCores, 8);
    assert.equal(thresholds.recGpuCores, 10);
    assert.equal(thresholds.hasExplicitRequirements, true);
  });
});

describe("evaluateMacGameCompatibility", () => {
  it("returns 'verified' when Chip, RAM, CPU Cores and GPU Cores meet or exceed recommended targets", () => {
    const evaluation = evaluateMacGameCompatibility({
      hardware: createHardware(),
      report: createReport(),
      pcRequirements: {
        minimum: "Memory: 8 GB RAM, Quad-core CPU, GTX 1060",
        recommended: "Memory: 16 GB RAM, 8-core CPU, RTX 2060",
      },
    });

    assert.equal(evaluation.verdict, "verified");
    assert.equal(evaluation.verdictTitle, "Compatível com seu Mac");
    assert.equal(
      evaluation.checks.every((c) => c.status === "pass"),
      true
    );
  });

  it("returns 'playable' with warning when an 8 GB M1 Mac runs a game recommending 16 GB RAM and 10 GPU cores", () => {
    const evaluation = evaluateMacGameCompatibility({
      hardware: createHardware({
        chipName: "Apple M1",
        chipFamily: "M1",
        chipTier: "base",
        ramGB: 8,
        cpuCoresTotal: 8,
        cpuPerformanceCores: 4,
        cpuEfficiencyCores: 4,
        gpuCores: 8,
      }),
      report: createReport(),
      pcRequirements: {
        minimum: "Memory: 8 GB RAM, GTX 1050",
        recommended: "Memory: 16 GB RAM, RTX 2060",
      },
    });

    assert.equal(evaluation.verdict, "playable");
    const ramCheck = evaluation.checks.find((c) => c.key === "ram");
    const gpuCheck = evaluation.checks.find((c) => c.key === "gpuCores");
    assert.equal(ramCheck?.status, "warn");
    assert.equal(gpuCheck?.status, "warn");
  });

  it("returns 'unsupported' when Mac has insufficient RAM or Intel CPU", () => {
    const evaluation = evaluateMacGameCompatibility({
      hardware: createHardware({
        chipName: "Intel Core i7-9750H",
        chipFamily: "Intel",
        chipTier: "unknown",
        ramGB: 8,
        cpuCoresTotal: 6,
        gpuCores: null,
        isAppleSilicon: false,
      }),
      report: createReport(),
      pcRequirements: {
        minimum: "Memory: 16 GB RAM",
        recommended: "Memory: 16 GB RAM",
      },
    });

    assert.equal(evaluation.verdict, "unsupported");
    const chipCheck = evaluation.checks.find((c) => c.key === "chip");
    const ramCheck = evaluation.checks.find((c) => c.key === "ram");
    assert.equal(chipCheck?.status, "fail");
    assert.equal(ramCheck?.status, "fail");
  });
});
