import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Repeat, RotateCcw } from "lucide-react";
import cn from "classnames";
import type { SwitchButton } from "@types";
import { Button } from "@renderer/components";
import "./controller-visual-diagram.scss";

export type ControllerModelId =
  | "xbox"
  | "dualsense"
  | "dualshock4"
  | "switch_pro"
  | "steam_new";

interface ModelDefinition {
  id: ControllerModelId;
  label: string;
  subtitle: string;
  lStick: { x: number; y: number };
  rStick: { x: number; y: number };
  hotspots: Record<string, { x: number; y: number; chip: string }>;
}

interface CalloutSpec {
  phys: string;
  side: "left" | "right";
  slotY: number;
  title: string;
}

const SWITCH_ACTION_OPTIONS: Array<{ value: SwitchButton; label: string }> = [
  { value: "A", label: "Switch A (Leste)" },
  { value: "B", label: "Switch B (Sul)" },
  { value: "X", label: "Switch X (Norte)" },
  { value: "Y", label: "Switch Y (Oeste)" },
  { value: "L", label: "L" },
  { value: "R", label: "R" },
  { value: "ZL", label: "ZL" },
  { value: "ZR", label: "ZR" },
  { value: "L3", label: "L3 (Stick Esq)" },
  { value: "R3", label: "R3 (Stick Dir)" },
  { value: "Up", label: "D-Pad Cima" },
  { value: "Down", label: "D-Pad Baixo" },
  { value: "Left", label: "D-Pad Esquerda" },
  { value: "Right", label: "D-Pad Direita" },
  { value: "Plus", label: "+ (Start)" },
  { value: "Minus", label: "- (Select)" },
];

const CALLOUT_SPECS: CalloutSpec[] = [
  { phys: "leftTrigger", side: "left", slotY: 42, title: "LT / L2" },
  { phys: "leftShoulder", side: "left", slotY: 92, title: "LB / L1" },
  { phys: "buttonOptions", side: "left", slotY: 142, title: "Select / -" },
  { phys: "leftThumbstickButton", side: "left", slotY: 192, title: "L3" },
  { phys: "dpad.up", side: "left", slotY: 242, title: "D-Pad ↑" },
  { phys: "dpad.left", side: "left", slotY: 292, title: "D-Pad ←" },
  { phys: "dpad.down", side: "left", slotY: 342, title: "D-Pad ↓" },
  { phys: "dpad.right", side: "left", slotY: 392, title: "D-Pad →" },

  { phys: "rightTrigger", side: "right", slotY: 42, title: "RT / R2" },
  { phys: "rightShoulder", side: "right", slotY: 92, title: "RB / R1" },
  { phys: "buttonMenu", side: "right", slotY: 142, title: "Menu / +" },
  { phys: "buttonY", side: "right", slotY: 192, title: "Norte (Y/△)" },
  { phys: "buttonX", side: "right", slotY: 242, title: "Oeste (X/□)" },
  { phys: "buttonB", side: "right", slotY: 292, title: "Leste (B/○)" },
  { phys: "buttonA", side: "right", slotY: 342, title: "Sul (A/✕)" },
  { phys: "rightThumbstickButton", side: "right", slotY: 392, title: "R3" },
];

