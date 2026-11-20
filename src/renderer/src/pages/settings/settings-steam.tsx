import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PersonIcon, SyncIcon } from "@primer/octicons-react";
import { QrCode, KeyRound } from "lucide-react";

import { Button, Modal, TextField } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { SteamLoginSessionStatus, StoreAccount } from "@types";
import SteamLogo from "@renderer/assets/steam-integration-logo.svg?react";
import {
  SettingsIntegrationCard,
  SettingsIntegrationLastSynced,
} from "./settings-integration-card";

import "./settings-steam.scss";

const INITIAL_STEAM: StoreAccount = { provider: "steam", connected: false };

export function SettingsSteam() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const [account, setAccount] = useState<StoreAccount>(INITIAL_STEAM);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [authModalMode, setAuthModalMode] = useState<
    "qr" | "credentials" | null
  >(null);
  const [authState, setAuthState] = useState<SteamLoginSessionStatus>({
    sessionId: "",
    status: "idle",
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [guardCode, setGuardCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadAccount = useCallback(async () => {
    try {
      const res = await window.electron.storesGetAccounts();
      setAccount(res.steam);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccount();
    const unsubAccounts = window.electron.onStoreAccountsUpdated(() => {
      void loadAccount();
    });
    const unsubAuth = window.electron.onSteamAuthState((next) => {
      setAuthState(next);
      if (next.status === "authenticated") {
        setAuthModalMode(null);
        setPassword("");
        setGuardCode("");
        showSuccessToast(
          `Conta Steam conectada (${next.displayName || next.accountName || next.steamId64})! Sincronizando jogos...`
        );
      } else if (next.status === "error" && next.error) {
        showErrorToast(next.error);
      }
    });
    return () => {
      unsubAccounts();
      unsubAuth();
    };
  }, [loadAccount, showSuccessToast, showErrorToast]);

  const handleOpenQr = async () => {
    setAuthModalMode("qr");
    setAuthState({ sessionId: "", status: "pending" });
    const next = await window.electron.storesStartSteamQrLogin();
    setAuthState(next);
  };

  const handleOpenCredentials = () => {
    setAuthModalMode("credentials");
    setAuthState({ sessionId: "", status: "idle" });
    setGuardCode("");
  };

  const handleCloseModal = () => {
    void window.electron.storesCancelSteamLogin();
    setAuthModalMode(null);
    setPassword("");
    setGuardCode("");
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setSubmitting(true);
    try {
      const res = await window.electron.storesStartSteamCredentialsLogin({
        username: username.trim(),
        password,
      });
      setAuthState(res);
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Erro ao conectar na Steam."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleGuardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guardCode.trim()) return;
    setSubmitting(true);
    try {
      const res = await window.electron.storesSubmitSteamGuardCode(
        guardCode.trim()
      );
      if (!res.ok) showErrorToast(res.error || "Código Steam Guard inválido.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { syncedGamesCount } =
        await window.electron.storesSyncSteamLibrary();
      showSuccessToast(
        `Biblioteca Steam sincronizada (${syncedGamesCount} jogos).`
      );
      await loadAccount();
    } catch (err) {
      showErrorToast(
        err instanceof Error
          ? err.message
          : "Falha ao sincronizar biblioteca Steam."
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await window.electron.storesDisconnectSteam();
      setAccount(INITIAL_STEAM);
      showSuccessToast("Conta Steam desconectada.");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <>
      <SettingsIntegrationCard
        title="Steam"
        logo={<SteamLogo width={20} height={20} />}
        loading={loading}
        status={account.connected ? t("connected") : t("disconnected")}
        statusTone={account.connected ? "success" : "neutral"}
        actions={
          account.connected ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                theme="outline"
                onClick={handleSync}
                disabled={syncing || disconnecting}
              >
                <SyncIcon size={14} />
                {syncing ? "Sincronizando..." : "Sincronizar"}
              </Button>
              <Button
                theme="danger"
                onClick={handleDisconnect}
                disabled={syncing || disconnecting}
              >
                Desconectar
              </Button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <Button theme="primary" onClick={() => void handleOpenQr()}>
                <QrCode size={14} />
                Conectar com QR Code
              </Button>
              <Button theme="outline" onClick={handleOpenCredentials}>
                <KeyRound size={14} />
                Senha
              </Button>
            </div>
          )
        }
      >
        {account.connected ? (
          <div className="settings-steam__account">
            <div className="settings-steam__account-identity">
              {account.avatarUrl ? (
                <img
                  src={account.avatarUrl}
                  alt={account.displayName || "Steam"}
                  className="settings-steam__account-avatar"
                />
              ) : (
                <div className="settings-steam__account-avatar settings-steam__account-avatar--placeholder">
                  <PersonIcon size={24} />
                </div>
              )}
              <div className="settings-steam__account-meta">
                <strong>
                  {account.displayName ||
                    account.accountName ||
                    account.accountId}
                </strong>
                <span>
                  SteamID: {account.accountId}
                  {typeof account.syncedGamesCount === "number"
                    ? ` · ${account.syncedGamesCount} jogos na biblioteca`
                    : ""}
                </span>
                <SettingsIntegrationLastSynced
                  lastSyncedAt={account.lastSyncAt}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="settings-integration-card__description">
            Conecte sua conta Steam diretamente no Cerberus para importar sua
            biblioteca, baixar seus jogos comprados (versão Windows via
            DepotDownloader) e conversar/jogar com seus amigos da Steam.
          </p>
        )}
      </SettingsIntegrationCard>

      <Modal
        visible={authModalMode !== null}
        title={
          authModalMode === "qr"
            ? "Conectar Steam via QR Code"
            : "Conectar Steam com Usuário e Senha"
        }
        onClose={handleCloseModal}
      >
        {authModalMode === "qr" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              padding: "12px 0",
              textAlign: "center",
            }}
          >
            {authState.qrDataUrl ? (
              <img
                src={authState.qrDataUrl}
                alt="Steam QR Code"
                style={{
                  width: 220,
                  height: 220,
                  borderRadius: 10,
                  background: "#fff",
                  padding: 8,
                }}
              />
            ) : (
              <p>Gerando QR Code da Steam...</p>
            )}
            <p style={{ opacity: 0.85, fontSize: 13 }}>
              {authState.status === "expired"
                ? "QR Code expirado. Gere um novo abaixo."
                : authState.error
                  ? authState.error
                  : "Abra o app Steam no celular → Steam Guard → Escanear código QR."}
            </p>
            {(authState.status === "expired" ||
              authState.status === "error") && (
              <Button theme="primary" onClick={() => void handleOpenQr()}>
                Gerar novo QR Code
              </Button>
            )}
          </div>
        )}

        {authModalMode === "credentials" &&
          authState.status !== "needs-guard" && (
            <form
              onSubmit={(e) => void handleCredentialsSubmit(e)}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <TextField
                label="Usuário Steam"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <TextField
                label="Senha"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {authState.error && (
                <small style={{ color: "#ff6b6b" }}>{authState.error}</small>
              )}
              <Button type="submit" theme="primary" disabled={submitting}>
                {submitting ? "Conectando..." : "Entrar na Steam"}
              </Button>
            </form>
          )}

        {authModalMode === "credentials" &&
          authState.status === "needs-guard" && (
            <form
              onSubmit={(e) => void handleGuardSubmit(e)}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <p style={{ fontSize: 13 }}>
                {authState.guardType === "device-confirmation"
                  ? "Confirme o login no aplicativo Steam Mobile ou informe o código Steam Guard:"
                  : authState.guardType === "email-code"
                    ? `Digite o código enviado ao seu e-mail (${authState.guardDomain ?? "Steam Guard"}):`
                    : "Digite o código do aplicativo Steam Guard:"}
              </p>
              <TextField
                label="Código Steam Guard"
                value={guardCode}
                onChange={(e) => setGuardCode(e.target.value)}
                placeholder="Ex: R7K2P"
              />
              <Button type="submit" theme="primary" disabled={submitting}>
                {submitting ? "Verificando..." : "Confirmar código"}
              </Button>
            </form>
          )}
      </Modal>
    </>
  );
}
