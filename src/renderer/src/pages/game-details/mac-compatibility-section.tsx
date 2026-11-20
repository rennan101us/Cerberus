import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Gauge,
  HelpCircle,
  MessageSquare,
  MonitorCheck,
  RefreshCw,
  ShieldCheck,
  Sliders,
  XCircle,
} from "lucide-react";
import type {
  Game,
  GameShop,
  MacCompatibilityRating,
  MacCompatibilityReport,
  MacCompatibilitySourceId,
} from "@types";
import { Button } from "@renderer/components";
import "./mac-compatibility-section.scss";

export interface MacCompatibilitySectionProps {
  gameTitle: string;
  shop?: GameShop;
  objectId?: string;
  game?: Game | null;
}

const getRatingMeta = (rating: MacCompatibilityRating) => {
  switch (rating) {
    case "PERFECT":
      return {
        label: "Excelente / Platinum",
        className: "mac-compat__rating--perfect",
        icon: <ShieldCheck size={18} />,
      };
    case "VERY_GOOD":
      return {
        label: "Muito Bom / Ouro",
        className: "mac-compat__rating--very-good",
        icon: <CheckCircle2 size={18} />,
      };
    case "GOOD":
      return {
        label: "Bom / Prata",
        className: "mac-compat__rating--good",
        icon: <CheckCircle2 size={18} />,
      };
    case "PLAYABLE":
      return {
        label: "Jogável / Requer Ajustes",
        className: "mac-compat__rating--playable",
        icon: <AlertTriangle size={18} />,
      };
    case "UNPLAYABLE":
      return {
        label: "Incompatível",
        className: "mac-compat__rating--unplayable",
        icon: <XCircle size={18} />,
      };
    default:
      return {
        label: "Sem Relatórios Consolidados",
        className: "mac-compat__rating--unknown",
        icon: <HelpCircle size={18} />,
      };
  }
};

const getSourceLabel = (source: MacCompatibilitySourceId): string => {
  switch (source) {
    case "macgamingdb":
      return "MacGamingDB";
    case "codeweavers":
      return "Base Red Wine";
    case "applegamingwiki":
      return "AppleGamingWiki";
  }
};

