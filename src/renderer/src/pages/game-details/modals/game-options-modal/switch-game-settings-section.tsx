import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cloud,
  Download,
  FolderOpen,
  Gamepad2,
  Hammer,
  MinusCircle,
  PlusCircle,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import cn from "classnames";
import type {
  ControllersState,
  Game,
  NxGameModItem,
  NxGamePreset,
  NxGameRuntimeConfig,
} from "@types";
import {
  Badge,
  Button,
  CheckboxField,
  SelectField,
  TextField,
} from "@renderer/components";
import { useToast } from "@renderer/hooks";
import "./switch-game-settings-section.scss";

interface SwitchGameSettingsSectionProps {
  game: Game;
  onOpenPortModal?: () => void;
}

const LANGUAGE_LABELS: Record<string, string> = {
  "pt-BR": "🇧🇷 Português (Brasil) [pt-BR]",
  pt: "🇵🇹 Português [pt]",
  "en-US": "🇺🇸 American English [en-US]",
  "en-GB": "🇬🇧 British English [en-GB]",
  "es-419": "🇲🇽 Español (LatAm) [es-419]",
  es: "🇪🇸 Español [es]",
  fr: "🇫🇷 Français [fr]",
  "fr-CA": "🇨🇦 Français (Canada) [fr-CA]",
  de: "🇩🇪 Deutsch [de]",
  it: "🇮🇹 Italiano [it]",
  nl: "🇳🇱 Nederlands [nl]",
  ru: "🇷🇺 Русский [ru]",
  ja: "🇯🇵 日本語 [ja]",
  ko: "🇰🇷 한국어 [ko]",
  "zh-Hans": "🇨🇳 简体中文 [zh-Hans]",
  "zh-Hant": "🇹🇼 繁體中文 [zh-Hant]",
};

