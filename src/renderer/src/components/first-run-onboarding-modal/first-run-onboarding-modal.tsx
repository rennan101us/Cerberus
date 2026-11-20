import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Download,
  Layers,
  Loader2,
  Play,
  Search,
  XCircle,
} from "lucide-react";
import cn from "classnames";
import type { CerberusGamingPlatform } from "@types";
import CerberusLogo from "@renderer/assets/icons/hydra.svg?react";
import {
  AndroidOfficialIcon,
  IosIpadOsIcon,
  MacOSLogoIcon,
  WindowsLogoIcon,
} from "../platform-icons/official-platform-icons";
import { Button } from "../button/button";
import { Modal } from "../modal/modal";
import { ProgressBar } from "../progress-bar/progress-bar";
import { useAppSelector } from "@renderer/hooks";
import "./first-run-onboarding-modal.scss";

export interface FirstRunOnboardingModalProps {
  visible: boolean;
  onClose: () => void;
  initialStep?: 1 | 2;
}

interface PlatformOption {
  id: CerberusGamingPlatform;
  title: string;
  subtitle: string;
  depsSummary: string;
  icon: React.ReactNode;
}

const PLATFORM_OPTIONS: PlatformOption[] = [
  {
    id: "windows",
    title: "Jogos Windows (Red Wine + Head Bottle)",
    subtitle: "Jogos PC, Repacks, Steam & Epic Games no macOS",
    depsSummary:
      "Red Wine Engine + Head Bottle (Default) com Steam, Epic Games, Visual C++ Redistributable e DirectX",
    icon: <WindowsLogoIcon size={20} />,
  },
  {
    id: "switch_mac",
    title: "Nintendo Switch 1 & 2 no macOS",
    subtitle: "Portes nativos Apple Silicon (.app)",
    depsSummary:
      "Homebrew, Git, Python 3 + módulos, .NET SDK, zstd, spirv-cross, glslang, Xcode CLT, XcodeGen e nxnative",
    icon: <MacOSLogoIcon size={20} />,
  },
  {
    id: "switch_ios",
    title: "Nintendo Switch no iOS / iPadOS",
    subtitle:
      "Envia apenas 1 único App Bundle com todos os jogos portados para iPhone e iPad",
    depsSummary:
      "Instala um único App Bundle (NX Hub) contendo todos os seus jogos portados + dependências Apple/Core e libimobiledevice (afcclient) para envio via USB/Xcode",
    icon: <IosIpadOsIcon size={20} />,
  },
  {
    id: "switch_android",
    title: "Nintendo Switch no Android",
    subtitle: "Compilação ARM64 / Vulkan (.apk) via nx2android",
    depsSummary:
      "Android Platform-Tools (adb), Android NDK (r27c) e repositório nx2android",
    icon: <AndroidOfficialIcon size={20} />,
  },
];

type TaskState = "pending" | "running" | "done" | "error";

