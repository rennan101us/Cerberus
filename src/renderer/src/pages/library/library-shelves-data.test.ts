import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLibraryShelves,
  SHELF_DEFINITIONS,
  type LibraryShelfId,
} from "./library-shelves-data.js";

test("SHELF_DEFINITIONS correctly classifies games by store and platform", () => {
  const macGame = {
    id: "1",
    shop: "mac_native",
    title: "Mac Game",
  } as any;
  const wineGame = {
    id: "2",
    shop: "custom",
    executablePath: "C:\\Games\\game.exe",
    title: "Windows Game",
  } as any;
  const switch1Game = {
    id: "3",
    shop: "switch1",
    title: "Switch 1 Game",
  } as any;
  const switch2Game = {
    id: "4",
    shop: "switch2",
    title: "Switch 2 Game",
  } as any;
  const steamGame = {
    id: "5",
    shop: "steam",
    hasActiveSteamImport: true,
    title: "Steam Game",
  } as any;
  const epicGame = {
    id: "6",
    shop: "epic",
    hasActiveEpicImport: true,
    title: "Epic Game",
  } as any;
  const gogGame = {
    id: "7",
    shop: "gog",
    source: "gog",
    title: "GOG Game",
  } as any;
  const favoriteGame = {
    id: "8",
    shop: "steam",
    favorite: true,
    title: "Favorite Game",
  } as any;

  assert.equal(SHELF_DEFINITIONS.mac_native.matches(macGame), true);
  assert.equal(SHELF_DEFINITIONS.windows_red_wine.matches(wineGame), true);
  assert.equal(SHELF_DEFINITIONS.switch1.matches(switch1Game), true);
  assert.equal(SHELF_DEFINITIONS.switch2.matches(switch2Game), true);
  assert.equal(SHELF_DEFINITIONS.steam.matches(steamGame), true);
  assert.equal(SHELF_DEFINITIONS.epic.matches(epicGame), true);
  assert.equal(SHELF_DEFINITIONS.gog.matches(gogGame), true);
  assert.equal(SHELF_DEFINITIONS.favorites.matches(favoriteGame), true);
});

test("buildLibraryShelves respects custom ordering and hidden shelves", () => {
  const games = [
    { id: "1", shop: "mac_native", title: "Mac Game" },
    { id: "2", shop: "switch1", title: "Switch Game" },
    { id: "3", shop: "gog", title: "GOG Game" },
  ] as any;

  const customOrder: LibraryShelfId[] = ["gog", "mac_native", "switch1"];
  const hidden: LibraryShelfId[] = ["switch1"];

  const shelves = buildLibraryShelves(games, customOrder, hidden);
  assert.equal(shelves.length, 2);
  assert.equal(shelves[0].id, "gog");
  assert.equal(shelves[1].id, "mac_native");
});
