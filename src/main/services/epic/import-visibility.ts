import type { Game } from "@types";

/** A stale preference/file callback must not expose another account's import. */
export function getContextualEpicGame(
  game: Game,
  context: { environment: string; userId: string } | null
): Game {
  const scope = game.epicImportScope;
  // If there is no cloud import scope, this is a local Cerberus import or standalone game.
  // Never delete or hide local games.
  if (!scope) {
    return game;
  }

  if (
    context &&
    scope.environment === context.environment &&
    scope.userId === context.userId
  ) {
    return game;
  }

  return {
    ...game,
    hasActiveEpicImport: false,
    epicPlayTimeInMilliseconds: 0,
    epicImportScope: undefined,
    ...(game.source === "epic" ? { isDeleted: true } : {}),
  };
}
