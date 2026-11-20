import { useState } from "react";
import type { LibraryGame } from "@types";
import { SwitchGameSettingsSection } from "@renderer/pages/game-details/modals/game-options-modal/switch-game-settings-section";
import { SwitchPortModal } from "@renderer/pages/game-details/modals/switch-port-modal/switch-port-modal";
import { EmbeddedDesktopPanel } from "./embedded-desktop-panel";

export const GAME_SWITCH_SETTINGS_PRIMARY_CONTROL_ID =
  "game-switch-settings-primary-control";

interface GameSwitchSettingsTabProps {
  game: LibraryGame;
}

export function GameSwitchSettingsTab({
  game,
}: Readonly<GameSwitchSettingsTabProps>) {
  const [showPortModal, setShowPortModal] = useState(false);

  return (
    <EmbeddedDesktopPanel
      focusId={GAME_SWITCH_SETTINGS_PRIMARY_CONTROL_ID}
      actionLabel={
        game.switchPortedAppPath
          ? "Configurar Switch / Port"
          : "Abrir Portar / Configurações Switch"
      }
    >
      <SwitchGameSettingsSection
        game={game}
        onOpenPortModal={() => setShowPortModal(true)}
      />
      <SwitchPortModal
        visible={showPortModal}
        game={game}
        onClose={() => {
          setShowPortModal(false);
          globalThis.window.dispatchEvent(new Event("library-update"));
        }}
      />
    </EmbeddedDesktopPanel>
  );
}
