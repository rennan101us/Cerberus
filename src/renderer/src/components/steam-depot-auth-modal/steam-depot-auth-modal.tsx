import { useEffect, useState } from "react";
import type { StoreDownloadProgress } from "@types";
import { Button, Modal, TextField } from "@renderer/components";

export function SteamDepotAuthModal() {
  const [promptState, setPromptState] = useState<StoreDownloadProgress | null>(
    null
  );
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    return window.electron.onStoreDownloadProgress((progress) => {
      if (progress.provider !== "steam") return;
      if (progress.status === "needs-input") {
        setPromptState(progress);
      } else {
        setPromptState((curr) =>
          curr && curr.storeId === progress.storeId ? null : curr
        );
      }
    });
  }, []);

  if (!promptState) return null;

  const isPassword = promptState.prompt === "password";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setSubmitting(true);
    try {
      await window.electron.storesSubmitDownloadInput({
        provider: "steam",
        storeId: promptState.storeId,
        value: value.trim(),
      });
      setValue("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    void window.electron.storesCancelGameDownload({
      provider: "steam",
      storeId: promptState.storeId,
    });
    setPromptState(null);
    setValue("");
  };

  return (
    <Modal
      visible={true}
      title={`Autenticação DepotDownloader · ${promptState.title}`}
      onClose={handleCancel}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          alignItems: promptState.qrDataUrl ? "center" : "stretch",
          textAlign: promptState.qrDataUrl ? "center" : "left",
        }}
      >
        {promptState.qrDataUrl && (
          <img
            src={promptState.qrDataUrl}
            alt="Steam QR Code"
            style={{
              width: 210,
              height: 210,
              borderRadius: 10,
              background: "#fff",
              padding: 8,
            }}
          />
        )}

        <p style={{ fontSize: 13, opacity: 0.9 }}>
          {promptState.message ||
            "Autorize o DepotDownloader no app Steam Mobile ou digite o código solicitado:"}
        </p>

        {!promptState.qrDataUrl && (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <TextField
              type={isPassword ? "password" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                isPassword
                  ? "Senha Steam"
                  : promptState.prompt === "username"
                    ? "Usuário Steam"
                    : "Código Steam Guard / E-mail"
              }
            />
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <Button type="button" theme="outline" onClick={handleCancel}>
                Cancelar Download
              </Button>
              <Button type="submit" theme="primary" disabled={submitting}>
                Enviar
              </Button>
            </div>
          </form>
        )}

        {promptState.qrDataUrl && (
          <Button type="button" theme="outline" onClick={handleCancel}>
            Cancelar Download
          </Button>
        )}
      </div>
    </Modal>
  );
}
