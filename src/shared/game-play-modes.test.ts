import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPlayModesFromSteamCategories,
  hasAnyPlayMode,
} from "./game-play-modes.js";

test("extractPlayModesFromSteamCategories detects singleplayer and coop modes", () => {
  const categories = [
    { id: 2, description: "Single-player" },
    { id: 1, description: "Multi-player" },
    { id: 38, description: "Online Co-op" },
    { id: 39, description: "Shared/Split Screen Co-op" },
  ];

  const modes = extractPlayModesFromSteamCategories(categories);
  assert.equal(modes.singlePlayer, true);
  assert.equal(modes.multiPlayer, true);
  assert.equal(modes.onlineCoop, true);
  assert.equal(modes.offlineCoop, true);
  assert.equal(modes.pvpOnline, false);
  assert.equal(hasAnyPlayMode(modes), true);
});

test("extractPlayModesFromSteamCategories returns all false for empty categories", () => {
  const modes = extractPlayModesFromSteamCategories([]);
  assert.equal(hasAnyPlayMode(modes), false);
  assert.equal(modes.singlePlayer, false);
});
