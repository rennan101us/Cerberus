import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Search, Terminal, Trash2 } from "lucide-react";
import cn from "classnames";
import type { AppLogLevel } from "@types";
import { Button, CheckboxField, TextField } from "@renderer/components";
import { useAppDispatch, useAppSelector, useToast } from "@renderer/hooks";
import { clearLogsState, setLogs } from "@renderer/features";
import "./logs.scss";

const LEVEL_FILTERS: Array<{ id: "all" | AppLogLevel; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "step", label: "Etapas" },
  { id: "info", label: "Info" },
  { id: "success", label: "Sucesso" },
  { id: "warning", label: "Avisos" },
  { id: "error", label: "Erros" },
];

export default function Logs() {
  const dispatch = useAppDispatch();
  const entries = useAppSelector((state) => state.logs.entries);
  const { showSuccessToast } = useToast();

  const [levelFilter, setLevelFilter] = useState<"all" | AppLogLevel>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.electron
      .logsGetAll()
      .then((all) => dispatch(setLogs(all)))
      .catch(() => {});
  }, [dispatch]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (levelFilter !== "all" && entry.level !== levelFilter) return false;
      if (
        q &&
        !entry.message.toLowerCase().includes(q) &&
        !entry.source.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [entries, levelFilter, searchQuery]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [filteredEntries.length, autoScroll]);

  const handleCopy = async () => {
    const text = filteredEntries
      .map(
        (e) =>
          `[${new Date(e.timestamp).toLocaleTimeString()}] [${e.source.toUpperCase()}] [${e.level.toUpperCase()}] ${e.message}`
      )
      .join("\n");
    await navigator.clipboard.writeText(text);
    showSuccessToast("Logs copiados para a área de transferência.");
  };

  const handleClear = async () => {
    await window.electron.logsClear();
    dispatch(clearLogsState());
  };

  return (
    <section className="logs-page">
      <header className="logs-page__toolbar">
        <div className="logs-page__title-group">
          <Terminal size={18} />
          <div>
            <h2>Console & Logs</h2>
            <span>
              {filteredEntries.length} de {entries.length} registros (Build,
              Upstream, Dependências, Fontes e Red Wine)
            </span>
          </div>
        </div>

        <div className="logs-page__actions">
          <CheckboxField
            label="Auto-scroll"
            checked={autoScroll}
            onChange={() => setAutoScroll((v) => !v)}
          />
          <Button
            theme="outline"
            size="small"
            onClick={handleCopy}
            disabled={filteredEntries.length === 0}
          >
            <Copy size={14} />
            Copiar
          </Button>
          <Button
            theme="danger"
            size="small"
            onClick={handleClear}
            disabled={entries.length === 0}
          >
            <Trash2 size={14} />
            Limpar
          </Button>
        </div>
      </header>

      <div className="logs-page__filters">
        <div className="logs-page__level-pills">
          {LEVEL_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={cn("logs-page__pill", {
                "logs-page__pill--active": levelFilter === f.id,
              })}
              onClick={() => setLevelFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="logs-page__search">
          <TextField
            theme="dark"
            placeholder="Filtrar logs por mensagem ou módulo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            rightContent={<Search size={14} />}
          />
        </div>
      </div>

      <div className="logs-page__console">
        {filteredEntries.length === 0 ? (
          <div className="logs-page__empty">
            <Terminal size={32} />
            <p>Nenhum log registrado até o momento.</p>
            <small>
              Operações de port Switch 1/2, instalação de dependências, sync
              upstream e Red Wine aparecerão aqui em tempo real.
            </small>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                "logs-page__line",
                `logs-page__line--${entry.level}`
              )}
            >
              <span className="logs-page__time">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="logs-page__source">
                [{entry.source.toUpperCase()}]
              </span>
              <span className="logs-page__message">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
