import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  Gamepad2,
  Globe,
  ListTodo,
  RefreshCw,
  RotateCcw,
  Settings,
} from "lucide-react";
import type {
  CrossOverGraphicsBackend,
  CrossOverProvisionProgress,
  CrossOverStatus,
  CrossOverSyncMode,
  HeadBottleDependenciesStatus,
  RedWineBottleConfig,
} from "@types";
import {
  Badge,
  Button,
  CheckboxField,
  ProgressBar,
  SelectField,
} from "@renderer/components";
import { useToast } from "@renderer/hooks";
import "./settings-nxnative-panel.scss";

type ControlTool = "winecfg" | "joy" | "reboot" | "taskmgr" | "inetcpl";

interface ToolSpec {
  id: ControlTool;
  icon: typeof Settings;
  pt: [string, string];
  en: [string, string];
}

const TOOLS: ToolSpec[] = [
  {
    id: "winecfg",
    icon: Settings,
    pt: [
      "Configuração do Wine",
      "Ajustes gerais, áudio, drivers e versão do Windows",
    ],
    en: [
      "Wine Configuration",
      "General settings, audio, drives, and Windows version",
    ],
  },
  {
    id: "joy",
    icon: Gamepad2,
    pt: [
      "Controles de Jogos",
      "Calibrar, testar e mapear controles SDL/XInput",
    ],
    en: ["Game Controllers", "Calibrate, test, and map SDL/XInput controllers"],
  },
  {
    id: "reboot",
    icon: RotateCcw,
    pt: [
      "Simular Reinicialização",
      "Reinicia a sessão Windows e recarrega o registro",
    ],
    en: [
      "Simulate Reboot",
      "Restarts the Windows session and reloads registry",
    ],
  },
  {
    id: "taskmgr",
    icon: ListTodo,
    pt: [
      "Gerenciador de Tarefas",
      "Visualizar processos em execução e encerrar tarefas",
    ],
    en: [
      "Task Manager",
      "Inspect running Windows processes and terminate tasks",
    ],
  },
  {
    id: "inetcpl",
    icon: Globe,
    pt: [
      "Configurações da Internet",
      "Proxy, certificados e protocolos TLS/SSL",
    ],
    en: ["Internet Settings", "Proxy, certificates, and TLS/SSL protocols"],
  },
];

const GRAPHICS_OPTIONS: Array<{
  key: CrossOverGraphicsBackend;
  value: CrossOverGraphicsBackend;
  label: string;
}> = [
  { key: "d3dmetal", value: "d3dmetal", label: "D3DMetal (Metal + DX11/DX12)" },
  { key: "dxmt", value: "dxmt", label: "DXMT (Metal Direct3D 11)" },
  { key: "dxvk", value: "dxvk", label: "DXVK (Vulkan / MoltenVK)" },
  { key: "wined3d", value: "wined3d", label: "WineD3D (OpenGL Fallback)" },
];

const SYNC_OPTIONS: Array<{
  key: CrossOverSyncMode;
  value: CrossOverSyncMode;
  label: string;
}> = [
  { key: "msync", value: "msync", label: "MSync (Recomendado Apple Silicon)" },
  { key: "esync", value: "esync", label: "ESync (Eventfd Sync)" },
  { key: "none", value: "none", label: "Padrão (Sem MSync/ESync)" },
];

const WINVER_OPTIONS: Array<{
  key: RedWineBottleConfig["windowsVersion"];
  value: RedWineBottleConfig["windowsVersion"];
  label: string;
}> = [
  { key: "win11", value: "win11", label: "Windows 11 (64-bit)" },
  { key: "win10", value: "win10", label: "Windows 10 (64-bit)" },
  { key: "win7", value: "win7", label: "Windows 7 (Compatibilidade)" },
];

