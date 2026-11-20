import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Package,
  Play,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import type {
  CrossOverStatus,
  CrossOverToolDownloadProgress,
  CrossOverToolWithStatus,
} from "@types";
import { Button, TextField } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import "./crossover-tools.scss";

function ToolBrandIcon({ toolId }: Readonly<{ toolId: string }>) {
  switch (toolId) {
    case "steam":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
          <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658a3.387 3.387 0 0 1 1.912-.59c.064 0 .127.003.19.008l2.861-4.142V8.91a4.528 4.528 0 0 1 4.524-4.524 4.528 4.528 0 0 1 4.524 4.524 4.528 4.528 0 0 1-4.524 4.524h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.606 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012zm11.415-9.303a3.015 3.015 0 0 0-3.015-3.015 3.015 3.015 0 0 0-3.015 3.015 3.015 3.015 0 0 0 3.015 3.015 3.015 3.015 0 0 0 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z" />
        </svg>
      );
    case "epic":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
          <path d="M4.31 2h15.38c1.11 0 1.98.87 1.98 1.98v13.84c0 .76-.41 1.46-1.08 1.82l-7.55 4.09c-.65.35-1.43.35-2.08 0L3.41 19.64a2.07 2.07 0 0 1-1.08-1.82V3.98C2.33 2.87 3.2 2 4.31 2zm2.9 4.2v10.2h9.58v-2.12H9.67v-2.06h5.72V10.1H9.67V8.32h6.89V6.2H7.21z" />
        </svg>
      );
    case "gog":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6zm0 2.4a4.4 4.4 0 1 0 4.4 4.4h-2.1a2.3 2.3 0 1 1-2.3-2.3V7.6zm2.3 2.1h2.1v2.1h-2.1V9.7z" />
        </svg>
      );
    case "battlenet":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
          <path d="M12 2.2c-2.6 0-5.1.9-7.1 2.5 2.4-.6 5.2-.1 7.6 1.5 2.7 1.8 4.4 4.6 4.7 7.6.6-1.2.9-2.5.9-3.9 0-4.3-2.7-7.7-6.1-7.7zm7.9 5.5c-.2 2.5-1.5 5-3.8 6.7-2.6 2-5.9 2.7-8.9 2.1 1.1.9 2.4 1.6 3.9 1.9 4.5.9 8.9-1.9 9.8-6.4.3-1.5.1-3-.9-4.3zM4.2 9.4c-1.8 3.9-.3 8.6 3.5 10.7 1.3.7 2.8 1.1 4.2 1-2.3-1-4.1-3.1-4.8-5.7-.9-3-.2-6.2 1.7-8.6-1.9.4-3.6 1.3-4.6 2.6z" />
        </svg>
      );
    case "ea":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
          <path d="M2 17.5L6.2 6.5h6.6l-.9 2.3H7.8l-.8 2.1h3.8l-.9 2.2H6.1l-.8 2.1h4.5l-.9 2.3H2zm10.4 0L17 6.5h2.6l2.4 11h-2.6l-.5-2.3h-3.4l-1 2.3h-2.1zm4-4.5h2.1l-.7-3.4-1.4 3.4z" />
        </svg>
      );
    case "ubisoft":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 2.6a7.4 7.4 0 0 1 6.7 4.3 5.2 5.2 0 0 0-4.3-2.2 5.3 5.3 0 0 0-5.3 5.3 3.1 3.1 0 0 0 3.1 3.1 2.1 2.1 0 1 0-1.9-3 1 1 0 1 1 1.7 1.1 3.4 3.4 0 1 1-3.1-4.8 4.4 4.4 0 0 1 4.4 4.4 4.8 4.8 0 0 1-4.8 4.8A5.8 5.8 0 0 1 4.6 12 7.4 7.4 0 0 1 12 4.6z" />
        </svg>
      );
    case "rockstar":
      return (
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
          <path d="M4 3h9.5c3.2 0 5.3 1.7 5.3 4.6 0 2.2-1.2 3.7-3.2 4.3l2.6 5.1h-3.8l-2.2-4.6H8.5V17H4V3zm4.5 6.4h4.2c1.2 0 1.9-.6 1.9-1.6s-.7-1.6-1.9-1.6H8.5v3.2zm10.1 5.8l.9 2.1 2.3.2-1.7 1.5.5 2.2-2-1.2-2 1.2.5-2.2-1.7-1.5 2.3-.2.9-2.1z" />
        </svg>
      );
    default:
      return <Wrench size={26} />;
  }
}

