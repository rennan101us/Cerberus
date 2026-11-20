import { useCallback, useContext, useEffect, useState } from "react";
import {
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  FolderPlus,
  GitBranch,
  HardDrive,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import cn from "classnames";
import type {
  NxDependencyStatus,
  NxInstallerProgressEvent,
  NxProdKeysInfo,
  NxReposStatus,
  NxResolvedPaths,
  NxStorageStats,
  NxTargetPlatform,
} from "@types";
import { Badge, Button, CheckboxField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useLibrary, useToast } from "@renderer/hooks";
import "./settings-nxnative-panel.scss";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

export function SettingsNxNativePanel() {
  const { updateUserPreferences } = useContext(settingsContext);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateLibrary } = useLibrary();
  const { showSuccessToast, showErrorToast } = useToast();

  const [paths, setPaths] = useState<NxResolvedPaths | null>(null);

  const [repos, setRepos] = useState<NxReposStatus | null>(null);
  const [prodKeys, setProdKeys] = useState<NxProdKeysInfo | null>(null);
  const [deps, setDeps] = useState<NxDependencyStatus[]>([]);
  const [storage, setStorage] = useState<NxStorageStats | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [isSyncingNxnative, setIsSyncingNxnative] = useState(false);
  const [isSyncingNx2a, setIsSyncingNx2a] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [busyDepId, setBusyDepId] = useState<string | null>(null);
  const [installerStatusLine, setInstallerStatusLine] = useState<string>("");
  const [isCleaning, setIsCleaning] = useState<string | null>(null);

  const switch1Folders = userPreferences?.switch1RomFolders ?? [];
  const switch2Folders = userPreferences?.switch2RomFolders ?? [];

  const loadAll = useCallback(async (fetchRemote = false) => {
    const [p, r, k, d, s] = await Promise.all([
      window.electron.nxGetResolvedPaths(),
      window.electron.nxGetRepoStatus(fetchRemote),
      window.electron.nxDetectProdKeys(),
      window.electron.nxCheckPrerequisites(),
      window.electron.nxGetStorageStats(),
    ]);
    setPaths(p);
    setRepos(r);
    setProdKeys(k);
    setDeps(d);
    setStorage(s);
  }, []);

  useEffect(() => {
    void loadAll(false);
  }, [loadAll]);

  useEffect(() => {
    const unsub = window.electron.onNxInstallerProgress(
      (ev: NxInstallerProgressEvent) => {
        if (ev.phase === "output" && ev.line) {
          setInstallerStatusLine(ev.line);
        } else if (ev.phase === "start" && ev.itemName) {
          setInstallerStatusLine(`Executando ${ev.action}: ${ev.itemName}...`);
        } else if (ev.phase === "complete") {
          setBusyDepId(null);
          setInstallerStatusLine("");
          void window.electron.nxCheckPrerequisites().then(setDeps);
        }
      }
    );
    return () => unsub();
  }, []);

  const pickDirectory = async (
    defaultPath?: string
  ): Promise<string | null> => {
    const res = await window.electron.showOpenDialog({
      defaultPath,
      properties: ["openDirectory", "createDirectory"],
    });
    return res.filePaths?.[0] || null;
  };

  const handleAddRomFolder = async (gen: "switch1" | "switch2") => {
    const picked = await pickDirectory();
    if (!picked) return;
    const current = gen === "switch1" ? switch1Folders : switch2Folders;
    if (current.includes(picked)) return;
    const next = [...current, picked];
    await updateUserPreferences(
      gen === "switch1"
        ? { switch1RomFolders: next }
        : { switch2RomFolders: next }
    );
    await window.electron.nxScanLibraryAndRoms();
    await updateLibrary();
    showSuccessToast(
      "Pasta de ROMs adicionada e sincronizada com a biblioteca."
    );
  };

  const handleRemoveRomFolder = async (
    gen: "switch1" | "switch2",
    folder: string
  ) => {
    const current = gen === "switch1" ? switch1Folders : switch2Folders;
    const next = current.filter((f) => f !== folder);
    await updateUserPreferences(
      gen === "switch1"
        ? { switch1RomFolders: next }
        : { switch2RomFolders: next }
    );
    await window.electron.nxScanLibraryAndRoms();
    await updateLibrary();
  };

  const handleChangeOutputFolder = async () => {
    const picked = await pickDirectory(paths?.outputDir);
    if (!picked) return;
    await updateUserPreferences({ nxPortedOutputFolder: picked });
    await window.electron.nxScanLibraryAndRoms();
    await updateLibrary();
    await loadAll(false);
    showSuccessToast(
      "Pasta de jogos portados atualizada e lida na biblioteca."
    );
  };

  const handleChangeAppSupportFolder = async () => {
    const picked = await pickDirectory(paths?.appSupportDir);
    if (!picked) return;
    if (paths?.appSupportDir && paths.appSupportDir !== picked) {
      await window.electron.nxMigrateAppSupportFolder(
        paths.appSupportDir,
        picked
      );
    }
    await updateUserPreferences({ nxAppSupportFolder: picked });
    await loadAll(false);
    showSuccessToast("Pasta de saves e Application Support atualizada.");
  };

  const handleChangeStagingFolder = async () => {
    const picked = await pickDirectory(paths?.stagingDir);
    if (!picked) return;
    await updateUserPreferences({ nxStagingFolder: picked });
    await loadAll(false);
    showSuccessToast("Workspace temporário (Staging) atualizado.");
  };

  const handleChangeNx2aHomeFolder = async () => {
    const picked = await pickDirectory(paths?.nx2androidHomeDir);
    if (!picked) return;
    await updateUserPreferences({ nx2androidHomeFolder: picked });
    await loadAll(false);
    showSuccessToast("Pasta de cache do nx2android atualizada.");
  };

  const handleApplyAppAdjacentCachePreset = async () => {
    try {
      const updated = await window.electron.nxApplyCacheRootPreset(
        "app-adjacent",
        undefined,
        false
      );
      setPaths(updated);
      showSuccessToast(
        "Caches configurados em Cerberus_Cache junto ao Cerberus.app."
      );
      await loadAll(false);
    } catch {
      showErrorToast("Falha ao aplicar pasta de cache.");
    }
  };

  const handleChooseCustomCacheRoot = async () => {
    const picked = await pickDirectory(paths?.cerberusCacheRoot);
    if (!picked) return;
    try {
      const updated = await window.electron.nxApplyCacheRootPreset(
        "custom",
        picked,
        false
      );
      setPaths(updated);
      showSuccessToast(`Pasta raiz de cache alterada para: ${picked}`);
      await loadAll(false);
    } catch {
      showErrorToast("Falha ao aplicar pasta raiz de cache.");
    }
  };

  const handleRescanLibrary = async () => {
    setIsScanning(true);
    try {
      const res = await window.electron.nxScanLibraryAndRoms();
      await updateLibrary();
      showSuccessToast(
        `Biblioteca atualizada: ${res.roms.length} ROMs e ${res.ported.length} jogos portados.`
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleSelectProdKeys = async () => {
    const res = await window.electron.nxSelectProdKeysDialog();
    if (!res) return;
    setProdKeys(res);
    if (res.isValid) {
      showSuccessToast(`prod.keys validado (${res.firmwareSummary || "OK"}).`);
    } else {
      showErrorToast(res.error || "Arquivo prod.keys inválido.");
    }
  };

  const handleChangeNxnativeRepo = async () => {
    const picked = await pickDirectory(paths?.nxnativePath);
    if (!picked) return;
    await updateUserPreferences({ nxnativeRepoPath: picked });
    await loadAll(false);
  };

  const handleCloneNxnative = async () => {
    setIsCloning(true);
    try {
      const res = await window.electron.nxCloneRepo();
      if (res.ok) {
        await updateUserPreferences({ nxnativeRepoPath: res.path });
        showSuccessToast(res.message);
        await loadAll(false);
      } else {
        showErrorToast(res.message);
      }
    } finally {
      setIsCloning(false);
    }
  };

  const handleSyncUpstreamNxnative = async () => {
    setIsSyncingNxnative(true);
    try {
      const res = await window.electron.nxSyncUpstreamNxnative();
      if (res.ok) {
        showSuccessToast(res.message);
        await window.electron.nxRefreshCompatibleGames();
        await loadAll(true);
      } else {
        showErrorToast(res.message);
      }
    } finally {
      setIsSyncingNxnative(false);
    }
  };

  const handleSyncUpstreamNx2a = async () => {
    setIsSyncingNx2a(true);
    try {
      const res = await window.electron.nxSyncUpstreamNx2Android();
      if (res.ok) {
        showSuccessToast(res.message);
        await window.electron.nxRefreshCompatibleGames();
        await loadAll(true);
      } else {
        showErrorToast(res.message);
      }
    } finally {
      setIsSyncingNx2a(false);
    }
  };

  const handleDepAction = async (
    action: "install" | "repair" | "uninstall",
    depId: string
  ) => {
    setBusyDepId(depId);
    try {
      const res =
        action === "install"
          ? await window.electron.nxInstallDependency(depId)
          : action === "repair"
            ? await window.electron.nxRepairDependency(depId)
            : await window.electron.nxUninstallDependency(depId);
      if (res.ok) {
        showSuccessToast("Operação de ferramenta concluída com sucesso.");
      } else {
        showErrorToast(res.error || "Falha ao executar ação na ferramenta.");
      }
      setDeps(await window.electron.nxCheckPrerequisites());
    } finally {
      setBusyDepId(null);
    }
  };

  const handleInstallAllMissing = async () => {
    setBusyDepId("__all__");
    try {
      const res = await window.electron.nxInstallMissingDependencies();
      if (res.ok) {
        showSuccessToast("Dependências ausentes instaladas com sucesso.");
      } else {
        showErrorToast(
          res.error || "Algumas dependências falharam. Verifique a aba Logs."
        );
      }
      setDeps(await window.electron.nxCheckPrerequisites());
    } finally {
      setBusyDepId(null);
    }
  };

  const handleInstallMissingForPlatform = async (platform: NxTargetPlatform) => {
    setBusyDepId(`__platform_${platform}`);
    try {
      const res = await window.electron.nxInstallMissingDependencies(platform);
      if (res.ok) {
        showSuccessToast(
          `Dependências para ${platform} instaladas/verificadas com sucesso.`
        );
      } else {
        showErrorToast(
          res.error || "Algumas dependências falharam. Verifique a aba Logs."
        );
      }
      setDeps(await window.electron.nxCheckPrerequisites());
    } finally {
      setBusyDepId(null);
    }
  };

  const handleCleanAction = async (kind: "build" | "artwork" | "icloud") => {
    setIsCleaning(kind);
    try {
      const freed =
        kind === "build"
          ? await window.electron.nxCleanBuildCache()
          : kind === "artwork"
            ? await window.electron.nxCleanArtworkCache()
            : await window.electron.nxPurgeICloudBackups();
      showSuccessToast(`Espaço liberado: ${formatBytes(freed)}.`);
      setStorage(await window.electron.nxGetStorageStats());
    } finally {
      setIsCleaning(null);
    }
  };

  const missingDepsCount = deps.filter((d) => !d.isAvailable).length;

  return (
    <div className="settings-nxnative">
      {/* 0. Assistente de Plataformas — Switch 1 & 2 */}
      <div className="settings-context-panel__group">
        <div className="settings-nxnative__section-head">
          <h3>Assistente de Plataformas — Switch 1 &amp; 2</h3>
          <Button
            theme="outline"
            size="small"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("cerberus:open-onboarding"))
            }
          >
            Abrir Tela de Boas-Vindas e Plataformas
          </Button>
        </div>

        <div className="settings-nxnative__inline-btns">
          <Button
            theme="outline"
            size="small"
            disabled={Boolean(busyDepId)}
            onClick={() => void handleInstallMissingForPlatform("macApp")}
          >
            <Download size={13} />
            Instalar Dependências macOS
          </Button>
          <Button
            theme="outline"
            size="small"
            disabled={Boolean(busyDepId)}
            onClick={() => void handleInstallMissingForPlatform("ios")}
          >
            <Download size={13} />
            Instalar Dependências iOS/iPadOS
          </Button>
          <Button
            theme="outline"
            size="small"
            disabled={Boolean(busyDepId)}
            onClick={() => void handleInstallMissingForPlatform("android")}
          >
            <Download size={13} />
            Instalar Dependências Android
          </Button>
        </div>
      </div>

      {/* 1. Diretórios Switch 1/2, Output, AppSupport e Staging */}
      <div className="settings-context-panel__group">
        <div className="settings-nxnative__section-head">
          <div>
            <h3>Diretórios Switch 1 &amp; 2 (NxNative)</h3>
            <p className="settings-nxnative__muted" style={{ marginTop: 4 }}>
              Caches centralizados em <code>Cerberus_Cache</code> junto ao app
              ou local personalizado.
            </p>
          </div>
          <div className="settings-nxnative__inline-btns">
            <Button
              theme="outline"
              size="small"
              onClick={() => void handleApplyAppAdjacentCachePreset()}
            >
              <FolderPlus size={13} /> Usar Cerberus_Cache (junto ao app)
            </Button>
            <Button
              theme="outline"
              size="small"
              onClick={() => void handleChooseCustomCacheRoot()}
            >
              <FolderPlus size={13} /> Escolher Raiz de Cache...
            </Button>
            <Button
              theme="outline"
              size="small"
              onClick={handleRescanLibrary}
              disabled={isScanning}
            >
              <RefreshCw size={13} className={cn({ spin: isScanning })} />
              Re-escanear
            </Button>
          </div>
        </div>

        {/* Switch 1 ROMs */}
        <div className="settings-nxnative__folder-block">
          <div className="settings-nxnative__folder-label">
            <strong>Pastas de ROMs — Switch 1 (.nsp / .xci / .nsz)</strong>
            <Button
              theme="outline"
              size="small"
              onClick={() => handleAddRomFolder("switch1")}
            >
              <FolderPlus size={13} /> Adicionar Pasta
            </Button>
          </div>
          {switch1Folders.length === 0 ? (
            <p className="settings-nxnative__muted">
              Nenhuma pasta de ROMs Switch 1 adicionada.
            </p>
          ) : (
            <div className="settings-nxnative__folder-list">
              {switch1Folders.map((folder) => (
                <div key={folder} className="settings-nxnative__folder-item">
                  <span>{folder}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRomFolder("switch1", folder)}
                    title="Remover pasta"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Switch 2 ROMs */}
        <div className="settings-nxnative__folder-block">
          <div className="settings-nxnative__folder-label">
            <strong>Pastas de ROMs — Switch 2 (.nup / dumps / .nsp)</strong>
            <Button
              theme="outline"
              size="small"
              onClick={() => handleAddRomFolder("switch2")}
            >
              <FolderPlus size={13} /> Adicionar Pasta
            </Button>
          </div>
          {switch2Folders.length === 0 ? (
            <p className="settings-nxnative__muted">
              Nenhuma pasta de ROMs Switch 2 adicionada.
            </p>
          ) : (
            <div className="settings-nxnative__folder-list">
              {switch2Folders.map((folder) => (
                <div key={folder} className="settings-nxnative__folder-item">
                  <span>{folder}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRomFolder("switch2", folder)}
                    title="Remover pasta"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Output / Ported Games Folder */}
        <TextField
          label="Pasta de Jogos Portados / Output (lida automaticamente pela biblioteca)"
          value={paths?.outputDir ?? ""}
          readOnly
          disabled
          rightContent={
            <div className="settings-nxnative__inline-btns">
              <Button
                theme="outline"
                size="small"
                onClick={() =>
                  paths?.outputDir &&
                  window.electron.nxRevealInFinder(paths.outputDir)
                }
                title="Abrir no Finder"
              >
                <ExternalLink size={13} />
              </Button>
              <Button
                theme="outline"
                size="small"
                onClick={handleChangeOutputFolder}
              >
                Alterar
              </Button>
              <Button
                theme="outline"
                size="small"
                onClick={async () => {
                  await updateUserPreferences({ nxPortedOutputFolder: null });
                  await loadAll(false);
                }}
                title="Restaurar padrão"
              >
                <RotateCcw size={13} />
              </Button>
            </div>
          }
        />

        {/* Saves & Application Support */}
        <TextField
          label="Pasta de Saves e Application Support dos Jogos"
          value={paths?.appSupportDir ?? ""}
          readOnly
          disabled
          rightContent={
            <div className="settings-nxnative__inline-btns">
              <Button
                theme="outline"
                size="small"
                onClick={() =>
                  paths?.appSupportDir &&
                  window.electron.nxRevealInFinder(paths.appSupportDir)
                }
                title="Abrir no Finder"
              >
                <ExternalLink size={13} />
              </Button>
              <Button
                theme="outline"
                size="small"
                onClick={handleChangeAppSupportFolder}
              >
                Alterar
              </Button>
              <Button
                theme="outline"
                size="small"
                onClick={async () => {
                  await updateUserPreferences({ nxAppSupportFolder: null });
                  await loadAll(false);
                }}
                title="Restaurar padrão"
              >
                <RotateCcw size={13} />
              </Button>
            </div>
          }
        />

        {/* Staging / Temp Workspace */}
        <TextField
          label="Workspace Temporário (Staging Folders de Compilação)"
          value={paths?.stagingDir ?? ""}
          readOnly
          disabled
          rightContent={
            <div className="settings-nxnative__inline-btns">
              <Button
                theme="outline"
                size="small"
                onClick={() =>
                  paths?.stagingDir &&
                  window.electron.nxRevealInFinder(paths.stagingDir)
                }
                title="Abrir no Finder"
              >
                <ExternalLink size={13} />
              </Button>
              <Button
                theme="outline"
                size="small"
                onClick={handleChangeStagingFolder}
              >
                Alterar
              </Button>
              <Button
                theme="outline"
                size="small"
                onClick={async () => {
                  await updateUserPreferences({ nxStagingFolder: null });
                  await loadAll(false);
                }}
                title="Restaurar padrão"
              >
                <RotateCcw size={13} />
              </Button>
            </div>
          }
        />

        {/* Android Home / Cache */}
        <TextField
          label="Pasta Home / Cache do Nx2Android (NX2A_HOME — toolchains, NDK e repositório)"
          value={paths?.nx2androidHomeDir ?? ""}
          readOnly
          disabled
          rightContent={
            <div className="settings-nxnative__inline-btns">
              <Button
                theme="outline"
                size="small"
                onClick={() =>
                  paths?.nx2androidHomeDir &&
                  window.electron.nxRevealInFinder(paths.nx2androidHomeDir)
                }
                title="Abrir no Finder"
              >
                <ExternalLink size={13} />
              </Button>
              <Button
                theme="outline"
                size="small"
                onClick={handleChangeNx2aHomeFolder}
              >
                Alterar
              </Button>
              <Button
                theme="outline"
                size="small"
                onClick={async () => {
                  await updateUserPreferences({ nx2androidHomeFolder: null });
                  await loadAll(false);
                }}
                title="Restaurar padrão"
              >
                <RotateCcw size={13} />
              </Button>
            </div>
          }
        />
      </div>

      {/* 2. Prod.keys */}
      <div className="settings-context-panel__group">
        <div className="settings-nxnative__section-head">
          <h3>
            <KeyRound size={15} /> Chaves de Decriptação (prod.keys)
          </h3>
          <Badge>{prodKeys?.isValid ? "Válido" : "Ausente"}</Badge>
        </div>

        <TextField
          label={
            prodKeys?.isValid
              ? `Detectado (${prodKeys.sourceName}) — ${prodKeys.firmwareSummary || ""}`
              : "Necessário para portar jogos de Switch 1 (.nsp/.xci/.nsz)"
          }
          value={prodKeys?.path ?? "Nenhum arquivo prod.keys configurado"}
          readOnly
          disabled
          rightContent={
            <div className="settings-nxnative__inline-btns">
              <Button
                theme="outline"
                size="small"
                onClick={async () => {
                  const detected = await window.electron.nxDetectProdKeys();
                  setProdKeys(detected);
                  if (detected.isValid) {
                    showSuccessToast(
                      `prod.keys detectado em ${detected.sourceName}.`
                    );
                  } else {
                    showErrorToast(
                      "Nenhum prod.keys encontrado automaticamente."
                    );
                  }
                }}
              >
                Auto-detectar
              </Button>
              <Button
                theme="primary"
                size="small"
                onClick={handleSelectProdKeys}
              >
                Inserir prod.keys
              </Button>
            </div>
          }
        />
      </div>

      {/* 3. Backends & Upstream Sync (nxnative + nx2android) */}
      <div className="settings-context-panel__group">
        <div className="settings-nxnative__section-head">
          <h3>
            <GitBranch size={15} /> Backends &amp; Sincronização Upstream GitHub
          </h3>
          <Button theme="outline" size="small" onClick={() => loadAll(true)}>
            <RefreshCw size={13} /> Verificar Commits
          </Button>
        </div>

        {/* nxnative */}
        <div className="settings-nxnative__repo-card">
          <div className="settings-nxnative__repo-meta">
            <div>
              <strong>nxnative (seedds/nxnative) — macOS &amp; iOS</strong>
              <small>{repos?.nxnative.path || paths?.nxnativePath}</small>
              {repos?.nxnative.isValid && (
                <span className="settings-nxnative__commit-line">
                  Local: <code>{repos.nxnative.localCommit || "—"}</code>
                  {repos.nxnative.remoteCommit && (
                    <>
                      {" · "}Upstream:{" "}
                      <code>{repos.nxnative.remoteCommit}</code>
                    </>
                  )}
                  {repos.nxnative.upstreamBehindCount > 0 && (
                    <strong className="settings-nxnative__warn-text">
                      {" · "}
                      {repos.nxnative.upstreamBehindCount} commits disponíveis
                    </strong>
                  )}
                </span>
              )}
            </div>
            <Badge>{repos?.nxnative.isValid ? "Pronto" : "Ausente"}</Badge>
          </div>
          <div className="settings-nxnative__inline-btns">
            <Button
              theme="outline"
              size="small"
              onClick={handleChangeNxnativeRepo}
            >
              Alterar Pasta
            </Button>
            {!repos?.nxnative.isValid && (
              <Button
                theme="primary"
                size="small"
                onClick={handleCloneNxnative}
                disabled={isCloning}
              >
                <Download size={13} />
                {isCloning ? "Clonando..." : "Clonar 1-Clique"}
              </Button>
            )}
            <Button
              theme="outline"
              size="small"
              onClick={handleSyncUpstreamNxnative}
              disabled={isSyncingNxnative || !repos?.nxnative.isValid}
            >
              <RefreshCw
                size={13}
                className={cn({ spin: isSyncingNxnative })}
              />
              {isSyncingNxnative
                ? "Sincronizando..."
                : "Sincronizar Upstream GitHub"}
            </Button>
          </div>
        </div>

        {/* nx2android */}
        <div className="settings-nxnative__repo-card">
          <div className="settings-nxnative__repo-meta">
            <div>
              <strong>nx2android (shirai91/nx2android) — Android Vulkan</strong>
              <small>{repos?.nx2android.path || paths?.nx2androidPath}</small>
              {repos?.nx2android.isValid && (
                <span className="settings-nxnative__commit-line">
                  Local: <code>{repos.nx2android.localCommit || "—"}</code>
                  {repos.nx2android.remoteCommit && (
                    <>
                      {" · "}Upstream:{" "}
                      <code>{repos.nx2android.remoteCommit}</code>
                    </>
                  )}
                </span>
              )}
            </div>
            <Badge>
              {repos?.nx2android.isValid ? "Pronto" : "Não Instalado"}
            </Badge>
          </div>
          <div className="settings-nxnative__inline-btns">
            <Button
              theme="outline"
              size="small"
              onClick={handleSyncUpstreamNx2a}
              disabled={isSyncingNx2a}
            >
              <RefreshCw size={13} className={cn({ spin: isSyncingNx2a })} />
              {isSyncingNx2a
                ? "Sincronizando..."
                : repos?.nx2android.isValid
                  ? "Sincronizar Upstream GitHub"
                  : "Baixar & Instalar nx2android"}
            </Button>
          </div>
        </div>
      </div>

      {/* 4. Ferramentas de Compilação do Sistema (13 dependências) */}
      <div className="settings-context-panel__group">
        <div className="settings-nxnative__section-head">
          <h3>
            <Wrench size={15} /> Ferramentas de Compilação do Sistema (
            {deps.length - missingDepsCount}/{deps.length})
          </h3>
          <div className="settings-nxnative__inline-btns">
            <Button
              theme="outline"
              size="small"
              onClick={() =>
                window.electron.nxCheckPrerequisites().then(setDeps)
              }
              disabled={Boolean(busyDepId)}
            >
              <RefreshCw size={13} /> Reverificar
            </Button>
            {missingDepsCount > 0 && (
              <Button
                theme="primary"
                size="small"
                onClick={handleInstallAllMissing}
                disabled={Boolean(busyDepId)}
              >
                <Download size={13} /> Instalar Ausentes ({missingDepsCount})
              </Button>
            )}
          </div>
        </div>

        {installerStatusLine && (
          <div className="settings-nxnative__live-banner">
            <code>{installerStatusLine}</code>
          </div>
        )}

        <div className="settings-nxnative__deps-list">
          {deps.map((dep) => {
            const isBusy = busyDepId === dep.id || busyDepId === "__all__";
            return (
              <div key={dep.id} className="settings-nxnative__dep-row">
                <div className="settings-nxnative__dep-info">
                  <div className="settings-nxnative__dep-title">
                    {dep.isAvailable ? (
                      <CheckCircle2 size={15} className="text-ok" />
                    ) : (
                      <XCircle size={15} className="text-missing" />
                    )}
                    <strong>{dep.name}</strong>
                    <span className="settings-nxnative__cat-tag">
                      {dep.category.toUpperCase()}
                    </span>
                    {dep.downloadSizeBadge && (
                      <span className="settings-nxnative__size-tag">
                        {dep.downloadSizeBadge}
                      </span>
                    )}
                  </div>
                  <small>{dep.details}</small>
                </div>

                <div className="settings-nxnative__inline-btns">
                  {!dep.isAvailable ? (
                    <Button
                      theme="primary"
                      size="small"
                      disabled={Boolean(busyDepId)}
                      onClick={() => handleDepAction("install", dep.id)}
                    >
                      {isBusy ? "Instalando..." : "Instalar"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        theme="outline"
                        size="small"
                        disabled={Boolean(busyDepId)}
                        onClick={() => handleDepAction("repair", dep.id)}
                      >
                        {isBusy ? "..." : "Reparar"}
                      </Button>
                      {!dep.isProtected && (
                        <Button
                          theme="danger"
                          size="small"
                          disabled={Boolean(busyDepId)}
                          onClick={() => handleDepAction("uninstall", dep.id)}
                        >
                          Excluir
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. Armazenamento e Limpeza de Caches */}
      <div className="settings-context-panel__group">
        <h3>
          <HardDrive size={15} /> Armazenamento, Caches &amp; Backups iCloud
        </h3>

        <div className="settings-nxnative__storage-row">
          <div>
            <strong>Cache de Compilação (Staging, Shaders, Extrações)</strong>
            <small>
              Remove arquivos intermediários mantendo saves e jogos portados
              (.app). Ocupado: {formatBytes(storage?.buildCacheBytes ?? 0)}
            </small>
          </div>
          <Button
            theme="outline"
            size="small"
            disabled={isCleaning === "build"}
            onClick={() => handleCleanAction("build")}
          >
            <Trash2 size={13} />
            {isCleaning === "build"
              ? "Limpando..."
              : "Apagar Cache de Compilação"}
          </Button>
        </div>

        <div className="settings-nxnative__storage-row">
          <div>
            <strong>Cache de Arte dos Jogos (Capas &amp; Banners)</strong>
            <small>
              Limpa capas em cache preservando artes personalizadas
              (.custom.jpg). Ocupado:{" "}
              {formatBytes(storage?.artworkCacheBytes ?? 0)}
            </small>
          </div>
          <Button
            theme="outline"
            size="small"
            disabled={isCleaning === "artwork"}
            onClick={() => handleCleanAction("artwork")}
          >
            <Trash2 size={13} />
            {isCleaning === "artwork" ? "Limpando..." : "Apagar Cache de Arte"}
          </Button>
        </div>

        <div className="settings-nxnative__storage-row">
          <div>
            <div className="settings-nxnative__icloud-head">
              <Cloud size={14} />
              <strong>Backups &amp; Sincronização iCloud</strong>
              <CheckboxField
                label="Ativar globalmente"
                checked={Boolean(storage?.iCloudSyncEnabled)}
                onChange={async () => {
                  const next = !storage?.iCloudSyncEnabled;
                  await window.electron.nxSetGlobalICloudSync(next);
                  setStorage(await window.electron.nxGetStorageStats());
                }}
              />
            </div>
            <small>
              {storage?.iCloudAvailable
                ? `Pasta iCloud Drive disponível. Ocupado: ${formatBytes(storage.iCloudBytes)}`
                : "iCloud Drive indisponível neste Mac."}
            </small>
          </div>
          <Button
            theme="danger"
            size="small"
            disabled={isCleaning === "icloud" || !(storage?.iCloudBytes ?? 0)}
            onClick={() => handleCleanAction("icloud")}
          >
            <Trash2 size={13} />
            {isCleaning === "icloud" ? "Removendo..." : "Apagar Backups iCloud"}
          </Button>
        </div>
      </div>
    </div>
  );
}