const MODEL_DEFINITIONS: ModelDefinition[] = [
  {
    id: "xbox",
    label: "Xbox Series X|S",
    subtitle: "Layout Assimétrico · Impulse Triggers",
    lStick: { x: 332, y: 174 },
    rStick: { x: 500, y: 246 },
    hotspots: {
      leftTrigger: { x: 330, y: 80, chip: "LT" },
      leftShoulder: { x: 330, y: 112, chip: "LB" },
      buttonOptions: { x: 405, y: 170, chip: "≡" },
      leftThumbstickButton: { x: 332, y: 174, chip: "LS" },
      "dpad.up": { x: 376, y: 224, chip: "↑" },
      "dpad.left": { x: 356, y: 244, chip: "←" },
      "dpad.down": { x: 376, y: 264, chip: "↓" },
      "dpad.right": { x: 396, y: 244, chip: "→" },

      rightTrigger: { x: 550, y: 80, chip: "RT" },
      rightShoulder: { x: 550, y: 112, chip: "RB" },
      buttonMenu: { x: 475, y: 170, chip: "☰" },
      buttonY: { x: 552, y: 146, chip: "Y" },
      buttonX: { x: 526, y: 172, chip: "X" },
      buttonB: { x: 578, y: 172, chip: "B" },
      buttonA: { x: 552, y: 198, chip: "A" },
      rightThumbstickButton: { x: 500, y: 246, chip: "RS" },
    },
  },
  {
    id: "dualsense",
    label: "PS5 DualSense",
    subtitle: "Analógicos Simétricos · Touchpad",
    lStick: { x: 382, y: 244 },
    rStick: { x: 498, y: 244 },
    hotspots: {
      leftTrigger: { x: 332, y: 82, chip: "L2" },
      leftShoulder: { x: 332, y: 112, chip: "L1" },
      buttonOptions: { x: 368, y: 138, chip: "CRT" },
      leftThumbstickButton: { x: 382, y: 244, chip: "L3" },
      "dpad.up": { x: 326, y: 162, chip: "↑" },
      "dpad.left": { x: 306, y: 182, chip: "←" },
      "dpad.down": { x: 326, y: 202, chip: "↓" },
      "dpad.right": { x: 346, y: 182, chip: "→" },

      rightTrigger: { x: 548, y: 82, chip: "R2" },
      rightShoulder: { x: 548, y: 112, chip: "R1" },
      buttonMenu: { x: 512, y: 138, chip: "OPT" },
      buttonY: { x: 554, y: 154, chip: "△" },
      buttonX: { x: 528, y: 180, chip: "□" },
      buttonB: { x: 580, y: 180, chip: "○" },
      buttonA: { x: 554, y: 206, chip: "✕" },
      rightThumbstickButton: { x: 498, y: 244, chip: "R3" },
    },
  },
  {
    id: "dualshock4",
    label: "PS4 DualShock 4",
    subtitle: "Simétrico Clássico · Share / Options",
    lStick: { x: 384, y: 242 },
    rStick: { x: 496, y: 242 },
    hotspots: {
      leftTrigger: { x: 334, y: 84, chip: "L2" },
      leftShoulder: { x: 334, y: 112, chip: "L1" },
      buttonOptions: { x: 372, y: 140, chip: "SHR" },
      leftThumbstickButton: { x: 384, y: 242, chip: "L3" },
      "dpad.up": { x: 326, y: 164, chip: "↑" },
      "dpad.left": { x: 306, y: 184, chip: "←" },
      "dpad.down": { x: 326, y: 204, chip: "↓" },
      "dpad.right": { x: 346, y: 184, chip: "→" },

      rightTrigger: { x: 546, y: 84, chip: "R2" },
      rightShoulder: { x: 546, y: 112, chip: "R1" },
      buttonMenu: { x: 508, y: 140, chip: "OPT" },
      buttonY: { x: 554, y: 156, chip: "△" },
      buttonX: { x: 528, y: 182, chip: "□" },
      buttonB: { x: 580, y: 182, chip: "○" },
      buttonA: { x: 554, y: 208, chip: "✕" },
      rightThumbstickButton: { x: 496, y: 242, chip: "R3" },
    },
  },
  {
    id: "switch_pro",
    label: "Switch Pro",
    subtitle: "Layout Nativo Nintendo A/B/X/Y",
    lStick: { x: 334, y: 170 },
    rStick: { x: 500, y: 244 },
    hotspots: {
      leftTrigger: { x: 332, y: 82, chip: "ZL" },
      leftShoulder: { x: 332, y: 112, chip: "L" },
      buttonOptions: { x: 404, y: 156, chip: "−" },
      leftThumbstickButton: { x: 334, y: 170, chip: "L3" },
      "dpad.up": { x: 376, y: 222, chip: "↑" },
      "dpad.left": { x: 356, y: 242, chip: "←" },
      "dpad.down": { x: 376, y: 262, chip: "↓" },
      "dpad.right": { x: 396, y: 242, chip: "→" },

      rightTrigger: { x: 548, y: 82, chip: "ZR" },
      rightShoulder: { x: 548, y: 112, chip: "R" },
      buttonMenu: { x: 476, y: 156, chip: "+" },
      buttonY: { x: 552, y: 144, chip: "X" },
      buttonX: { x: 526, y: 170, chip: "Y" },
      buttonB: { x: 578, y: 170, chip: "A" },
      buttonA: { x: 552, y: 196, chip: "B" },
      rightThumbstickButton: { x: 500, y: 244, chip: "R3" },
    },
  },
  {
    id: "steam_new",
    label: "Steam Controller (Novo)",
    subtitle: "Trackpads Quadrados Duplos + Analógicos Simétricos",
    lStick: { x: 348, y: 194 },
    rStick: { x: 532, y: 194 },
    hotspots: {
      leftTrigger: { x: 318, y: 84, chip: "L2" },
      leftShoulder: { x: 318, y: 112, chip: "L1" },
      buttonOptions: { x: 400, y: 192, chip: "◫" },
      leftThumbstickButton: { x: 348, y: 194, chip: "L3" },
      "dpad.up": { x: 284, y: 158, chip: "↑" },
      "dpad.left": { x: 266, y: 176, chip: "←" },
      "dpad.down": { x: 284, y: 194, chip: "↓" },
      "dpad.right": { x: 302, y: 176, chip: "→" },

      rightTrigger: { x: 562, y: 84, chip: "R2" },
      rightShoulder: { x: 562, y: 112, chip: "R1" },
      buttonMenu: { x: 480, y: 192, chip: "☰" },
      buttonY: { x: 596, y: 154, chip: "Y" },
      buttonX: { x: 572, y: 176, chip: "X" },
      buttonB: { x: 620, y: 176, chip: "B" },
      buttonA: { x: 596, y: 198, chip: "A" },
      rightThumbstickButton: { x: 532, y: 194, chip: "R3" },
    },
  },
];

