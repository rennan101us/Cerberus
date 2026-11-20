import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon, PersonIcon, SyncIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { StoreAccount } from "@types";
import GogLogo from "@renderer/assets/gog-integration-logo.svg?react";
import {
  SettingsIntegrationCard,
  SettingsIntegrationLastSynced,
} from "./settings-integration-card";

const INITIAL_GOG: StoreAccount = { provider: "gog", connected: false };

export function SettingsGog() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const [account, setAccount] = useState<StoreAccount>(INITIAL_GOG);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadAccount = useCallback(async () => {
    try {
      const res = await window.electron.storesGetAccounts();
      setAccount(res.gog || INITIAL_GOG);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccount();
    return window.electron.onStoreAccountsUpdated(() => {
      void loadAccount();
    });
  }, [loadAccount]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await window.electron.storesStartGogLogin();
      if (res.ok) {
        showSuccessToast("Conta GOG conectada! Sincronizando biblioteca...");
        await loadAccount();
      } else if (res.error && res.error !== "cancelled") {
        showErrorToast(`Falha ao conectar GOG (${res.error}).`);
      }
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Erro ao conectar conta GOG."
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { syncedGamesCount } = await window.electron.storesSyncGogLibrary();
      showSuccessToast(
        `Biblioteca GOG sincronizada (${syncedGamesCount} jogos).`
      );
      await loadAccount();
    } catch (err) {
      showErrorToast(
        err instanceof Error
          ? err.message
          : "Falha ao sincronizar biblioteca GOG."
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await window.electron.storesDisconnectGog();
      setAccount(INITIAL_GOG);
      showSuccessToast("Conta GOG desconectada.");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <SettingsIntegrationCard
      title="GOG Galaxy"
      logo={<GogLogo width={20} height={20} />}
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
              <SyncIcon size={14} className={syncing ? "spin" : undefined} />
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
          <Button theme="primary" onClick={handleConnect} disabled={connecting}>
            <LinkExternalIcon size={14} />
            {connecting ? "Aguardando login..." : "Conectar GOG Galaxy"}
          </Button>
        )
      }
    >
      {account.connected ? (
        <div className="settings-steam__account">
          <div className="settings-steam__account-identity">
            <div className="settings-steam__account-avatar settings-steam__account-avatar--placeholder">
              <PersonIcon size={24} />
            </div>
            <div className="settings-steam__account-meta">
              <strong>{account.displayName || account.accountId}</strong>
              <span>
                ID: {account.accountId}
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
          Conecte sua conta GOG diretamente para importar sua biblioteca e
          baixar seus jogos oficiais (macOS native ou Windows via Red Wine) no
          Cerberus.
        </p>
      )}
    </SettingsIntegrationCard>
  );
}