export function FirstRunOnboardingModal({
  visible,
  onClose,
  initialStep = 1,
}: Readonly<FirstRunOnboardingModalProps>) {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [step, setStep] = useState<1 | 2 | 3>(initialStep);
  const [selectedPlatforms, setSelectedPlatforms] = useState<
    CerberusGamingPlatform[]
  >(["windows", "switch_mac"]);
  const [isRunning, setIsRunning] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [liveMessage, setLiveMessage] = useState("");
  const [platformStates, setPlatformStates] = useState<
    Partial<Record<CerberusGamingPlatform, TaskState>>
  >({});
  const [platformNotes, setPlatformNotes] = useState<
    Partial<Record<CerberusGamingPlatform, string>>
  >({});
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    setStep(initialStep);
    setSelectedPlatforms(
      userPreferences?.selectedGamingPlatforms?.length
        ? userPreferences.selectedGamingPlatforms
        : ["windows", "switch_mac"]
    );
    setIsRunning(false);
    setProgressPct(0);
    setLiveMessage("");
    setPlatformStates({});
    setPlatformNotes({});
  }, [visible, initialStep, userPreferences?.selectedGamingPlatforms]);

  useEffect(() => {
    if (!visible || step !== 3) return;

    const unsubRedWine = window.electron.onCrossOverProvisionProgress(
      (ev) => {
        if (ev.message) setLiveMessage(ev.message);
      }
    );
    const unsubNx = window.electron.onNxInstallerProgress((ev) => {
      if (ev.phase === "output" && ev.line) {
        setLiveMessage(ev.line);
      } else if (ev.phase === "start" && ev.itemName) {
        setLiveMessage(`Configurando ${ev.itemName}...`);
      }
    });

    return () => {
      unsubRedWine();
      unsubNx();
    };
  }, [visible, step]);

  const togglePlatform = (id: CerberusGamingPlatform) => {
    if (isRunning) return;
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSkipOnboarding = async () => {
    await window.electron.updateUserPreferences({
      hasCompletedFirstRunOnboarding: true,
      selectedGamingPlatforms: selectedPlatforms,
    });
    onClose();
  };

  const handleStartInstall = async () => {
    if (selectedPlatforms.length === 0 || isRunning) return;

    const runId = ++runIdRef.current;
    setStep(3);
    setIsRunning(true);
    setProgressPct(4);

    const initialMap: Partial<Record<CerberusGamingPlatform, TaskState>> = {};
    for (const p of selectedPlatforms) {
      initialMap[p] = "pending";
    }
    setPlatformStates(initialMap);
    setPlatformNotes({});

    const totalSteps = selectedPlatforms.length;
    let completedSteps = 0;

    for (const platform of selectedPlatforms) {
      if (runId !== runIdRef.current) return;

      setPlatformStates((prev) => ({ ...prev, [platform]: "running" }));
      const basePct = Math.round((completedSteps / totalSteps) * 90);
      setProgressPct(Math.max(5, basePct));

      try {
        if (platform === "windows") {
          setLiveMessage("Verificando motor Red Wine e Head Bottle (Default)...");
          const status = await window.electron.getCrossOverStatus(true);
          if (!status.installed) {
            setLiveMessage("Baixando e instalando motor Red Wine...");
            const installRes = await window.electron.installCrossOverDemo();
            if (!installRes.success) {
              throw new Error(installRes.error || "Falha ao instalar Red Wine");
            }
          }

          setLiveMessage(
            "Configurando Head Bottle (Default) com Steam, Epic, VC++ e DirectX..."
          );
          const bottleRes =
            await window.electron.provisionHeadBottleDependencies();
          if (!bottleRes.success) {
            throw new Error(
              bottleRes.error || "Falha ao provisionar Head Bottle (Default)"
            );
          }

          setPlatformNotes((prev) => ({
            ...prev,
            windows: "Red Wine e Head Bottle (Default) prontos",
          }));
        } else if (platform === "switch_mac") {
          setLiveMessage("Verificando dependências de compilação Switch macOS...");
          const depsRes =
            await window.electron.nxInstallMissingDependencies("macApp");
          if (!depsRes.ok) {
            throw new Error(
              depsRes.error || "Algumas ferramentas macOS falharam"
            );
          }

          const repos = await window.electron.nxGetRepoStatus(false);
          if (!repos.nxnative.isValid) {
            setLiveMessage("Clonando repositório nxnative (seedds/nxnative)...");
            const cloneRes = await window.electron.nxCloneRepo();
            if (!cloneRes.ok) {
              throw new Error(cloneRes.message);
            }
          }

          setPlatformNotes((prev) => ({
            ...prev,
            switch_mac: "Toolchain Switch macOS e nxnative prontos",
          }));
        } else if (platform === "switch_ios") {
          setLiveMessage("Instalando dependências Switch iOS / iPadOS...");
          const iosRes =
            await window.electron.nxInstallMissingDependencies("ios");
          if (!iosRes.ok) {
            throw new Error(
              iosRes.error || "Falha ao instalar dependências iOS/iPadOS"
            );
          }

          setPlatformNotes((prev) => ({
            ...prev,
            switch_ios: "Toolchain Switch iOS / iPadOS pronto",
          }));
        } else if (platform === "switch_android") {
          setLiveMessage("Instalando dependências Android (ADB + NDK)...");
          const androidRes =
            await window.electron.nxInstallMissingDependencies("android");
          if (!androidRes.ok) {
            throw new Error(
              androidRes.error || "Falha ao instalar dependências Android"
            );
          }

          const repos = await window.electron.nxGetRepoStatus(false);
          if (!repos.nx2android.isValid) {
            setLiveMessage("Sincronizando backend nx2android...");
            const syncRes = await window.electron.nxSyncUpstreamNx2Android();
            if (!syncRes.ok) {
              throw new Error(syncRes.message);
            }
          }

          setPlatformNotes((prev) => ({
            ...prev,
            switch_android: "Toolchain Android e nx2android prontos",
          }));
        }

        setPlatformStates((prev) => ({ ...prev, [platform]: "done" }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setPlatformStates((prev) => ({ ...prev, [platform]: "error" }));
        setPlatformNotes((prev) => ({ ...prev, [platform]: msg }));
      }

      completedSteps += 1;
      setProgressPct(Math.round((completedSteps / totalSteps) * 100));
    }

    await window.electron.updateUserPreferences({
      hasCompletedFirstRunOnboarding: true,
      selectedGamingPlatforms: selectedPlatforms,
    });

    setProgressPct(100);
    setLiveMessage("Configuração concluída!");
    setIsRunning(false);
  };

  return (
    <Modal
      visible={visible}
      onClose={() => {
        if (!isRunning) {
          void handleSkipOnboarding();
        }
      }}
      clickOutsideToClose={false}
      large
      title={
        step === 1
          ? "Bem-vindo ao Cerberus Launcher"
          : step === 2
            ? "Escolha suas Plataformas"
            : "Configurando Dependências"
      }
      description={
        step === 1
          ? "Descubra, baixe, instale e jogue jogos de Windows, Switch 1 e Switch 2 em seu Mac, iPhone, iPad, e Android"
          : step === 2
            ? "Baixaremos apenas as dependências específicas das plataformas que você vai utilizar"
            : "Acompanhe o download e a preparação das suas plataformas selecionadas"
      }
    >
      <div className="first-run-onboarding">
        {step === 1 && (
          <div className="first-run-onboarding__step">
            <div className="first-run-onboarding__hero">
              <div className="first-run-onboarding__logo-wrap">
                <CerberusLogo width={52} height={52} />
              </div>
              <div className="first-run-onboarding__hero-text">
                <h4>Cerberus Launcher</h4>
                <p>
                  Descubra, baixe, instale e jogue jogos de{" "}
                  <strong>Windows</strong>, <strong>Mac Native</strong>,{" "}
                  <strong>Switch 1</strong> e <strong>Switch 2</strong> em seu{" "}
                  <strong>Mac</strong>, <strong>iPhone</strong>,{" "}
                  <strong>iPad</strong> e <strong>Android</strong> — com{" "}
                  <strong>Red Wine</strong>, <strong>NxNative</strong> e{" "}
                  <strong>salvamento no iCloud</strong> integrados.
                </p>
              </div>
            </div>

            <div className="first-run-onboarding__features-grid">
              <div className="first-run-onboarding__feature-card">
                <Search size={18} />
                <div>
                  <strong>1. Encontrar Jogos</strong>
                  <span>
                    Catálogo completo para Windows (PC/Steam), Switch 1 e Switch 2.
                  </span>
                </div>
              </div>

              <div className="first-run-onboarding__feature-card">
                <Download size={18} />
                <div>
                  <strong>2. Baixar</strong>
                  <span>
                    Fontes integradas, torrents e links diretos sem sair do app.
                  </span>
                </div>
              </div>

              <div className="first-run-onboarding__feature-card">
                <Layers size={18} />
                <div>
                  <strong>3. Instalar &amp; Portar</strong>
                  <span>
                    Head Bottle (Default) para jogos Windows e builds nativos para Switch 1/2.
                  </span>
                </div>
              </div>

              <div className="first-run-onboarding__feature-card">
                <Play size={18} />
                <div>
                  <strong>4. Jogar</strong>
                  <span>
                    Biblioteca organizada com capas oficiais, perfis de controle e estatísticas.
                  </span>
                </div>
              </div>
            </div>

            <div className="first-run-onboarding__actions">
              <Button theme="outline" onClick={() => void handleSkipOnboarding()}>
                Pular por agora
              </Button>
              <Button theme="primary" onClick={() => setStep(2)}>
                Escolher Plataformas
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="first-run-onboarding__step">
            <div className="first-run-onboarding__platform-grid">
              {PLATFORM_OPTIONS.map((opt) => {
                const isSelected = selectedPlatforms.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={cn("first-run-onboarding__platform-card", {
                      "first-run-onboarding__platform-card--selected":
                        isSelected,
                    })}
                    onClick={() => togglePlatform(opt.id)}
                  >
                    <div className="first-run-onboarding__platform-head">
                      <div className="first-run-onboarding__platform-icon">
                        {opt.icon}
                      </div>
                      <div className="first-run-onboarding__platform-titles">
                        <strong>{opt.title}</strong>
                        <span>{opt.subtitle}</span>
                      </div>
                      <div
                        className={cn("first-run-onboarding__check", {
                          "first-run-onboarding__check--active": isSelected,
                        })}
                      >
                        {isSelected && <Check size={14} />}
                      </div>
                    </div>
                    <p className="first-run-onboarding__platform-deps">
                      {opt.depsSummary}
                    </p>
                  </button>
                );
              })}
            </div>

            <p className="first-run-onboarding__hint">
              Você pode alterar plataformas ou baixar outras dependências mais
              tarde em <strong>Ajustes → Switch 1 &amp; 2</strong>.
            </p>

            <div className="first-run-onboarding__actions">
              <Button theme="outline" onClick={() => setStep(1)}>
                Voltar
              </Button>
              <div className="first-run-onboarding__actions-right">
                <Button
                  theme="outline"
                  onClick={() => void handleSkipOnboarding()}
                >
                  Pular
                </Button>
                <Button
                  theme="primary"
                  disabled={selectedPlatforms.length === 0}
                  onClick={() => void handleStartInstall()}
                >
                  <Download size={15} />
                  Instalar Dependências Selecionadas ({selectedPlatforms.length})
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="first-run-onboarding__step">
            <div className="first-run-onboarding__progress-wrap">
              <div className="first-run-onboarding__progress-header">
                <strong>Progresso Geral</strong>
                <span>{progressPct}%</span>
              </div>
              <ProgressBar
                now={progressPct}
                max={100}
                label="Progresso da configuração inicial"
                completed={progressPct === 100 && !isRunning}
                trackClassName="first-run-onboarding__progress-track"
                barClassName="first-run-onboarding__progress-bar"
              />
              {liveMessage && (
                <code className="first-run-onboarding__live-line">
                  {liveMessage}
                </code>
              )}
            </div>

            <div className="first-run-onboarding__status-list">
              {selectedPlatforms.map((id) => {
                const meta = PLATFORM_OPTIONS.find((p) => p.id === id)!;
                const state = platformStates[id] ?? "pending";
                const note = platformNotes[id];
                return (
                  <div key={id} className="first-run-onboarding__status-row">
                    <div className="first-run-onboarding__status-icon">
                      {state === "running" ? (
                        <Loader2 size={16} className="first-run-onboarding__spin" />
                      ) : state === "done" ? (
                        <CheckCircle2 size={16} className="text-ok" />
                      ) : state === "error" ? (
                        <XCircle size={16} className="text-err" />
                      ) : (
                        meta.icon
                      )}
                    </div>
                    <div className="first-run-onboarding__status-meta">
                      <strong>{meta.title}</strong>
                      <span>
                        {note ||
                          (state === "running"
                            ? "Instalando..."
                            : state === "pending"
                              ? "Aguardando..."
                              : "Concluído")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="first-run-onboarding__actions">
              <div />
              <Button
                theme="primary"
                disabled={isRunning}
                onClick={onClose}
              >
                {isRunning
                  ? "Instalando dependências..."
                  : "Concluir e Abrir Cerberus"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