export interface ControllerVisualDiagramProps {
  connectedGamepadName: string | null;
  gamepadBindings: Record<string, SwitchButton>;
  analogDeadzone: number;
  pressedElements: ReadonlySet<string>;
  stickAxes: { lx: number; ly: number; rx: number; ry: number };
  listeningFor: SwitchButton | null;
  onStartListening: (targetSwitch: SwitchButton | null) => void;
  onAssignPhysicalBinding: (
    physicalElement: string,
    nextSwitchButton: SwitchButton
  ) => void;
  onSwapFaceButtons: () => void;
  onResetDefaults: () => void;
}

function detectInitialModel(gamepadName: string | null): ControllerModelId {
  const lower = (gamepadName || "").toLowerCase();
  if (lower.includes("dualsense") || lower.includes("ps5")) return "dualsense";
  if (lower.includes("dualshock") || lower.includes("ps4")) return "dualshock4";
  if (
    lower.includes("pro controller") ||
    lower.includes("nintendo") ||
    lower.includes("switch")
  ) {
    return "switch_pro";
  }
  if (lower.includes("steam") || lower.includes("valve")) return "steam_new";
  return "xbox";
}

function renderControllerBodySvg(modelId: ControllerModelId) {
  if (modelId === "steam_new") {
    return (
      <g className="controller-diagram__shell">
        {/* Triggers & Bumpers */}
        <path
          d="M276,102 C284,76 318,70 360,78 L364,96 L276,108 Z"
          className="controller-diagram__trigger"
        />
        <path
          d="M604,102 C596,76 562,70 520,78 L516,96 L604,108 Z"
          className="controller-diagram__trigger"
        />
        <path
          d="M268,120 C278,98 322,94 370,100 L370,116 L268,126 Z"
          className="controller-diagram__bumper"
        />
        <path
          d="M612,120 C602,98 558,94 510,100 L510,116 L612,126 Z"
          className="controller-diagram__bumper"
        />
        {/* Wide angular grip Steam Controller body */}
        <path
          d="M272,118 C246,128 228,174 224,242 C220,314 246,366 282,368 C308,370 328,330 356,312 C382,292 406,292 440,292 C474,292 498,292 524,312 C552,330 572,370 598,368 C634,366 660,314 656,242 C652,174 634,128 608,118 C580,108 530,104 440,104 C350,104 300,108 272,118 Z"
          className="controller-diagram__chassis"
        />
        {/* Dual Rounded-Square Trackpads */}
        <rect
          x="320"
          y="236"
          width="56"
          height="56"
          rx="10"
          className="controller-diagram__trackpad"
        />
        <rect
          x="504"
          y="236"
          width="56"
          height="56"
          rx="10"
          className="controller-diagram__trackpad"
        />
        <path
          d="M348,244 L348,284 M328,264 L368,264 M532,244 L532,284 M512,264 L552,264"
          className="controller-diagram__trackpad-cross"
        />
        <circle
          cx="440"
          cy="196"
          r="14"
          className="controller-diagram__guide"
        />
        <text
          x="440"
          y="200"
          textAnchor="middle"
          className="controller-diagram__guide-label"
        >
          S
        </text>
      </g>
    );
  }

  if (modelId === "dualsense" || modelId === "dualshock4") {
    const isDualSense = modelId === "dualsense";
    return (
      <g className="controller-diagram__shell">
        <path
          d="M294,104 C300,76 326,72 362,80 L364,96 L292,110 Z"
          className="controller-diagram__trigger"
        />
        <path
          d="M586,104 C580,76 554,72 518,80 L516,96 L588,110 Z"
          className="controller-diagram__trigger"
        />
        <path
          d="M286,120 C296,98 332,96 368,102 L368,116 L284,126 Z"
          className="controller-diagram__bumper"
        />
        <path
          d="M594,120 C584,98 548,96 512,102 L512,116 L596,126 Z"
          className="controller-diagram__bumper"
        />
        <path
          d="M284,118 C258,132 238,200 232,276 C228,334 252,366 280,364 C304,362 322,318 342,292 C368,266 400,268 440,268 C480,268 512,266 538,292 C558,318 576,362 600,364 C628,366 652,334 648,276 C642,200 622,132 596,118 C568,104 510,106 440,106 C370,106 312,104 284,118 Z"
          className="controller-diagram__chassis"
        />
        {/* Touchpad */}
        <path
          d="M382,112 L498,112 L490,174 C488,180 482,184 474,184 L406,184 C398,184 392,180 390,174 Z"
          className={cn("controller-diagram__touchpad", {
            "controller-diagram__touchpad--ps5": isDualSense,
          })}
        />
        <circle
          cx="440"
          cy="218"
          r="11"
          className="controller-diagram__guide"
        />
        <text
          x="440"
          y="222"
          textAnchor="middle"
          className="controller-diagram__guide-label"
        >
          PS
        </text>
      </g>
    );
  }

  return (
    <g className="controller-diagram__shell">
      <path
        d="M292,104 C298,74 326,70 364,80 L366,98 L290,112 Z"
        className="controller-diagram__trigger"
      />
      <path
        d="M588,104 C582,74 554,70 516,80 L514,98 L590,112 Z"
        className="controller-diagram__trigger"
      />
      <path
        d="M284,120 C294,98 332,94 370,100 L370,116 L282,126 Z"
        className="controller-diagram__bumper"
      />
      <path
        d="M596,120 C586,98 548,94 510,100 L510,116 L598,126 Z"
        className="controller-diagram__bumper"
      />
      <path
        d="M286,116 C256,134 238,202 234,274 C230,336 256,368 286,364 C310,360 326,314 352,292 C376,276 406,276 440,276 C474,276 504,276 528,292 C554,314 570,360 594,364 C624,368 650,336 646,274 C642,202 624,134 594,116 C564,102 508,104 440,104 C372,104 316,102 286,116 Z"
        className="controller-diagram__chassis"
      />
      <circle cx="440" cy="134" r="13" className="controller-diagram__guide" />
      <text
        x="440"
        y="138"
        textAnchor="middle"
        className="controller-diagram__guide-label"
      >
        {modelId === "switch_pro" ? "⌂" : "X"}
      </text>
    </g>
  );
}

