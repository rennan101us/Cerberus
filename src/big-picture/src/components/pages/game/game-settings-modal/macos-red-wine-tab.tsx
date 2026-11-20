import type { LibraryGame } from "@types";
import { MacOsCrossOverSection } from "@renderer/pages/game-details/modals/game-options-modal/macos-crossover-section";
import { EmbeddedDesktopPanel } from "./embedded-desktop-panel";

export const GAME_MACOS_RED_WINE_PRIMARY_CONTROL_ID =
  "game-macos-red-wine-primary-control";

interface GameMacOsRedWineSettingsTabProps {
  game: LibraryGame;
}

export function GameMacOsRedWineSettingsTab({
  game,
}: Readonly<GameMacOsRedWineSettingsTabProps>) {
  return (
    <EmbeddedDesktopPanel
      focusId={GAME_MACOS_RED_WINE_PRIMARY_CONTROL_ID}
      actionLabel="Configurar Red Wine"
    >
      <MacOsCrossOverSection
        game={game}
        onUpdateGame={() => {
          globalThis.window.dispatchEvent(new Event("library-update"));
        }}
      />
    </EmbeddedDesktopPanel>
  );
}
