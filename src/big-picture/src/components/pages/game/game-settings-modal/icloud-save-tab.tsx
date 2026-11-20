import type { LibraryGame } from "@types";
import { ICloudSaveSection } from "@renderer/pages/game-details/modals/game-options-modal/icloud-save-section";
import { EmbeddedDesktopPanel } from "./embedded-desktop-panel";

export const GAME_ICLOUD_SAVE_PRIMARY_CONTROL_ID =
  "game-icloud-save-primary-control";

interface GameICloudSaveTabProps {
  game: LibraryGame;
}

export function GameICloudSaveTab({ game }: Readonly<GameICloudSaveTabProps>) {
  return (
    <EmbeddedDesktopPanel
      focusId={GAME_ICLOUD_SAVE_PRIMARY_CONTROL_ID}
      actionLabel="Gerenciar Saves iCloud"
    >
      <ICloudSaveSection game={game} />
    </EmbeddedDesktopPanel>
  );
}
