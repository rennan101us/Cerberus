import { useCallback, useEffect, useState } from "react";
import {
  Cloud,
  CloudDownload,
  CloudUpload,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import type { Game, ICloudGameSaveInfo } from "@types";
import { Button, CheckboxField, TextField } from "@renderer/components";
import { useToast } from "@renderer/hooks";

export interface ICloudSaveSectionProps {
  game: Game;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ICloudSaveSection({ game }: Readonly<ICloudSaveSectionProps>) {
  const { showSuccessToast, showErrorToast } = useToast();
  const [info, setInfo] = useState<ICloudGameSaveInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<
    "backup" | "restore" | "path" | null
  >(null);

  const loadInfo = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electron.icloudGetGameSaveInfo(
        game.shop,
        game.objectId
      );
      setInfo(res);
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [game.shop, game.objectId]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const handleBackup = async () => {
    setBusyAction("backup");
    try {
      const res = await window.electron.icloudBackupGameSave(
        game.shop,
        game.objectId
      );
      if (res.ok) {
        if (res.info) setInfo(res.info);
        showSuccessToast("Saves enviados para o iCloud Drive com sucesso!");
      } else {
        showErrorToast(res.error || "Falha ao salvar no iCloud Drive.");
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestore = async () => {
    setBusyAction("restore");
    try {
      const res = await window.electron.icloudRestoreGameSave(
        game.shop,
        game.objectId
      );
      if (res.ok) {
        if (res.info) setInfo(res.info);
        showSuccessToast("Saves restaurados do iCloud Drive com sucesso!");
      } else {
        showErrorToast(res.error || "Falha ao restaurar do iCloud Drive.");
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleAutoSync = async () => {
    if (!info) return;
    const next = !info.autoSyncEnabled;
    await window.electron.icloudSetAutoSync(game.shop, game.objectId, next);
    setInfo((prev) => (prev ? { ...prev, autoSyncEnabled: next } : prev));
    showSuccessToast(
      next
        ? "Backup automático no iCloud ativado ao fechar o jogo."
        : "Backup automático no iCloud desativado."
    );
  };

  const handlePickCustomPath = async () => {
    const dialog = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
      defaultPath: info?.customSavePath ?? undefined,
    });
    const picked = dialog.filePaths?.[0];
    if (!picked) return;
    setBusyAction("path");
    try {
      const updated = await window.electron.icloudSetCustomSavePath(
        game.shop,
        game.objectId,
        picked
      );
      setInfo(updated);
      showSuccessToast("Pasta de save personalizada salva.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleClearCustomPath = async () => {
    setBusyAction("path");
    try {
      const updated = await window.electron.icloudSetCustomSavePath(
        game.shop,
        game.objectId,
        null
      );
      setInfo(updated);
      showSuccessToast(
        "Pasta personalizada removida (usando detecção automática)."
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h3
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: 0,
              fontSize: 16,
            }}
          >
            <Cloud size={18} />
            Salvamento no iCloud Drive
          </h3>
          <p style={{ margin: "4px 0 0", opacity: 0.72, fontSize: 13 }}>
            Sincroniza os saves deste jogo Windows (Head Bottle / Red Wine)
            diretamente na sua pasta do iCloud Drive, sem precisar de conta
            externa.
          </p>
        </div>

        <Button
          theme="outline"
          size="small"
          disabled={loading}
          onClick={() => void loadInfo()}
        >
          <RefreshCw size={14} />
          Atualizar
        </Button>
      </div>

      {loading && !info ? (
        <p style={{ opacity: 0.7, fontSize: 13 }}>
          Verificando iCloud Drive e arquivos de save locais...
        </p>
      ) : !info?.available ? (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: "1px solid rgba(244,63,94,0.35)",
            background: "rgba(244,63,94,0.08)",
            fontSize: 13,
          }}
        >
          <strong>iCloud Drive não disponível neste Mac.</strong>
          <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
            Ative o iCloud Drive nos Ajustes do Sistema do macOS para salvar e
            restaurar seus jogos automaticamente.
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <strong style={{ fontSize: 12, opacity: 0.7 }}>
                Saves Locais Detectados
              </strong>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>
                {info.localFileCount} arquivo(s) ·{" "}
                {formatBytes(info.localTotalBytes)}
              </div>
              {info.winePrefixUsed && (
                <small
                  style={{
                    display: "block",
                    marginTop: 6,
                    opacity: 0.65,
                    fontSize: 11,
                    wordBreak: "break-all",
                  }}
                >
                  Prefixo: {info.winePrefixUsed}
                </small>
              )}
            </div>

            <div
              style={{
                padding: 12,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <strong style={{ fontSize: 12, opacity: 0.7 }}>
                Backup no iCloud Drive
              </strong>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>
                {info.icloudBackupExists
                  ? `${info.backupFileCount} arquivo(s) · ${formatBytes(info.backupTotalBytes)}`
                  : "Nenhum backup ainda"}
              </div>
              <small
                style={{
                  display: "block",
                  marginTop: 6,
                  opacity: 0.65,
                  fontSize: 11,
                }}
              >
                {info.lastSyncedAt
                  ? `Último backup: ${new Date(info.lastSyncedAt).toLocaleString("pt-BR")}`
                  : "Clique em Enviar para o iCloud para criar o primeiro backup."}
              </small>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              theme="primary"
              disabled={busyAction !== null || !info.writable}
              onClick={() => void handleBackup()}
            >
              <CloudUpload size={15} />
              {busyAction === "backup"
                ? "Enviando..."
                : "Enviar Save para o iCloud"}
            </Button>

            <Button
              theme="outline"
              disabled={busyAction !== null || !info.icloudBackupExists}
              onClick={() => void handleRestore()}
            >
              <CloudDownload size={15} />
              {busyAction === "restore"
                ? "Restaurando..."
                : "Restaurar do iCloud"}
            </Button>

            <Button
              theme="outline"
              onClick={() =>
                void window.electron.icloudOpenSaveFolder(
                  game.shop,
                  game.objectId
                )
              }
            >
              <FolderOpen size={15} />
              Abrir Pasta no iCloud
            </Button>
          </div>

          <CheckboxField
            label="Fazer backup automático para o iCloud Drive ao encerrar este jogo"
            checked={info.autoSyncEnabled}
            onChange={() => void handleToggleAutoSync()}
          />

          <TextField
            label="Pasta de Save Personalizada (opcional)"
            theme="dark"
            value={info.customSavePath || ""}
            placeholder="Detecção automática via Head Bottle (Ludusavi)"
            readOnly
            rightContent={
              <div style={{ display: "flex", gap: 6 }}>
                <Button
                  theme="outline"
                  size="small"
                  disabled={busyAction === "path"}
                  onClick={() => void handlePickCustomPath()}
                >
                  Selecionar
                </Button>
                {info.customSavePath && (
                  <Button
                    theme="outline"
                    size="small"
                    disabled={busyAction === "path"}
                    onClick={() => void handleClearCustomPath()}
                  >
                    Limpar
                  </Button>
                )}
              </div>
            }
          />
        </>
      )}
    </div>
  );
}