export function SwitchGameSettingsSection({
  game,
  onOpenPortModal,
}: Readonly<SwitchGameSettingsSectionProps>) {
  const { showSuccessToast, showErrorToast } = useToast();

  const shop: "switch1" | "switch2" =
    game.shop === "switch2" ? "switch2" : "switch1";
  const titleId = (game.switchTitleId || game.objectId).toUpperCase();
  const isOot =
    titleId === "0400486024DEC000" ||
    game.title.toLowerCase().includes("ocarina");

  const [config, setConfig] = useState<NxGameRuntimeConfig | null>(null);
  const [presets, setPresets] = useState<NxGamePreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [newPresetName, setNewPresetName] = useState("");

  const [controllersState, setControllersState] =
    useState<ControllersState | null>(null);
  const [supportedLanguages, setSupportedLanguages] = useState<string[]>([
    "en-US",
    "pt-BR",
  ]);
  const [mods, setMods] = useState<NxGameModItem[]>([]);
  const [iCloudStatus, setICloudStatus] = useState({
    available: false,
    enabled: false,
  });
  const [isSaving, setIsSaving] = useState(false);

  const loadAll = useCallback(async () => {
    const cfgPromise = window.electron.nxGetGameRuntimeConfig(
      shop,
      game.objectId
    );
    const presetsPromise = window.electron.nxListPresets(titleId, game.title);
    const ctrlPromise = window.electron.controllersGetState();
    const langsPromise = window.electron.nxGetGameLanguages(
      game.switchPortedAppPath || game.executablePath || ""
    );
    const modsPromise = window.electron.nxListMods(
      titleId,
      game.switchPortedAppPath || game.executablePath || null
    );
    const icloudPromise = window.electron.nxGetGameICloudStatus(titleId);

    // Resolve runtime config immediately so the modal renders without waiting for auxiliary checks
    const cfg = await cfgPromise;
    setConfig(cfg);

    const [presetList, ctrlState, langs, modList, icloud] = await Promise.all([
      presetsPromise,
      ctrlPromise,
      langsPromise,
      modsPromise,
      icloudPromise,
    ]);

    setPresets(presetList);
    setControllersState(ctrlState);
    setSupportedLanguages(langs.supported);
    setMods(modList);
    setICloudStatus(icloud);
  }, [
    shop,
    game.objectId,
    game.title,
    game.switchPortedAppPath,
    game.executablePath,
    titleId,
  ]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const configuredSlots = useMemo(() => {
    const slots = new Set<number>([0]);
    if (config?.playerProfileIds) {
      for (const k of Object.keys(config.playerProfileIds)) {
        const idx = Number.parseInt(k, 10);
        if (idx >= 0 && idx < 8) slots.add(idx);
      }
    }
    return Array.from(slots).sort((a, b) => a - b);
  }, [config?.playerProfileIds]);

  const patchConfig = (partial: Partial<NxGameRuntimeConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      await window.electron.nxSaveGameRuntimeConfig(
        shop,
        game.objectId,
        config
      );
      showSuccessToast("Configurações Switch salvas e aplicadas no env.txt!");
    } catch {
      showErrorToast("Erro ao salvar configurações Switch.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const found = presets.find((p) => p.id === presetId);
    if (!found || !config) return;
    setConfig({
      ...config,
      ...found.config,
      gameLanguage: config.gameLanguage,
      controllerProfileId: config.controllerProfileId,
      playerProfileIds: config.playerProfileIds,
    });
    showSuccessToast(`Preset "${found.name}" aplicado (clique em Salvar).`);
  };

  const handleSaveCustomPreset = async () => {
    if (!config || !newPresetName.trim()) return;
    await window.electron.nxSavePreset(
      titleId,
      newPresetName.trim(),
      config,
      game.title
    );
    setNewPresetName("");
    setPresets(await window.electron.nxListPresets(titleId, game.title));
    showSuccessToast("Preset .nxn salvo!");
  };

  const handleImportPreset = async () => {
    const imported = await window.electron.nxImportPresetDialog(
      titleId,
      game.title
    );
    if (!imported) return;
    setPresets(await window.electron.nxListPresets(titleId, game.title));
    setConfig((prev) => (prev ? { ...prev, ...imported.config } : prev));
    showSuccessToast(`Preset "${imported.name}" importado.`);
  };

  const handleExportSelectedPreset = async () => {
    if (!config) return;
    const preset: NxGamePreset = presets.find(
      (p) => p.id === selectedPresetId
    ) || {
      id: "current",
      name: `${game.title}_Preset`,
      titleId,
      isBuiltIn: false,
      config,
      createdAt: new Date().toISOString(),
    };
    const out = await window.electron.nxExportPresetDialog(preset, game.title);
    if (out) showSuccessToast(`Preset exportado em ${out}`);
  };

  const handleAddCoopSlot = () => {
    if (!config || !controllersState) return;
    const nextSlot = [0, 1, 2, 3, 4, 5, 6, 7].find(
      (i) => !configuredSlots.includes(i)
    );
    if (nextSlot === undefined) return;
    const defaultId =
      controllersState.playerProfileIds[String(nextSlot)] ||
      controllersState.activeProfileId;
    patchConfig({
      playerProfileIds: {
        ...(config.playerProfileIds || {}),
        [String(nextSlot)]: defaultId,
      },
    });
  };

  const handleRemoveCoopSlot = (slot: number) => {
    if (!config || slot === 0) return;
    const nextMap = { ...(config.playerProfileIds || {}) };
    delete nextMap[String(slot)];
    patchConfig({
      playerProfileIds: Object.keys(nextMap).length > 0 ? nextMap : null,
    });
  };

  const handleSetSlotProfile = (slot: number, profileId: string) => {
    if (!config) return;
    const nextMap = { ...(config.playerProfileIds || {}) };
    if (!profileId) {
      delete nextMap[String(slot)];
    } else {
      nextMap[String(slot)] = profileId;
    }
    patchConfig({
      playerProfileIds: Object.keys(nextMap).length > 0 ? nextMap : null,
      ...(slot === 0 ? { controllerProfileId: profileId || null } : {}),
    });
  };

  const handleToggleICloud = async () => {
    const next = !iCloudStatus.enabled;
    const res = await window.electron.nxSetGameICloudSync(titleId, next);
    if (res.ok) {
      setICloudStatus((prev) => ({ ...prev, enabled: res.enabled }));
      showSuccessToast(
        res.enabled
          ? "Sincronização iCloud ativada para este jogo."
          : "Saves revertidos para armazenamento local."
      );
    } else {
      showErrorToast(res.error || "Falha ao alterar sincronização iCloud.");
    }
  };

  if (!config) {
    return <p>Carregando configurações do jogo Switch...</p>;
  }

  return (
    <div className="switch-game-settings">
      <div className="switch-game-settings__top-bar">
        <div>
          <h3>
            {shop === "switch2" ? "Switch 2" : "Switch 1"} — Configurações
            Nativas
          </h3>
          <small>
            Title ID: <code>{titleId}</code> · Salvo em env.txt, Info.plist e
            input_mapping.json
          </small>
        </div>
        <div className="switch-game-settings__top-actions">
          {onOpenPortModal && (
            <Button theme="outline" size="small" onClick={onOpenPortModal}>
              <Hammer size={13} /> Re-portar
            </Button>
          )}
          <Button
            theme="primary"
            size="small"
            onClick={handleSave}
            disabled={isSaving}
          >
            <Save size={13} />{" "}
            {isSaving ? "Salvando..." : "Salvar Configurações"}
          </Button>
        </div>
      </div>

      {/* 1. Predefinições (Presets .nxn) */}
      <div className="switch-game-settings__card">
        <h4>Predefinições (Presets .nxn)</h4>
        <div className="switch-game-settings__row">
          <SelectField
            theme="dark"
            value={selectedPresetId}
            onChange={(e) => handleApplyPreset(e.target.value)}
            options={[
              { key: "", value: "", label: "Selecionar preset..." },
              ...presets.map((p) => ({
                key: p.id,
                value: p.id,
                label: `${p.name}${p.isBuiltIn ? " (Embutido)" : " (.nxn)"}`,
              })),
            ]}
          />
          <Button theme="outline" size="small" onClick={handleImportPreset}>
            <Upload size={13} /> Importar .nxn
          </Button>
          <Button
            theme="outline"
            size="small"
            onClick={handleExportSelectedPreset}
          >
            <Download size={13} /> Exportar .nxn
          </Button>
        </div>
        <div className="switch-game-settings__row">
          <TextField
            theme="dark"
            placeholder="Nome para salvar configuração atual como preset..."
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            rightContent={
              <Button
                theme="outline"
                size="small"
                onClick={handleSaveCustomPreset}
                disabled={!newPresetName.trim()}
              >
                Salvar Preset
              </Button>
            }
          />
        </div>
      </div>

      {/* 2. Taxa de Quadros Alvo (60 FPS + Framegen) */}
      <div className="switch-game-settings__card">
        <h4>Taxa de Quadros Alvo (60 FPS &amp; Framegen)</h4>
        <CheckboxField
          label="Desbloquear 60 FPS (desmarcado = 30 FPS padrão)"
          checked={config.enable60FPS}
          onChange={() => patchConfig({ enable60FPS: !config.enable60FPS })}
        />
        <CheckboxField
          label="Ativar Frame Generation Experimental (DM_FRAMEGEN — 60→120Hz ProMotion ou 30→60 FPS)"
          checked={config.ootExperimentalFrameGen}
          onChange={() =>
            patchConfig({
              ootExperimentalFrameGen: !config.ootExperimentalFrameGen,
            })
          }
        />
        {config.ootExperimentalFrameGen && (
          <SelectField
            label="Cadência do Framegen"
            theme="dark"
            value={String(config.ootFrameGenMaxK)}
            onChange={(e) =>
              patchConfig({
                ootFrameGenMaxK: e.target.value === "2" ? 2 : 4,
              })
            }
            options={[
              { key: "2", value: "2", label: "Fixo 2x (Smooth 60/120)" },
              { key: "4", value: "4", label: "Adaptativo 2x–4x (ProMotion)" },
            ]}
          />
        )}
      </div>

      {/* 3. macOS Game Mode & Metal HUD */}
      <div className="switch-game-settings__card">
        <h4>macOS Game Mode &amp; Monitor de Desempenho</h4>
        <CheckboxField
          label="macOS Game Mode (Tela Cheia dedicada + LSSupportsGameMode)"
          checked={config.enableGameMode}
          onChange={() =>
            patchConfig({ enableGameMode: !config.enableGameMode })
          }
        />
        <CheckboxField
          label="Monitor de Desempenho — Metal Performance HUD (DM_METAL_HUD)"
          checked={config.enableMetalHUD}
          onChange={() =>
            patchConfig({ enableMetalHUD: !config.enableMetalHUD })
          }
        />
      </div>

      {/* 4. Modo do Console, Escala 3D e MetalFX */}
      <div className="switch-game-settings__card">
        <h4>Gráficos, Modo do Console &amp; MetalFX</h4>

        <div className="switch-game-settings__segmented">
          <button
            type="button"
            className={cn({ active: config.isDockedMode })}
            onClick={() => patchConfig({ isDockedMode: true })}
          >
            Modo Dock (1080p)
          </button>
          <button
            type="button"
            className={cn({ active: !config.isDockedMode })}
            onClick={() => patchConfig({ isDockedMode: false })}
          >
            Modo Portátil (720p)
          </button>
        </div>

        <div className="switch-game-settings__slider-row">
          <span>Escala de Renderização 3D (DM_RENDER_SCALE)</span>
          <strong>{Math.round(config.renderScale * 100)}%</strong>
        </div>
        <input
          type="range"
          min={0.5}
          max={1.0}
          step={0.05}
          value={config.renderScale}
          onChange={(e) =>
            patchConfig({ renderScale: Number.parseFloat(e.target.value) })
          }
        />
        <div className="switch-game-settings__quick-scales">
          {[0.5, 0.75, 1.0].map((val) => (
            <Button
              key={val}
              theme="outline"
              size="small"
              onClick={() => patchConfig({ renderScale: val })}
            >
              {val === 1 ? "100% Nativo" : `${Math.round(val * 100)}%`}
            </Button>
          ))}
        </div>

        <CheckboxField
          label="Upscaling Inteligente — MetalFX Spatial (DM_PRESENT_UPSCALE=metalfx)"
          checked={config.enableMetalFXUpscale}
          onChange={() =>
            patchConfig({
              enableMetalFXUpscale: !config.enableMetalFXUpscale,
            })
          }
        />

        {isOot && (
          <div className="switch-game-settings__oot-box">
            <strong>Otimizações Zelda: Ocarina of Time Enhanced</strong>
            <SelectField
              label="Upscaler OoT"
              theme="dark"
              value={config.ootUpscalerMode}
              onChange={(e) =>
                patchConfig({
                  ootUpscalerMode: e.target.value as "off" | "metalfx" | "game",
                })
              }
              options={[
                {
                  key: "off",
                  value: "off",
                  label: "UltraBoost Nativo (Bypass NDSR)",
                },
                { key: "metalfx", value: "metalfx", label: "MetalFX" },
                { key: "game", value: "game", label: "Original (NDSR)" },
              ]}
            />
            <CheckboxField
              label="Modo 16GB RAM (DM_GUEST_FILE + DM_TEX_RELEASE=0)"
              checked={config.oot16GBRamMode}
              onChange={() =>
                patchConfig({ oot16GBRamMode: !config.oot16GBRamMode })
              }
            />
            <CheckboxField
              label="Motion Blur de Câmera"
              checked={config.ootMotionBlur}
              onChange={() =>
                patchConfig({ ootMotionBlur: !config.ootMotionBlur })
              }
            />
          </div>
        )}
      </div>

      {/* 5. Perfil do Controle & Co-op (P1..P8) */}
      <div className="switch-game-settings__card">
        <div className="switch-game-settings__card-head">
          <h4>
            <Gamepad2 size={15} /> Perfil do Controle &amp; Co-op (
            {configuredSlots.length}/8)
          </h4>
          {config.enableGamepadProfile && configuredSlots.length < 8 && (
            <Button theme="outline" size="small" onClick={handleAddCoopSlot}>
              <PlusCircle size={13} /> Adicionar Controle (Co-op)
            </Button>
          )}
        </div>

        <CheckboxField
          label="Aplicar perfil de remapeamento personalizado neste jogo"
          checked={config.enableGamepadProfile}
          onChange={() =>
            patchConfig({
              enableGamepadProfile: !config.enableGamepadProfile,
            })
          }
        />

        {config.enableGamepadProfile && controllersState && (
          <div className="switch-game-settings__slots">
            {configuredSlots.map((slot) => {
              const assigned =
                config.playerProfileIds?.[String(slot)] ??
                (slot === 0 ? (config.controllerProfileId ?? "") : "");
              return (
                <div key={slot} className="switch-game-settings__slot-row">
                  <Badge>P{slot + 1}</Badge>
                  <SelectField
                    theme="dark"
                    value={assigned}
                    onChange={(e) => handleSetSlotProfile(slot, e.target.value)}
                    options={[
                      {
                        key: "global",
                        value: "",
                        label: `Usar Perfil Global (P${slot + 1})`,
                      },
                      ...controllersState.profiles.map((p) => ({
                        key: p.id,
                        value: p.id,
                        label: p.name,
                      })),
                    ]}
                  />
                  {slot > 0 && (
                    <button
                      type="button"
                      className="switch-game-settings__remove-slot"
                      onClick={() => handleRemoveCoopSlot(slot)}
                      title="Remover jogador"
                    >
                      <MinusCircle size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 6. Idioma Padrão do Jogo */}
      <div className="switch-game-settings__card">
        <h4>Idioma Padrão do Jogo (DM_LANG)</h4>
        <SelectField
          theme="dark"
          value={config.gameLanguage || supportedLanguages[0] || "en-US"}
          onChange={(e) => patchConfig({ gameLanguage: e.target.value })}
          options={supportedLanguages.map((code) => ({
            key: code,
            value: code,
            label: LANGUAGE_LABELS[code] || code,
          }))}
        />
      </div>

      {/* 7. Mods do Jogo (LayeredFS) */}
      <div className="switch-game-settings__card">
        <div className="switch-game-settings__card-head">
          <h4>Mods do Jogo (LayeredFS — DM_ROMFS_OVERLAY)</h4>
          <div className="switch-game-settings__row">
            <Button
              theme="outline"
              size="small"
              onClick={() => window.electron.nxOpenModsFolder(titleId)}
            >
              <FolderOpen size={13} /> Abrir Pasta
            </Button>
            <Button
              theme="primary"
              size="small"
              onClick={async () => {
                const updated =
                  await window.electron.nxInstallModDialog(titleId);
                if (updated) {
                  setMods(updated);
                  showSuccessToast(
                    "Mod instalado! Salve para atualizar o overlay."
                  );
                }
              }}
            >
              <PlusCircle size={13} /> Instalar Mod (.zip / Pasta)
            </Button>
          </div>
        </div>

        {mods.length === 0 ? (
          <small>Nenhum mod LayeredFS instalado para este jogo.</small>
        ) : (
          <div className="switch-game-settings__mods-list">
            {mods.map((mod) => (
              <div key={mod.id} className="switch-game-settings__mod-row">
                <div>
                  <CheckboxField
                    label={mod.name}
                    checked={mod.isEnabled}
                    onChange={async () => {
                      const updated = await window.electron.nxToggleMod(
                        titleId,
                        mod.folderPath
                      );
                      setMods(updated);
                    }}
                  />
                  <div className="switch-game-settings__row">
                    {mod.hasAssetPatches && <Badge>RomFS</Badge>}
                    {mod.hasCodePatches && <Badge>ExeFS</Badge>}
                  </div>
                </div>
                <Button
                  theme="danger"
                  size="small"
                  onClick={async () => {
                    const updated = await window.electron.nxDeleteMod(
                      titleId,
                      mod.folderPath
                    );
                    setMods(updated);
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 8. Sincronização iCloud */}
      <div className="switch-game-settings__card">
        <div className="switch-game-settings__card-head">
          <h4>
            <Cloud size={15} /> Sincronização de Saves (iCloud Drive)
          </h4>
          <Button
            theme="outline"
            size="small"
            onClick={() => window.electron.nxOpenSaveFolder(titleId)}
          >
            <FolderOpen size={13} /> Pasta de Saves
          </Button>
        </div>

        <CheckboxField
          label={
            iCloudStatus.available
              ? "Sincronizar saves deste jogo via iCloud Drive (Cross-Save Mac ↔ iPhone)"
              : "iCloud Drive indisponível neste Mac"
          }
          disabled={!iCloudStatus.available}
          checked={iCloudStatus.enabled}
          onChange={handleToggleICloud}
        />
      </div>
    </div>
  );
}
