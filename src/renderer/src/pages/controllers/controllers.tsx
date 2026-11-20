import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Gamepad2,
  Keyboard,
  Mouse,
  Plus,
  RefreshCw,
  Repeat,
  Trash2,
  Vibrate,
} from "lucide-react";
import cn from "classnames";
import type { ControllerProfile, ControllersState, SwitchButton } from "@types";
import {
  Button,
  CheckboxField,
  Modal,
  SelectField,
  TextField,
} from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { ControllerVisualDiagram } from "./controller-visual-diagram";
import "./controllers.scss";

const DEFAULT_FACTORY_GAMEPAD_BINDINGS: Record<string, SwitchButton> = {
  buttonB: "A",
  buttonA: "B",
  buttonY: "X",
  buttonX: "Y",
  leftShoulder: "L",
  rightShoulder: "R",
  leftTrigger: "ZL",
  rightTrigger: "ZR",
  buttonMenu: "Plus",
  buttonOptions: "Minus",
  leftThumbstickButton: "L3",
  rightThumbstickButton: "R3",
  "dpad.up": "Up",
  "dpad.down": "Down",
  "dpad.left": "Left",
  "dpad.right": "Right",
};

const PLAYER_COLORS = [
  "#3b82f6", // P1 Blue
  "#ef4444", // P2 Red
  "#22c55e", // P3 Green
  "#eab308", // P4 Yellow
  "#a855f7", // P5 Purple
  "#06b6d4", // P6 Cyan
  "#f97316", // P7 Orange
  "#ec4899", // P8 Pink
];

const SWITCH_BUTTONS: Array<{
  btn: SwitchButton;
  label: string;
  group: "face" | "shoulder" | "dpad" | "system";
}> = [
  { btn: "A", label: "A (Direita)", group: "face" },
  { btn: "B", label: "B (Baixo)", group: "face" },
  { btn: "X", label: "X (Cima)", group: "face" },
  { btn: "Y", label: "Y (Esquerda)", group: "face" },
  { btn: "L", label: "L", group: "shoulder" },
  { btn: "R", label: "R", group: "shoulder" },
  { btn: "ZL", label: "ZL", group: "shoulder" },
  { btn: "ZR", label: "ZR", group: "shoulder" },
  { btn: "L3", label: "L3 (Analógico Esq)", group: "shoulder" },
  { btn: "R3", label: "R3 (Analógico Dir)", group: "shoulder" },
  { btn: "Up", label: "D-Pad Cima", group: "dpad" },
  { btn: "Down", label: "D-Pad Baixo", group: "dpad" },
  { btn: "Left", label: "D-Pad Esquerda", group: "dpad" },
  { btn: "Right", label: "D-Pad Direita", group: "dpad" },
  { btn: "Plus", label: "+ (Start)", group: "system" },
  { btn: "Minus", label: "- (Select)", group: "system" },
];

const STANDARD_GAMEPAD_INDEX_TO_ELEMENT: Record<number, string> = {
  0: "buttonA",
  1: "buttonB",
  2: "buttonX",
  3: "buttonY",
  4: "leftShoulder",
  5: "rightShoulder",
  6: "leftTrigger",
  7: "rightTrigger",
  8: "buttonOptions",
  9: "buttonMenu",
  10: "leftThumbstickButton",
  11: "rightThumbstickButton",
  12: "dpad.up",
  13: "dpad.down",
  14: "dpad.left",
  15: "dpad.right",
};

const GAMEPAD_ELEMENT_LABELS: Record<string, string> = {
  buttonA: "Sul (A / Cross)",
  buttonB: "Leste (B / Circle)",
  buttonX: "Oeste (X / Square)",
  buttonY: "Norte (Y / Triangle)",
  leftShoulder: "LB / L1",
  rightShoulder: "RB / R1",
  leftTrigger: "LT / L2",
  rightTrigger: "RT / R2",
  buttonMenu: "Menu / Start",
  buttonOptions: "Options / Back",
  leftThumbstickButton: "L3",
  rightThumbstickButton: "R3",
  "dpad.up": "D-Pad ↑",
  "dpad.down": "D-Pad ↓",
  "dpad.left": "D-Pad ←",
  "dpad.right": "D-Pad →",
};

