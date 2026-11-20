import { useEffect, useState } from "react";
import { Cloud, CloudCheck, CloudOff } from "lucide-react";
import type { GameShop, ICloudGameSaveInfo } from "@types";

export interface ICloudSaveWidgetProps {
  shop: GameShop;
  objectId: string;
  onOpenSettings: () => void;
}

export function ICloudSaveWidget({
  shop,
  objectId,
  onOpenSettings,
}: Readonly<ICloudSaveWidgetProps>) {
  const [info, setInfo] = useState<ICloudGameSaveInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electron
      .icloudGetGameSaveInfo(shop, objectId)
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [shop, objectId]);

  const unavailable = info !== null && !info.available;
  const synced = Boolean(info?.icloudBackupExists);

  return (
    <button
      type="button"
      className="game-details__cloud-sync-button"
      onClick={onOpenSettings}
      title={
        unavailable
          ? "iCloud Drive indisponível neste Mac"
          : synced
            ? "Backup salvo no iCloud Drive"
            : "Configurar salvamento no iCloud Drive"
      }
    >
      <div className="game-details__cloud-icon-container">
        {unavailable ? (
          <CloudOff size={16} strokeWidth={2} />
        ) : synced ? (
          <CloudCheck size={16} strokeWidth={2} />
        ) : (
          <Cloud size={16} strokeWidth={2} />
        )}
      </div>
      {unavailable
        ? "iCloud Indisponível"
        : synced
          ? "iCloud Sincronizado"
          : "Salvar no iCloud"}
    </button>
  );
}