export function SettingsRedWinePanel() {
  const { i18n } = useTranslation();
  const { showSuccessToast, showErrorToast } = useToast();
  const isPt = i18n.language?.toLowerCase().startsWith("pt");
  const tr = (pt: string, en: string) => (isPt ? pt : en);

  const [status, setStatus] = useState<CrossOverStatus | null>(null);
  const [headBottleDeps, setHeadBottleDeps] =
    useState<HeadBottleDependenciesStatus | null>(null);
  const [bottleConfig, setBottleConfig] = useState<RedWineBottleConfig | null>(
    null
  );
  const [provisionProgress, setProvisionProgress] =
    useState<CrossOverProvisionProgress | null>(null);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async (fetchRemote = false) => {
    const [st, hb, cfg] = await Promise.all([
      window.electron.getCrossOverStatus(fetchRemote).catch(() => null),
      window.electron.getHeadBottleDependenciesStatus().catch(() => null),
      window.electron.getRedWineBottleConfig().catch(() => null),
    ]);
    if (st) setStatus(st);
    if (hb) setHeadBottleDeps(hb);
    if (cfg) setBottleConfig(cfg);
  }, []);

  useEffect(() => {
    void refresh(false);

    const unsubscribe = window.electron.onCrossOverProvisionProgress(
      (progress) => {
        setProvisionProgress(progress);
        if (progress.phase === "done" || progress.phase === "error") {
          setIsProvisioning(false);
          void refresh(false);
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [refresh]);

  const handleProvisionRedWine = async () => {
    setIsProvisioning(true);
    setProvisionProgress({
      phase: "checking",
      progress: 5,
      message: tr(
        "Verificando motor Red Wine e ambiente Head Bottle...",
        "Checking Red Wine engine and Head Bottle environment..."
      ),
    });

    try {
      const currentStatus = await window.electron.getCrossOverStatus(true);
      if (!currentStatus.installed) {
        const engineRes = await window.electron.installCrossOverDemo();
        if (!engineRes.success) {
          showErrorToast(
            engineRes.error ||
              tr(
                "Falha ao instalar motor Red Wine.",
                "Failed to install Red Wine engine."
              )
          );
          return;
        }
      }

      const res = await window.electron.provisionHeadBottleDependencies();
      if (res.success) {
        await window.electron.saveRedWineBottleConfig({
          graphicsBackend: "d3dmetal",
          syncMode: "msync",
          windowsVersion: "win11",
          rosettaAvx: true,
          sdlGamepadEnabled: true,
          tlsModernEnabled: true,
        });
        showSuccessToast(
          tr(
            "Red Wine configurado com Head Bottle, dependências e padrões do Painel de Controle!",
            "Red Wine configured with Head Bottle, dependencies, and Control Panel defaults!"
          )
        );
        await refresh(false);
      } else {
        showErrorToast(
          res.error ||
            tr(
              "Falha ao configurar dependências do Red Wine.",
              "Failed to configure Red Wine dependencies."
            )
        );
      }
    } finally {
      setIsProvisioning(false);
    }
  };

  const updateConfig = async (patch: Partial<RedWineBottleConfig>) => {
    setBusy("config");
    try {
      const updated = await window.electron.saveRedWineBottleConfig(patch);
      setBottleConfig(updated);
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : "Red Wine");
    } finally {
      setBusy(null);
    }
  };

  const reapplyOptimal = async () => {
    setBusy("reapply");
    try {
      const updated = await window.electron.saveRedWineBottleConfig({
        graphicsBackend: "d3dmetal",
        syncMode: "msync",
        windowsVersion: "win11",
        rosettaAvx: true,
        metalHud: false,
        highResolutionMode: false,
        sdlGamepadEnabled: true,
        tlsModernEnabled: true,
      });
      setBottleConfig(updated);
      showSuccessToast(
        tr(
          "Configurações padrão do Red Wine aplicadas ao registro e ambiente",
          "Red Wine default settings applied to registry and environment"
        )
      );
      await refresh(false);
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : "Red Wine");
    } finally {
      setBusy(null);
    }
  };

  const launch = async (tool: ControlTool) => {
    setBusy(tool);
    try {
      const res = await window.electron.launchRedWineControlPanelTool(tool);
      if (!res.success) showErrorToast(res.error ?? "Red Wine");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="settings-nxnative">
      {/* 1. Motor Red Wine & Head Bottle */}
      <div className="settings-context-panel__group">
        <div className="settings-nxnative__section-head">
          <h3>
            {tr(
              "Red Wine — Motor Windows & Head Bottle (Default)",
              "Red Wine — Windows Engine & Head Bottle (Default)"
            )}
          </h3>
          <Button
            theme="outline"
            size="small"
            onClick={() => void refresh(true)}
            disabled={isProvisioning || busy !== null}
          >
            <RefreshCw size={13} />
            {tr("Atualizar status", "Refresh status")}
          </Button>
        </div>

        <div className="settings-nxnative__repo-card">
          <div className="settings-nxnative__repo-meta">
            <div>
              <strong>
                {tr(
                  "Ambiente Unificado Red Wine (Head Bottle)",
                  "Unified Red Wine Environment (Head Bottle)"
                )}
              </strong>
              <small>
                {tr(
                  "Executa jogos e instaladores Windows no Apple Silicon sem expor detalhes internos.",
                  "Runs Windows games and installers on Apple Silicon with pre-configured runtime defaults."
                )}
              </small>
              <span className="settings-nxnative__commit-line">
                {tr("Motor", "Engine")}:{" "}
                {status?.installed
                  ? `Red Wine ${status.version ? `v${status.version}` : tr("Pronto", "Ready")}`
                  : tr("Ausente", "Missing")}{" "}
                · Bottle:{" "}
                {headBottleDeps?.bottleReady
                  ? tr("Pronta", "Ready")
                  : tr("Pendente", "Pending")}{" "}
                · VC++:{" "}
                {headBottleDeps?.vcredist ? "OK" : tr("Pendente", "Pending")} ·
                DirectX:{" "}
                {headBottleDeps?.directx ? "OK" : tr("Pendente", "Pending")} ·
                Steam:{" "}
                {headBottleDeps?.steam ? "OK" : tr("Pendente", "Pending")} ·
                Epic: {headBottleDeps?.epic ? "OK" : tr("Pendente", "Pending")}
              </span>
            </div>
            <Badge>
              {status?.installed && headBottleDeps?.bottleReady
                ? "OK"
                : tr("Pendente", "Pending")}
            </Badge>
          </div>

          {isProvisioning && provisionProgress && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <small>
                {provisionProgress.message ||
                  tr("Configurando...", "Configuring...")}
              </small>
              <ProgressBar
                now={provisionProgress.progress}
                max={100}
                label="Red Wine setup"
                completed={provisionProgress.progress === 100}
              />
            </div>
          )}

          <div className="settings-nxnative__inline-btns">
            <Button
              theme="primary"
              size="small"
              onClick={() => void handleProvisionRedWine()}
              disabled={isProvisioning || busy !== null}
            >
              <Download size={13} />
              {isProvisioning
                ? tr("Configurando Red Wine...", "Configuring Red Wine...")
                : tr(
                    "Instalar / Verificar Red Wine e Dependências",
                    "Install / Verify Red Wine & Dependencies"
                  )}
            </Button>
            <Button
              theme="outline"
              size="small"
              onClick={() => void reapplyOptimal()}
              disabled={isProvisioning || busy !== null || !status?.installed}
            >
              {tr("Reaplicar padrões ideais", "Reapply optimal defaults")}
            </Button>
          </div>
        </div>
      </div>

      {/* 2. Configurações Padrão da Garrafa Head Bottle */}
      <div className="settings-context-panel__group">
        <div className="settings-nxnative__section-head">
          <h3>
            {tr(
              "Configurações Padrão do Ambiente",
              "Default Environment Settings"
            )}
          </h3>
        </div>

        <div className="settings-nxnative__repo-card">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: 12,
            }}
          >
            <SelectField
              label={tr("Backend Gráfico Padrão", "Default Graphics Backend")}
              value={bottleConfig?.graphicsBackend ?? "d3dmetal"}
              options={GRAPHICS_OPTIONS}
              disabled={!status?.installed || busy !== null}
              onChange={(e) =>
                void updateConfig({
                  graphicsBackend: e.target.value as CrossOverGraphicsBackend,
                })
              }
            />
            <SelectField
              label={tr("Sincronização (Sync)", "Threading Sync Mode")}
              value={bottleConfig?.syncMode ?? "msync"}
              options={SYNC_OPTIONS}
              disabled={!status?.installed || busy !== null}
              onChange={(e) =>
                void updateConfig({
                  syncMode: e.target.value as CrossOverSyncMode,
                })
              }
            />
            <SelectField
              label={tr(
                "Versão do Windows (winecfg)",
                "Windows Version (winecfg)"
              )}
              value={bottleConfig?.windowsVersion ?? "win11"}
              options={WINVER_OPTIONS}
              disabled={!status?.installed || busy !== null}
              onChange={(e) =>
                void updateConfig({
                  windowsVersion: e.target
                    .value as RedWineBottleConfig["windowsVersion"],
                })
              }
            />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginTop: 4,
            }}
          >
            <CheckboxField
              label={tr(
                "Anunciar AVX via Rosetta (ROSETTA_ADVERTISE_AVX)",
                "Advertise AVX via Rosetta (ROSETTA_ADVERTISE_AVX)"
              )}
              checked={bottleConfig?.rosettaAvx ?? true}
              disabled={!status?.installed || busy !== null}
              onChange={(e) =>
                void updateConfig({ rosettaAvx: e.target.checked })
              }
            />
            <CheckboxField
              label={tr(
                "Metal Performance HUD por padrão",
                "Enable Metal Performance HUD by default"
              )}
              checked={bottleConfig?.metalHud ?? false}
              disabled={!status?.installed || busy !== null}
              onChange={(e) =>
                void updateConfig({ metalHud: e.target.checked })
              }
            />
            <CheckboxField
              label={tr(
                "Modo Alta Resolução (Retina)",
                "High Resolution Mode (Retina)"
              )}
              checked={bottleConfig?.highResolutionMode ?? false}
              disabled={!status?.installed || busy !== null}
              onChange={(e) =>
                void updateConfig({ highResolutionMode: e.target.checked })
              }
            />
            <CheckboxField
              label={tr(
                "Controles de Jogos via SDL / Map Controllers (joy.cpl)",
                "SDL Gamepad & Controller Mapping (joy.cpl)"
              )}
              checked={bottleConfig?.sdlGamepadEnabled ?? true}
              disabled={!status?.installed || busy !== null}
              onChange={(e) =>
                void updateConfig({ sdlGamepadEnabled: e.target.checked })
              }
            />
            <CheckboxField
              label={tr(
                "Protocolos TLS 1.1 / 1.2+ modernos (inetcpl.cpl)",
                "Modern TLS 1.1 / 1.2+ Protocols (inetcpl.cpl)"
              )}
              checked={bottleConfig?.tlsModernEnabled ?? true}
              disabled={!status?.installed || busy !== null}
              onChange={(e) =>
                void updateConfig({ tlsModernEnabled: e.target.checked })
              }
            />
          </div>

          <small>
            {tr(
              "Driver de áudio CoreAudio, WineDbg/DllOverrides e 10 núcleos de CPU já são pré-aplicados automaticamente no provisionamento.",
              "CoreAudio driver, DllOverrides, and CPU count overrides are automatically applied during provisioning."
            )}
          </small>
        </div>
      </div>

      {/* 3. Painel de Controle */}
      <div className="settings-context-panel__group">
        <div className="settings-nxnative__section-head">
          <h3>{tr("PAINEL DE CONTROLE", "CONTROL PANEL")}</h3>
        </div>

        {TOOLS.map((tool) => {
          const [name, desc] = isPt ? tool.pt : tool.en;
          const Icon = tool.icon;
          return (
            <div key={tool.id} className="settings-nxnative__repo-card">
              <div className="settings-nxnative__repo-meta">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon size={18} />
                  <div>
                    <strong>{name}</strong>
                    <small>{desc}</small>
                  </div>
                </div>
                <Button
                  theme="outline"
                  size="small"
                  onClick={() => void launch(tool.id)}
                  disabled={busy !== null || !status?.installed}
                >
                  {tr("Abrir", "Open")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