/**
 * Interactive 5-model SVG Controller Visualizer with live Gamepad API press & analog deadzone
 * live input feedback, dotted angled leader lines, hover sync, and click-to-remap / dropdown editing.
 */
export function ControllerVisualDiagram({
  connectedGamepadName,
  gamepadBindings,
  analogDeadzone,
  pressedElements,
  stickAxes,
  listeningFor,
  onStartListening,
  onAssignPhysicalBinding,
  onSwapFaceButtons,
  onResetDefaults,
}: Readonly<ControllerVisualDiagramProps>) {
  const [modelId, setModelId] = useState<ControllerModelId>(() =>
    detectInitialModel(connectedGamepadName)
  );
  const [hoveredPhys, setHoveredPhys] = useState<string | null>(null);
  const [editingPhys, setEditingPhys] = useState<string | null>(null);

  const modelIndex = MODEL_DEFINITIONS.findIndex((m) => m.id === modelId);
  const currentModel = MODEL_DEFINITIONS[modelIndex] ?? MODEL_DEFINITIONS[0];

  const handleCycleModel = (delta: number) => {
    const nextIdx =
      (modelIndex + delta + MODEL_DEFINITIONS.length) %
      MODEL_DEFINITIONS.length;
    setModelId(MODEL_DEFINITIONS[nextIdx].id);
  };

  const stickRadius = 25;
  const deadzoneRadius = Math.max(
    2,
    Math.min(stickRadius - 1, stickRadius * analogDeadzone)
  );

  const mappedCallouts = useMemo(() => {
    return CALLOUT_SPECS.map((spec) => {
      const hotspot = currentModel.hotspots[spec.phys];
      const mappedSwitch = gamepadBindings[spec.phys] ?? null;
      return {
        ...spec,
        hotspot,
        mappedSwitch,
      };
    });
  }, [currentModel, gamepadBindings]);

  const editingCallout = editingPhys
    ? (mappedCallouts.find((c) => c.phys === editingPhys) ?? null)
    : null;

  return (
    <div className="controller-diagram">
      <div className="controller-diagram__toolbar">
        <div className="controller-diagram__model-switcher">
          <button
            type="button"
            className="controller-diagram__nav-btn"
            onClick={() => handleCycleModel(-1)}
            title="Modelo anterior"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="controller-diagram__model-pills">
            {MODEL_DEFINITIONS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={cn("controller-diagram__model-pill", {
                  "controller-diagram__model-pill--active": m.id === modelId,
                })}
                onClick={() => setModelId(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="controller-diagram__nav-btn"
            onClick={() => handleCycleModel(1)}
            title="Próximo modelo"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="controller-diagram__toolbar-actions">
          <Button
            theme="outline"
            onClick={onSwapFaceButtons}
            title="Alternar botões de face A/B e X/Y"
          >
            <Repeat size={14} /> Trocar A/B &amp; X/Y
          </Button>
          <Button
            theme="outline"
            onClick={onResetDefaults}
            title="Restaurar mapeamento padrão de fábrica"
          >
            <RotateCcw size={14} /> Restaurar Padrão
          </Button>
        </div>
      </div>

      <div className="controller-diagram__subtitle-row">
        <span>{currentModel.subtitle}</span>
        <span>
          {connectedGamepadName
            ? `Conectado: ${connectedGamepadName}`
            : "Nenhum controle físico detectado — clique em qualquer ponto para remapear"}
        </span>
      </div>

      <div className="controller-diagram__canvas-wrap">
        <svg
          viewBox="0 0 880 430"
          className="controller-diagram__svg"
          role="img"
          aria-label={`Diagrama interativo do controle ${currentModel.label}`}
        >
          {/* Controller Silhouette */}
          {renderControllerBodySvg(currentModel.id)}

          {/* Left & Right Live Analog Sticks with Deadzone Rings */}
          {[
            {
              key: "left",
              cx: currentModel.lStick.x,
              cy: currentModel.lStick.y,
              x: stickAxes.lx,
              y: stickAxes.ly,
            },
            {
              key: "right",
              cx: currentModel.rStick.x,
              cy: currentModel.rStick.y,
              x: stickAxes.rx,
              y: stickAxes.ry,
            },
          ].map((stick) => (
            <g key={stick.key} className="controller-diagram__stick">
              <circle
                cx={stick.cx}
                cy={stick.cy}
                r={stickRadius}
                className="controller-diagram__stick-well"
              />
              <circle
                cx={stick.cx}
                cy={stick.cy}
                r={deadzoneRadius}
                className="controller-diagram__stick-deadzone"
              />
              <circle
                cx={stick.cx + stick.x * (stickRadius - 6)}
                cy={stick.cy + stick.y * (stickRadius - 6)}
                r={6}
                className="controller-diagram__stick-dot"
              />
            </g>
          ))}

          {/* Leader Lines (above artwork and sticks, below hotspots) */}
          {mappedCallouts.map((c) => {
            const isActive =
              hoveredPhys === c.phys ||
              editingPhys === c.phys ||
              pressedElements.has(c.phys) ||
              (listeningFor !== null && c.mappedSwitch === listeningFor);
            const anchorX = c.side === "left" ? 186 : 694;
            const elbowX =
              c.side === "left"
                ? Math.min(c.hotspot.x - 16, anchorX + 36)
                : Math.max(c.hotspot.x + 16, anchorX - 36);
            const points = `${anchorX},${c.slotY} ${elbowX},${c.slotY} ${c.hotspot.x},${c.hotspot.y}`;

            return (
              <polyline
                key={`line-${c.phys}`}
                points={points}
                fill="none"
                className={cn("controller-diagram__leader", {
                  "controller-diagram__leader--active": isActive,
                  "controller-diagram__leader--pressed": pressedElements.has(
                    c.phys
                  ),
                })}
              />
            );
          })}

          {/* Interactive Hotspots on Controller */}
          {mappedCallouts.map((c) => {
            const isPressed = pressedElements.has(c.phys);
            const isHighlighted =
              hoveredPhys === c.phys ||
              editingPhys === c.phys ||
              (listeningFor !== null && c.mappedSwitch === listeningFor);
            const r =
              c.phys.includes("Thumbstick") || c.phys.startsWith("dpad")
                ? 11
                : 12;

            return (
              <g
                key={`hs-${c.phys}`}
                className={cn("controller-diagram__hotspot", {
                  "controller-diagram__hotspot--active": isHighlighted,
                  "controller-diagram__hotspot--pressed": isPressed,
                })}
                onMouseEnter={() => setHoveredPhys(c.phys)}
                onMouseLeave={() =>
                  setHoveredPhys((cur) => (cur === c.phys ? null : cur))
                }
                onClick={() => {
                  setEditingPhys(c.phys);
                  if (c.mappedSwitch) {
                    onStartListening(c.mappedSwitch);
                  }
                }}
              >
                <circle
                  cx={c.hotspot.x}
                  cy={c.hotspot.y}
                  r={r}
                  className="controller-diagram__hotspot-ring"
                />
                <text
                  x={c.hotspot.x}
                  y={c.hotspot.y + 3.5}
                  textAnchor="middle"
                  className="controller-diagram__hotspot-chip"
                >
                  {c.hotspot.chip}
                </text>
              </g>
            );
          })}

          {/* Left & Right Callout Cards via foreignObject for sharp HTML pills */}
          {mappedCallouts.map((c) => {
            const x = c.side === "left" ? 8 : 694;
            const y = c.slotY - 17;
            const isPressed = pressedElements.has(c.phys);
            const isListening =
              listeningFor !== null && c.mappedSwitch === listeningFor;
            const isHighlighted =
              hoveredPhys === c.phys || editingPhys === c.phys || isListening;

            return (
              <foreignObject
                key={`card-${c.phys}`}
                x={x}
                y={y}
                width={178}
                height={34}
              >
                <button
                  type="button"
                  className={cn("controller-diagram__callout", {
                    "controller-diagram__callout--active": isHighlighted,
                    "controller-diagram__callout--pressed": isPressed,
                    "controller-diagram__callout--listening": isListening,
                  })}
                  onMouseEnter={() => setHoveredPhys(c.phys)}
                  onMouseLeave={() =>
                    setHoveredPhys((cur) => (cur === c.phys ? null : cur))
                  }
                  onClick={() => {
                    setEditingPhys(c.phys);
                    if (c.mappedSwitch) {
                      onStartListening(c.mappedSwitch);
                    }
                  }}
                >
                  <span className="controller-diagram__callout-phys">
                    {c.title}
                  </span>
                  <span className="controller-diagram__callout-action">
                    {isListening ? "Pressione..." : (c.mappedSwitch ?? "Livre")}
                  </span>
                </button>
              </foreignObject>
            );
          })}
        </svg>
      </div>

      {/* Inline Quick Remap Bar when user clicks any input */}
      {editingCallout && (
        <div className="controller-diagram__remap-bar">
          <div className="controller-diagram__remap-info">
            <strong>
              {editingCallout.title} ({currentModel.label})
            </strong>
            <span>
              {listeningFor
                ? `Pressione um botão no controle para atribuir a "${listeningFor}" ou escolha diretamente ao lado:`
                : "Escolha qual botão Switch este input deve acionar:"}
            </span>
          </div>

          <div className="controller-diagram__remap-controls">
            <select
              className="controller-diagram__remap-select"
              value={editingCallout.mappedSwitch ?? ""}
              onChange={(e) => {
                const nextBtn = e.target.value as SwitchButton;
                if (!nextBtn) return;
                onAssignPhysicalBinding(editingCallout.phys, nextBtn);
                onStartListening(null);
              }}
            >
              {SWITCH_ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <Button
              theme="outline"
              onClick={() => {
                if (editingCallout.mappedSwitch) {
                  onStartListening(
                    listeningFor === editingCallout.mappedSwitch
                      ? null
                      : editingCallout.mappedSwitch
                  );
                }
              }}
            >
              {listeningFor === editingCallout.mappedSwitch
                ? "Cancelar captura"
                : "Capturar do Controle"}
            </Button>

            <Button
              theme="outline"
              onClick={() => {
                setEditingPhys(null);
                onStartListening(null);
              }}
            >
              Fechar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