export function MacCompatibilitySection({
  gameTitle,
  shop,
  objectId,
}: Readonly<MacCompatibilitySectionProps>) {
  const [report, setReport] = useState<MacCompatibilityReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadReport = useCallback(
    async (forceRefresh = false) => {
      if (!gameTitle) return;
      setIsLoading(true);
      try {
        const steamAppId = shop === "steam" ? (objectId ?? null) : null;
        const data = await window.electron.getMacCompatibility(
          gameTitle,
          steamAppId,
          forceRefresh
        );
        setReport(data);
      } catch (error) {
        console.error("Failed to fetch macOS compatibility report:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [gameTitle, shop, objectId]
  );

  useEffect(() => {
    void loadReport(false);
  }, [loadReport]);

  if (!gameTitle) return null;

  const ratingMeta = getRatingMeta(report?.overallRating ?? "UNKNOWN");

  return (
    <section className="mac-compat">
      <header className="mac-compat__header">
        <div className="mac-compat__title-group">
          <MonitorCheck size={20} className="mac-compat__title-icon" />
          <div>
            <h3 className="mac-compat__title">
              Compatibilidade macOS Red Wine
            </h3>
            <p className="mac-compat__subtitle">
              Relatórios, desempenho no Apple Silicon e comentários da
              comunidade reunidos do MacGamingDB, AppleGamingWiki e Base Red
              Wine.
            </p>
          </div>
        </div>

        <Button
          theme="outline"
          onClick={() => void loadReport(true)}
          disabled={isLoading}
          className="mac-compat__refresh-btn"
        >
          <RefreshCw
            size={14}
            className={isLoading ? "mac-compat__spin" : undefined}
          />
          {isLoading ? "Sincronizando..." : "Atualizar"}
        </Button>
      </header>

      {isLoading && !report ? (
        <div className="mac-compat__loading">
          <RefreshCw size={18} className="mac-compat__spin" />
          <span>
            Consultando MacGamingDB, Base Red Wine e AppleGamingWiki...
          </span>
        </div>
      ) : report ? (
        <>
          <div className="mac-compat__overview">
            <div className={`mac-compat__rating-badge ${ratingMeta.className}`}>
              {ratingMeta.icon}
              <span>{ratingMeta.label}</span>
            </div>

            <div className="mac-compat__metrics">
              {report.medianFps && (
                <div className="mac-compat__metric-pill">
                  <Gauge size={14} />
                  <span>Mediana: {report.medianFps} FPS</span>
                </div>
              )}

              {report.latestCrossoverVersion && (
                <div className="mac-compat__metric-pill">
                  <Sliders size={14} />
                  <span>Red Wine {report.latestCrossoverVersion}</span>
                </div>
              )}

              {report.crossoverReportCount > 0 && (
                <div className="mac-compat__metric-pill">
                  <MessageSquare size={14} />
                  <span>
                    {report.crossoverReportCount}{" "}
                    {report.crossoverReportCount === 1 ? "relato" : "relatos"}
                  </span>
                </div>
              )}
            </div>
          </div>

          {report.summaryText && (
            <p className="mac-compat__summary-text">{report.summaryText}</p>
          )}

          {report.chipsets.length > 0 && (
            <div className="mac-compat__chipsets">
              <span className="mac-compat__section-label">
                Desempenho reportado por chip Apple Silicon
              </span>
              <div className="mac-compat__chipset-list">
                {report.chipsets.map((chip) => (
                  <div key={chip.chipset} className="mac-compat__chipset-card">
                    <Cpu size={14} />
                    <strong>{chip.chipset}</strong>
                    {chip.medianFps ? (
                      <span className="mac-compat__chipset-fps">
                        ~{chip.medianFps} FPS
                      </span>
                    ) : null}
                    <span className="mac-compat__chipset-count">
                      ({chip.reports})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mac-compat__comments-block">
            <div className="mac-compat__comments-header">
              <span className="mac-compat__section-label">
                Comentários e Relatos de Compatibilidade (
                {report.comments.length})
              </span>
            </div>

            {report.comments.length === 0 ? (
              <div className="mac-compat__empty">
                <MessageSquare size={22} />
                <p>
                  Nenhum comentário detalhado do Red Wine foi indexado ainda
                  para este título. Consulte diretamente os 3 portais abaixo ou
                  clique em Atualizar.
                </p>
              </div>
            ) : (
              <div className="mac-compat__comments-list">
                {report.comments.map((comment) => (
                  <article
                    key={comment.id}
                    className="mac-compat__comment-card"
                  >
                    <div className="mac-compat__comment-meta">
                      <span
                        className={`mac-compat__source-tag mac-compat__source-tag--${comment.source}`}
                      >
                        {getSourceLabel(comment.source)}
                      </span>

                      {comment.chipset && (
                        <span className="mac-compat__meta-chip">
                          <Cpu size={12} />
                          {comment.chipset}
                        </span>
                      )}

                      {comment.crossoverVersion && (
                        <span className="mac-compat__meta-chip">
                          Red Wine {comment.crossoverVersion}
                        </span>
                      )}

                      {comment.fps && (
                        <span className="mac-compat__meta-chip mac-compat__meta-chip--fps">
                          <Gauge size={12} />
                          {comment.fps}
                        </span>
                      )}

                      {comment.graphicsBackend && (
                        <span className="mac-compat__meta-chip">
                          {comment.graphicsBackend}
                        </span>
                      )}

                      {comment.url && (
                        <button
                          type="button"
                          className="mac-compat__comment-link"
                          onClick={() =>
                            window.electron.openExternal(comment.url!)
                          }
                          title="Abrir relato original"
                        >
                          <ExternalLink size={13} />
                        </button>
                      )}
                    </div>

                    <p className="mac-compat__comment-text">{comment.text}</p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="mac-compat__sources">
            <span className="mac-compat__section-label">
              Bases de Compatibilidade Monitoradas pelo Cerberus
            </span>
            <div className="mac-compat__sources-grid">
              {Object.values(report.sources).map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className="mac-compat__source-card"
                  onClick={() => window.electron.openExternal(source.url)}
                >
                  <div className="mac-compat__source-card-info">
                    <strong>{source.name}</strong>
                    <span>
                      {source.found
                        ? source.ratingLabel
                          ? `Status: ${source.ratingLabel}`
                          : "Página encontrada"
                        : "Pesquisar no portal"}
                    </span>
                  </div>
                  <ExternalLink size={15} />
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