// Map DOM KeyboardEvent.code -> macOS Carbon Virtual KeyCode (UInt16 used by dmhost)
const CODE_TO_MAC_KEYCODE: Record<string, number> = {
  KeyA: 0,
  KeyS: 1,
  KeyD: 2,
  KeyF: 3,
  KeyH: 4,
  KeyG: 5,
  KeyZ: 6,
  KeyX: 7,
  KeyC: 8,
  KeyV: 9,
  KeyB: 11,
  KeyQ: 12,
  KeyW: 13,
  KeyE: 14,
  KeyR: 15,
  KeyY: 16,
  KeyT: 17,
  Digit1: 18,
  Digit2: 19,
  Digit3: 20,
  Digit4: 21,
  Digit6: 22,
  Digit5: 23,
  Equal: 24,
  Digit9: 25,
  Digit7: 26,
  Minus: 27,
  Digit8: 28,
  Digit0: 29,
  BracketRight: 30,
  KeyO: 31,
  KeyU: 32,
  BracketLeft: 33,
  KeyI: 34,
  KeyP: 35,
  Enter: 36,
  KeyL: 37,
  KeyJ: 38,
  Quote: 39,
  KeyK: 40,
  Semicolon: 41,
  Backslash: 42,
  Comma: 43,
  Slash: 44,
  KeyN: 45,
  KeyM: 46,
  Period: 47,
  Tab: 48,
  Space: 49,
  Backspace: 51,
  Escape: 53,
  ShiftLeft: 56,
  ShiftRight: 60,
  ControlLeft: 59,
  AltLeft: 58,
  ArrowLeft: 123,
  ArrowRight: 124,
  ArrowDown: 125,
  ArrowUp: 126,
};

const MAC_KEYCODE_TO_LABEL: Record<number, string> = Object.fromEntries(
  Object.entries(CODE_TO_MAC_KEYCODE).map(([code, num]) => [
    num,
    code
      .replace(/^Key/, "")
      .replace(/^Digit/, "")
      .replace(/^Arrow/, "Seta "),
  ])
);