export function CrossOverToolsCatalog() {
  const { showSuccessToast, showErrorToast } = useToast();
  const [tools, setTools] = useState<CrossOverToolWithStatus[]>([]);
  const [status, setStatus] = useState<CrossOverStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInstallingCrossOver, setIsInstallingCrossOver] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeDownloads, setActiveDownloads] = useState<
    Record<string, CrossOverToolDownloadProgress>
  >({});

  const loadToolsAndStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const [toolsList, cxStatus] = await Promise.all([
        window.electron.getCrossOverTools(),
        window.electron.getCrossOverStatus(false),
      ]);
      setTools(toolsList);
      setStatus(cxStatus);
    } catch (error) {
      console.error("Failed to load Red Wine tools", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadToolsAndStatus();
  }, [loadToolsAndStatus]);

  useEffect(() => {
    const unsubscribe = window.electron.onCrossOverToolProgress((progress) => {
      setActiveDownloads((prev) => ({
        ...prev,
        [progress.toolId]: progress,
      }));

      if (progress.phase === "done") {
        void loadToolsAndStatus();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [loadToolsAndStatus]);

  const handleInstallTool = async (tool: CrossOverToolWithStatus) => {
    if (activeDownloads[tool.id]?.phase === "downloading") return;

    const bottleLabel =
      tool.bottleName === "Head Bottle"
        ? "Head Bottle (Default)"
        : tool.bottleName;
    const result = await window.electron.installCrossOverTool(tool.id);
    if (result.success) {
      showSuccessToast(
        `Instalador de ${tool.name} iniciado na garrafa '${bottleLabel}'.`
      );
      void loadToolsAndStatus();
    } else {
      showErrorToast(result.error ?? `Falha ao instalar ${tool.name}.`);
    }
  };

  const handleLaunchTool = async (tool: CrossOverToolWithStatus) => {
    const result = await window.electron.launchCrossOverTool(tool.id);
    if (result.success) {
      showSuccessToast(`Iniciando ${tool.name} via Red Wine...`);
    } else {
      showErrorToast(result.error ?? `Falha ao abrir ${tool.name}.`);
    }
  };

  const handleInstallCrossOverEngine = async () => {
    setIsInstallingCrossOver(true);
    try {
      const result = await window.electron.installCrossOverDemo();
      if (result.success) {
        showSuccessToast("Red Wine instalado e configurado com sucesso.");
        void loadToolsAndStatus();
      } else {
        showErrorToast(result.error ?? "Falha ao instalar o Red Wine.");
      }
    } finally {
      setIsInstallingCrossOver(false);
    }
  };

  const filteredTools = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return tools;
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(query) ||
        tool.description.toLowerCase().includes(query) ||
        tool.bottleName.toLowerCase().includes(query)
    );
  }, [tools, searchQuery]);

  const isMac = window.electron.platform === "darwin";

  return (
    <div className="crossover-tools">
      <div className="crossover-tools__toolbar">
        <div className="crossover-tools__intro">
          <h2 className="crossover-tools__heading">
            Catálogo de Ferramentas Red Wine
          </h2>
          <p className="crossover-tools__subtitle">
            Baixe e instale lojas e launchers oficiais do Windows diretamente na
            Head Bottle (Default) do Red Wine com D3DMetal e MSync
            pré-configurados.
          </p>
        </div>

        <div className="crossover-tools__actions">
          <div className="crossover-tools__search">
            <Search size={15} className="crossover-tools__search-icon" />
            <TextField
              placeholder="Filtrar ferramentas..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>

          <Button
            theme="outline"
            onClick={() => void loadToolsAndStatus()}
            disabled={isLoading}
          >
            <RefreshCw size={15} />
            Atualizar
          </Button>
        </div>
      </div>

      {isMac && status && !status.installed && (
        <div className="crossover-tools__warning-banner">
          <div className="crossover-tools__warning-info">
            <AlertCircle size={20} />
            <div>
              <strong>Red Wine não detectado neste Mac</strong>
              <p>
                Para instalar ferramentas Windows na garrafa Head Bottle
                (Default), instale o motor Red Wine primeiro.
              </p>
            </div>
          </div>
          <Button
            theme="primary"
            onClick={handleInstallCrossOverEngine}
            disabled={isInstallingCrossOver}
          >
            <Download size={15} />
            {isInstallingCrossOver
              ? "Instalando Red Wine..."
              : "Instalar Red Wine"}
          </Button>
        </div>
      )}

      {!isMac && (
        <div className="crossover-tools__warning-banner">
          <div className="crossover-tools__warning-info">
            <AlertCircle size={20} />
            <div>
              <strong>Recurso exclusivo para macOS</strong>
              <p>
                O instalador automático na Head Bottle (Default) do Red Wine
                opera no macOS Apple Silicon e Intel.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="crossover-tools__grid">
        {filteredTools.map((tool) => {
          const progress = activeDownloads[tool.id];
          const isBusy =
            progress?.phase === "downloading" ||
            progress?.phase === "preparing_bottle" ||
            progress?.phase === "installing";

          return (
            <article key={tool.id} className="crossover-tools__card">
              <div className="crossover-tools__card-top">
                <div className="crossover-tools__brand-badge">
                  <ToolBrandIcon toolId={tool.id} />
                </div>

                <div className="crossover-tools__title-block">
                  <div className="crossover-tools__title-row">
                    <h3 className="crossover-tools__card-title">{tool.name}</h3>
                    {tool.installed ? (
                      <span className="crossover-tools__status-pill crossover-tools__status-pill--installed">
                        <CheckCircle2 size={12} />
                        Instalado
                      </span>
                    ) : (
                      <span className="crossover-tools__status-pill">
                        Disponível
                      </span>
                    )}
                  </div>

                  <span className="crossover-tools__bottle-tag">
                    <Package size={12} />
                    Garrafa:{" "}
                    {tool.bottleName === "Head Bottle"
                      ? "Head Bottle (Default)"
                      : tool.bottleName}
                  </span>
                </div>
              </div>

              <p className="crossover-tools__card-description">
                {tool.description}
              </p>

              {progress && isBusy && (
                <div className="crossover-tools__progress">
                  <div className="crossover-tools__progress-header">
                    <span>{progress.message}</span>
                    <span>{progress.progress}%</span>
                  </div>
                  <div className="crossover-tools__progress-track">
                    <div
                      className="crossover-tools__progress-fill"
                      style={{ width: `${progress.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {progress?.phase === "error" && progress.error && (
                <div className="crossover-tools__error-text">
                  <AlertCircle size={13} />
                  <span>{progress.error}</span>
                </div>
              )}

              <footer className="crossover-tools__card-footer">
                {tool.installed ? (
                  <>
                    <Button
                      theme="primary"
                      onClick={() => void handleLaunchTool(tool)}
                      disabled={isBusy || !isMac}
                      className="crossover-tools__primary-btn"
                    >
                      <Play size={15} />
                      Abrir
                    </Button>
                    <Button
                      theme="outline"
                      onClick={() => void handleInstallTool(tool)}
                      disabled={isBusy || !isMac || !status?.installed}
                      title="Baixar e executar instalador novamente"
                    >
                      <Download size={15} />
                      Reinstalar
                    </Button>
                  </>
                ) : (
                  <Button
                    theme="primary"
                    onClick={() => void handleInstallTool(tool)}
                    disabled={isBusy || !isMac || !status?.installed}
                    className="crossover-tools__primary-btn"
                  >
                    <Download size={15} />
                    {isBusy ? "Processando..." : "Baixar e Instalar"}
                  </Button>
                )}

                <button
                  type="button"
                  className="crossover-tools__link-btn"
                  onClick={() => window.electron.openExternal(tool.officialUrl)}
                  title={`Site oficial de ${tool.name}`}
                  aria-label={`Site oficial de ${tool.name}`}
                >
                  <ExternalLink size={15} />
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