export default function Controllers() {
  const { showSuccessToast, showErrorToast } = useToast();
  const [state, setState] = useState<ControllersState | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number>(0);
  const [deviceTab, setDeviceTab] = useState<"gamepad" | "keyboard">("gamepad");
  const [mouseTab, setMouseTab] = useState<"switch1" | "switch2">("switch1");

  const [listeningGamepadFor, setListeningGamepadFor] =
    useState<SwitchButton | null>(null);
  const [listeningKeyboardFor, setListeningKeyboardFor] = useState<
    SwitchButton | "move_up" | "move_down" | "move_left" | "move_right" | null
  >(null);

  const [connectedGamepadName, setConnectedGamepadName] = useState<
    string | null
  >(null);
  const [pressedElements, setPressedElements] = useState<Set<string>>(
    new Set()
  );
  const [stickAxes, setStickAxes] = useState({ lx: 0, ly: 0, rx: 0, ry: 0 });

  const [showNewProfileModal, setShowNewProfileModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");

  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    window.electron
      .controllersGetState()
      .then((res) => setState(res))
      .catch(() => {});
  }, []);

  const activeProfile: ControllerProfile | null = useMemo(() => {
    if (!state || state.profiles.length === 0) return null;
    const slotProfileId =
      state.playerProfileIds[String(selectedSlot)] || state.activeProfileId;
    return (
      state.profiles.find((p) => p.id === slotProfileId) || state.profiles[0]
    );
  }, [state, selectedSlot]);

  const persistProfile = useCallback(
    async (nextProfile: ControllerProfile, syncKeyboard = false) => {
      const updated = await window.electron.controllersSaveProfile(
        nextProfile,
        syncKeyboard
      );
      setState(updated);
    },
    []
  );

  // Live Gamepad polling (for button highlights, deadzone visualizer & rebinding)
  useEffect(() => {
    const poll = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = pads.find((p) => p && p.connected) || null;
      if (pad) {
        setConnectedGamepadName(pad.id);
        const pressed = new Set<string>();
        pad.buttons.forEach((btn, idx) => {
          if (btn.pressed) {
            const elem = STANDARD_GAMEPAD_INDEX_TO_ELEMENT[idx];
            if (elem) pressed.add(elem);
          }
        });
        setPressedElements(pressed);
        setStickAxes({
          lx: pad.axes[0] || 0,
          ly: pad.axes[1] || 0,
          rx: pad.axes[2] || 0,
          ry: pad.axes[3] || 0,
        });

        if (listeningGamepadFor && activeProfile && pressed.size > 0) {
          const firstElem = Array.from(pressed)[0];
          const nextBindings = { ...activeProfile.gamepadBindings };
          // Remove previous binding pointing to same SwitchButton
          for (const [k, v] of Object.entries(nextBindings)) {
            if (v === listeningGamepadFor) delete nextBindings[k];
          }
          nextBindings[firstElem] = listeningGamepadFor;
          setListeningGamepadFor(null);
          void persistProfile({
            ...activeProfile,
            gamepadBindings: nextBindings,
          });
        }
      } else {
        setConnectedGamepadName(null);
        setPressedElements(new Set());
        setStickAxes({ lx: 0, ly: 0, rx: 0, ry: 0 });
      }
      rafRef.current = requestAnimationFrame(poll);
    };
    rafRef.current = requestAnimationFrame(poll);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [listeningGamepadFor, activeProfile, persistProfile]);

  // Keyboard rebind capture
  useEffect(() => {
    if (!listeningKeyboardFor || !activeProfile) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const macCode = CODE_TO_MAC_KEYCODE[e.code];
      if (macCode === undefined) {
        setListeningKeyboardFor(null);
        return;
      }

      if (listeningKeyboardFor.startsWith("move_")) {
        const dir = listeningKeyboardFor.replace("move_", "") as
          | "up"
          | "down"
          | "left"
          | "right";
        const nextProfile: ControllerProfile = {
          ...activeProfile,
          keyboardMovement: {
            ...activeProfile.keyboardMovement,
            [dir]: macCode,
          },
        };
        setListeningKeyboardFor(null);
        void persistProfile(nextProfile, true);
        return;
      }

      const nextKb = { ...activeProfile.keyboardBindings };
      for (const [k, v] of Object.entries(nextKb)) {
        if (v === listeningKeyboardFor) delete nextKb[k];
      }
      nextKb[String(macCode)] = listeningKeyboardFor as SwitchButton;
      setListeningKeyboardFor(null);
      void persistProfile({ ...activeProfile, keyboardBindings: nextKb }, true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listeningKeyboardFor, activeProfile, persistProfile]);

  const handleSelectProfile = async (profileId: string) => {
    const next = await window.electron.controllersSetPlayerProfile(
      selectedSlot,
      profileId
    );
    setState(next);
  };

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) return;
    const { state: next, created } =
      await window.electron.controllersCreateProfile(
        newProfileName.trim(),
        activeProfile?.id
      );
    await window.electron.controllersSetPlayerProfile(selectedSlot, created.id);
    const refreshed = await window.electron.controllersGetState();
    setState(refreshed || next);
    setNewProfileName("");
    setShowNewProfileModal(false);
    showSuccessToast(`Perfil "${created.name}" criado.`);
  };

  const handleDuplicate = async () => {
    if (!activeProfile) return;
    const { created } = await window.electron.controllersDuplicateProfile(
      activeProfile.id
    );
    const next = await window.electron.controllersSetPlayerProfile(
      selectedSlot,
      created.id
    );
    setState(next);
    showSuccessToast(`Perfil duplicado como "${created.name}".`);
  };

  const handleDelete = async () => {
    if (!activeProfile || activeProfile.isDefault) return;
    const next = await window.electron.controllersDeleteProfile(
      activeProfile.id
    );
    setState(next);
    showSuccessToast("Perfil excluído.");
  };

  const handleSwapFaceButtons = async () => {
    if (!activeProfile) return;
    const gp = { ...activeProfile.gamepadBindings };
    const oldA = gp.buttonB;
    const oldB = gp.buttonA;
    const oldX = gp.buttonY;
    const oldY = gp.buttonX;
    gp.buttonB = oldB;
    gp.buttonA = oldA;
    gp.buttonY = oldY;
    gp.buttonX = oldX;
    await persistProfile({ ...activeProfile, gamepadBindings: gp });
    showSuccessToast("Botões de face alternados (Nintendo ↔ Xbox/PC).");
  };

  const handleAssignPhysicalBinding = async (
    physicalElement: string,
    nextSwitchButton: SwitchButton
  ) => {
    if (!activeProfile) return;
    const nextBindings = {
      ...activeProfile.gamepadBindings,
      [physicalElement]: nextSwitchButton,
    };
    await persistProfile({
      ...activeProfile,
      gamepadBindings: nextBindings,
    });
    showSuccessToast(
      `Botão "${GAMEPAD_ELEMENT_LABELS[physicalElement] || physicalElement}" mapeado para "${nextSwitchButton}".`
    );
  };

  const handleResetGamepadDefaults = async () => {
    if (!activeProfile) return;
    await persistProfile({
      ...activeProfile,
      gamepadBindings: { ...DEFAULT_FACTORY_GAMEPAD_BINDINGS },
      analogDeadzone: 0.12,
    });
    showSuccessToast("Mapeamento e deadzone restaurados para o padrão.");
  };

  const handleTestRumble = async () => {
    if (!activeProfile) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads.find((p) => p && p.connected) as
      | (Gamepad & {
          vibrationActuator?: {
            playEffect?: (
              type: string,
              params: Record<string, number>
            ) => Promise<void>;
          };
        })
      | undefined;

    if (pad?.vibrationActuator?.playEffect) {
      const strength = Math.min(1, Math.max(0.1, activeProfile.rumbleStrength));
      try {
        await pad.vibrationActuator.playEffect("dual-rumble", {
          duration: 350,
          strongMagnitude: strength,
          weakMagnitude: strength * 0.7,
        });
        return;
      } catch {
        // fallback toast
      }
    }
    showErrorToast(
      "Conecte um controle compatível com vibração para testar o rumble."
    );
  };

  const getPhysicalForSwitch = (btn: SwitchButton): string => {
    if (!activeProfile) return "—";
    const found = Object.entries(activeProfile.gamepadBindings).find(
      ([, v]) => v === btn
    );
    return found ? GAMEPAD_ELEMENT_LABELS[found[0]] || found[0] : "Não mapeado";
  };

  const getKeyForSwitch = (btn: SwitchButton): string => {
    if (!activeProfile) return "—";
    const found = Object.entries(activeProfile.keyboardBindings).find(
      ([, v]) => v === btn
    );
    if (!found) return "—";
    const num = Number.parseInt(found[0], 10);
    return MAC_KEYCODE_TO_LABEL[num] || `Key #${num}`;
  };

  if (!state || !activeProfile) {
    return (
      <section className="controllers-page">
        <p>Carregando perfis de controle...</p>
      </section>
    );
  }

  return (
    <section className="controllers-page">
      <header className="controllers-page__header">
        <div className="controllers-page__title">
          <Gamepad2 size={20} />
          <div>
            <h2>Controles & Teclados</h2>
            <span>
              Perfis unificados para Switch 1, Switch 2 e Windows via Red Wine —
              Suporte P1 até P8
            </span>
          </div>
        </div>

        <div className="controllers-page__status">
          <span
            className={cn("controllers-page__dot", {
              "controllers-page__dot--online": Boolean(connectedGamepadName),
            })}
          />
          <span>
            {connectedGamepadName || "Nenhum controle físico conectado"}
          </span>
        </div>
      </header>

      {/* Player Slots P1..P8 */}
      <div className="controllers-page__card">
        <div className="controllers-page__players-row">
          <div className="controllers-page__players">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((slot) => {
              const isSelected = selectedSlot === slot;
              const assignedId = state.playerProfileIds[String(slot)];
              const assignedName = state.profiles.find(
                (p) => p.id === assignedId
              )?.name;
              return (
                <button
                  key={slot}
                  type="button"
                  className={cn("controllers-page__player-pill", {
                    "controllers-page__player-pill--active": isSelected,
                  })}
                  onClick={() => setSelectedSlot(slot)}
                  title={
                    assignedName
                      ? `P${slot + 1}: ${assignedName}`
                      : `P${slot + 1}: Perfil Padrão`
                  }
                >
                  <span
                    className="controllers-page__player-led"
                    style={{ backgroundColor: PLAYER_COLORS[slot] }}
                  />
                  P{slot + 1}
                </button>
              );
            })}
          </div>

          <div className="controllers-page__profile-controls">
            <SelectField
              theme="dark"
              value={activeProfile.id}
              onChange={(e) => handleSelectProfile(e.target.value)}
              options={state.profiles.map((p) => ({
                key: p.id,
                value: p.id,
                label: p.name,
              }))}
            />
            <Button
              theme="outline"
              size="small"
              onClick={() => setShowNewProfileModal(true)}
            >
              <Plus size={14} /> Novo
            </Button>
            <Button theme="outline" size="small" onClick={handleDuplicate}>
              <Copy size={14} /> Duplicar
            </Button>
            <Button
              theme="outline"
              size="small"
              onClick={handleSwapFaceButtons}
              title="Inverter layout Nintendo (A/B, X/Y) <-> Xbox/PC"
            >
              <Repeat size={14} /> Inverter Face
            </Button>
            {!activeProfile.isDefault && (
              <Button theme="danger" size="small" onClick={handleDelete}>
                <Trash2 size={14} />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Mode Switcher: Gamepad vs Keyboard & Mouse */}
      <div className="controllers-page__mode-tabs">
        <button
          type="button"
          className={cn("controllers-page__mode-tab", {
            "controllers-page__mode-tab--active": deviceTab === "gamepad",
          })}
          onClick={() => setDeviceTab("gamepad")}
        >
          <Gamepad2 size={15} /> Controle (Gamepad)
        </button>
        <button
          type="button"
          className={cn("controllers-page__mode-tab", {
            "controllers-page__mode-tab--active": deviceTab === "keyboard",
          })}
          onClick={() => setDeviceTab("keyboard")}
        >
          <Keyboard size={15} /> Teclado & Mouse (Switch 1 / 2)
        </button>
      </div>

      {deviceTab === "gamepad" ? (
        <>
          <ControllerVisualDiagram
            connectedGamepadName={connectedGamepadName}
            gamepadBindings={activeProfile.gamepadBindings}
            analogDeadzone={activeProfile.analogDeadzone}
            pressedElements={pressedElements}
            stickAxes={stickAxes}
            listeningFor={listeningGamepadFor}
            onStartListening={setListeningGamepadFor}
            onAssignPhysicalBinding={(phys, btn) =>
              void handleAssignPhysicalBinding(phys, btn)
            }
            onSwapFaceButtons={() => void handleSwapFaceButtons()}
            onResetDefaults={() => void handleResetGamepadDefaults()}
          />

          <div className="controllers-page__card">
            <div className="controllers-page__card-header">
              <h3>
                Mapeamento de Botões — P{selectedSlot + 1} ({activeProfile.name}
                )
              </h3>
              <small>
                Clique em qualquer botão abaixo e pressione o botão desejado no
                controle conectado.
              </small>
            </div>

            <div className="controllers-page__bindings-grid">
              {SWITCH_BUTTONS.map(({ btn, label }) => {
                const isListening = listeningGamepadFor === btn;
                const mappedPhys = Object.entries(
                  activeProfile.gamepadBindings
                ).find(([, v]) => v === btn)?.[0];
                const isPressed = Boolean(
                  mappedPhys && pressedElements.has(mappedPhys)
                );

                return (
                  <button
                    key={btn}
                    type="button"
                    className={cn("controllers-page__binding-pill", {
                      "controllers-page__binding-pill--listening": isListening,
                      "controllers-page__binding-pill--pressed": isPressed,
                    })}
                    onClick={() =>
                      setListeningGamepadFor(isListening ? null : btn)
                    }
                  >
                    <span className="controllers-page__binding-target">
                      {label}
                    </span>
                    <span className="controllers-page__binding-value">
                      {isListening
                        ? "Pressione um botão..."
                        : getPhysicalForSwitch(btn)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="controllers-page__two-col">
            {/* Analog Deadzone Calibration */}
            <div className="controllers-page__card">
              <div className="controllers-page__card-header">
                <h3>Calibração e Deadzone dos Analógicos</h3>
                <span className="controllers-page__mono">
                  {Math.round(activeProfile.analogDeadzone * 100)}%
                </span>
              </div>

              <div className="controllers-page__sticks">
                {[
                  {
                    label: "Analógico Esq (L)",
                    x: stickAxes.lx,
                    y: stickAxes.ly,
                  },
                  {
                    label: "Analógico Dir (R)",
                    x: stickAxes.rx,
                    y: stickAxes.ry,
                  },
                ].map((stick) => (
                  <div
                    key={stick.label}
                    className="controllers-page__stick-box"
                  >
                    <div className="controllers-page__stick-circle">
                      <div
                        className="controllers-page__stick-deadzone"
                        style={{
                          width: `${activeProfile.analogDeadzone * 100}%`,
                          height: `${activeProfile.analogDeadzone * 100}%`,
                        }}
                      />
                      <div
                        className="controllers-page__stick-dot"
                        style={{
                          transform: `translate(${stick.x * 36}px, ${stick.y * 36}px)`,
                        }}
                      />
                    </div>
                    <small>{stick.label}</small>
                  </div>
                ))}
              </div>

              <input
                type="range"
                min={0.02}
                max={0.45}
                step={0.01}
                value={activeProfile.analogDeadzone}
                onChange={(e) =>
                  void persistProfile({
                    ...activeProfile,
                    analogDeadzone: Number.parseFloat(e.target.value),
                  })
                }
              />
            </div>

            {/* Haptics & Vibration */}
            <div className="controllers-page__card">
              <div className="controllers-page__card-header">
                <h3>
                  <Vibrate size={15} /> Vibração & Haptics (Rumble)
                </h3>
                <Button
                  theme="outline"
                  size="small"
                  onClick={handleTestRumble}
                  disabled={!activeProfile.enableRumble}
                >
                  Testar Vibração
                </Button>
              </div>

              <CheckboxField
                label="Ativar vibração (HD Rumble)"
                checked={activeProfile.enableRumble}
                onChange={() =>
                  void persistProfile({
                    ...activeProfile,
                    enableRumble: !activeProfile.enableRumble,
                  })
                }
              />

              {activeProfile.enableRumble && (
                <>
                  <div className="controllers-page__slider-row">
                    <span>Intensidade da Vibração</span>
                    <strong>
                      {Math.round(activeProfile.rumbleStrength * 100)}%
                    </strong>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={2.0}
                    step={0.05}
                    value={activeProfile.rumbleStrength}
                    onChange={(e) =>
                      void persistProfile({
                        ...activeProfile,
                        rumbleStrength: Number.parseFloat(e.target.value),
                      })
                    }
                  />

                  <CheckboxField
                    label="Compensação de Inércia (Floor Boost para motores leves)"
                    checked={activeProfile.rumbleFloorBoost}
                    onChange={() =>
                      void persistProfile({
                        ...activeProfile,
                        rumbleFloorBoost: !activeProfile.rumbleFloorBoost,
                      })
                    }
                  />
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="controllers-page__two-col">
          {/* Keyboard Remapping */}
          <div className="controllers-page__card">
            <div className="controllers-page__card-header">
              <h3>Mapeamento de Teclado (Global)</h3>
              <small>Clique e pressione a tecla desejada</small>
            </div>

            <div className="controllers-page__wasd-row">
              {(
                [
                  ["move_up", "Mover ↑", activeProfile.keyboardMovement.up],
                  ["move_down", "Mover ↓", activeProfile.keyboardMovement.down],
                  ["move_left", "Mover ←", activeProfile.keyboardMovement.left],
                  [
                    "move_right",
                    "Mover →",
                    activeProfile.keyboardMovement.right,
                  ],
                ] as const
              ).map(([id, lbl, code]) => (
                <button
                  key={id}
                  type="button"
                  className={cn("controllers-page__binding-pill", {
                    "controllers-page__binding-pill--listening":
                      listeningKeyboardFor === id,
                  })}
                  onClick={() =>
                    setListeningKeyboardFor(
                      listeningKeyboardFor === id ? null : id
                    )
                  }
                >
                  <span className="controllers-page__binding-target">
                    {lbl}
                  </span>
                  <span className="controllers-page__binding-value">
                    {listeningKeyboardFor === id
                      ? "Tecla..."
                      : MAC_KEYCODE_TO_LABEL[code] || `#${code}`}
                  </span>
                </button>
              ))}
            </div>

            <div className="controllers-page__bindings-grid">
              {SWITCH_BUTTONS.map(({ btn, label }) => {
                const isListening = listeningKeyboardFor === btn;
                return (
                  <button
                    key={btn}
                    type="button"
                    className={cn("controllers-page__binding-pill", {
                      "controllers-page__binding-pill--listening": isListening,
                    })}
                    onClick={() =>
                      setListeningKeyboardFor(isListening ? null : btn)
                    }
                  >
                    <span className="controllers-page__binding-target">
                      {label}
                    </span>
                    <span className="controllers-page__binding-value">
                      {isListening ? "Tecla..." : getKeyForSwitch(btn)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mouse Look Switch 1 + Switch 2 Native JCMS */}
          <div className="controllers-page__card">
            <div className="controllers-page__card-header">
              <h3>
                <Mouse size={15} /> Configurações de Mouse
              </h3>
              <div className="controllers-page__subtabs">
                <button
                  type="button"
                  className={cn({ active: mouseTab === "switch1" })}
                  onClick={() => setMouseTab("switch1")}
                >
                  Switch 1 (R-Stick)
                </button>
                <button
                  type="button"
                  className={cn({ active: mouseTab === "switch2" })}
                  onClick={() => setMouseTab("switch2")}
                >
                  Switch 2 (Nativo)
                </button>
              </div>
            </div>

            {mouseTab === "switch1" ? (
              <div className="controllers-page__stack">
                <CheckboxField
                  label="Usar Mouse como Analógico Direito (Câmera)"
                  checked={activeProfile.mouseAsRightStick}
                  onChange={() =>
                    void persistProfile(
                      {
                        ...activeProfile,
                        mouseAsRightStick: !activeProfile.mouseAsRightStick,
                        mouseMode: !activeProfile.mouseAsRightStick
                          ? "auto"
                          : "touchscreen",
                      },
                      true
                    )
                  }
                />

                {activeProfile.mouseAsRightStick && (
                  <>
                    <div className="controllers-page__slider-row">
                      <span>Sensibilidade</span>
                      <strong>
                        {activeProfile.mouseSensitivity.toFixed(1)}x
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={100}
                      step={0.5}
                      value={activeProfile.mouseSensitivity}
                      onChange={(e) =>
                        void persistProfile(
                          {
                            ...activeProfile,
                            mouseSensitivity: Number.parseFloat(e.target.value),
                          },
                          true
                        )
                      }
                    />
                    <CheckboxField
                      label="Inverter Eixo X"
                      checked={activeProfile.mouseInvertX}
                      onChange={() =>
                        void persistProfile(
                          {
                            ...activeProfile,
                            mouseInvertX: !activeProfile.mouseInvertX,
                          },
                          true
                        )
                      }
                    />
                    <CheckboxField
                      label="Inverter Eixo Y"
                      checked={activeProfile.mouseInvertY}
                      onChange={() =>
                        void persistProfile(
                          {
                            ...activeProfile,
                            mouseInvertY: !activeProfile.mouseInvertY,
                          },
                          true
                        )
                      }
                    />
                    <SelectField
                      label="Modo de Ativação"
                      theme="dark"
                      value={activeProfile.mouseRightStickMode}
                      onChange={(e) =>
                        void persistProfile(
                          {
                            ...activeProfile,
                            mouseRightStickMode: e.target.value as
                              | "cursorLock"
                              | "rightDrag",
                          },
                          true
                        )
                      }
                      options={[
                        {
                          key: "cursorLock",
                          value: "cursorLock",
                          label: "Travar Cursor (FPS / Câmera livre)",
                        },
                        {
                          key: "rightDrag",
                          value: "rightDrag",
                          label: "Segurar Botão Direito + Arrastar",
                        },
                      ]}
                    />
                  </>
                )}
              </div>
            ) : (
              <div className="controllers-page__stack">
                <CheckboxField
                  label="Ativar Mouse Nativo do Switch 2 (Joy-Con Mouse Sensor)"
                  checked={activeProfile.mouseSwitch2Enabled}
                  onChange={() =>
                    void persistProfile(
                      {
                        ...activeProfile,
                        mouseSwitch2Enabled: !activeProfile.mouseSwitch2Enabled,
                      },
                      true
                    )
                  }
                />

                {activeProfile.mouseSwitch2Enabled && (
                  <>
                    <div className="controllers-page__slider-row">
                      <span>Velocidade do Ponteiro</span>
                      <strong>
                        {activeProfile.mouseSwitch2PointerSpeed.toFixed(1)}x
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={5.0}
                      step={0.1}
                      value={activeProfile.mouseSwitch2PointerSpeed}
                      onChange={(e) =>
                        void persistProfile(
                          {
                            ...activeProfile,
                            mouseSwitch2PointerSpeed: Number.parseFloat(
                              e.target.value
                            ),
                          },
                          true
                        )
                      }
                    />
                    <CheckboxField
                      label="Travar cursor na janela do jogo"
                      checked={activeProfile.mouseSwitch2LockCursor}
                      onChange={() =>
                        void persistProfile(
                          {
                            ...activeProfile,
                            mouseSwitch2LockCursor:
                              !activeProfile.mouseSwitch2LockCursor,
                          },
                          true
                        )
                      }
                    />
                    <SelectField
                      label="Botão Primário"
                      theme="dark"
                      value={activeProfile.mouseSwitch2PrimaryButton}
                      onChange={(e) =>
                        void persistProfile(
                          {
                            ...activeProfile,
                            mouseSwitch2PrimaryButton: e.target.value as
                              | "left"
                              | "right",
                          },
                          true
                        )
                      }
                      options={[
                        {
                          key: "left",
                          value: "left",
                          label: "Padrão (Esq = R, Dir = ZR)",
                        },
                        {
                          key: "right",
                          value: "right",
                          label: "Invertido (Dir = R, Esq = ZR)",
                        },
                      ]}
                    />
                    <SelectField
                      label="Lado do Joy-Con"
                      theme="dark"
                      value={activeProfile.mouseSwitch2Side}
                      onChange={(e) =>
                        void persistProfile(
                          {
                            ...activeProfile,
                            mouseSwitch2Side: e.target.value as
                              | "right"
                              | "left",
                          },
                          true
                        )
                      }
                      options={[
                        {
                          key: "right",
                          value: "right",
                          label: "Joy-Con Direito (Padrão)",
                        },
                        {
                          key: "left",
                          value: "left",
                          label: "Joy-Con Esquerdo",
                        },
                      ]}
                    />
                    <CheckboxField
                      label="Inverter Eixo Y do Ponteiro"
                      checked={activeProfile.mouseSwitch2InvertY}
                      onChange={() =>
                        void persistProfile(
                          {
                            ...activeProfile,
                            mouseSwitch2InvertY:
                              !activeProfile.mouseSwitch2InvertY,
                          },
                          true
                        )
                      }
                    />
                  </>
                )}
              </div>
            )}

            <div className="controllers-page__sync-footer">
              <Button
                theme="outline"
                size="small"
                onClick={async () => {
                  await window.electron.controllersExportMappings();
                  showSuccessToast(
                    "Mapeamentos exportados para Switch 1/2 e Red Wine."
                  );
                }}
              >
                <RefreshCw size={14} /> Aplicar em Todos os Jogos
              </Button>
            </div>
          </div>
        </div>
      )}

      <Modal
        visible={showNewProfileModal}
        title="Novo Perfil de Controle"
        description="Crie um novo perfil de remapeamento (ex: FPS, Zelda, Co-op P2, Red Wine Xbox)."
        onClose={() => setShowNewProfileModal(false)}
      >
        <div className="controllers-page__modal-form">
          <TextField
            label="Nome do Perfil"
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            placeholder="Ex: DualSense Co-op"
          />
          <div className="controllers-page__modal-actions">
            <Button
              theme="outline"
              onClick={() => setShowNewProfileModal(false)}
            >
              Cancelar
            </Button>
            <Button
              theme="primary"
              onClick={handleCreateProfile}
              disabled={!newProfileName.trim()}
            >
              Criar Perfil
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
