import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSteamCdnAssets,
  buildSteamIconUrl,
  extractSteamAppId,
  getSteamCoverFallbacks,
} from "./steam-assets.js";

test("buildSteamIconUrl formats valid hash as community image", () => {
  const hash = "b8e1e7e4dbde906d091e4a1a5b8109bf1f609e7c";
  const url = buildSteamIconUrl(1091500, hash);
  assert.equal(
    url,
    "https://media.steampowered.com/steamcommunity/public/images/apps/1091500/b8e1e7e4dbde906d091e4a1a5b8109bf1f609e7c.jpg"
  );
});

test("buildSteamIconUrl falls back to header.jpg when hash is missing or invalid", () => {
  assert.equal(
    buildSteamIconUrl("730", null),
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/header.jpg"
  );
  assert.equal(
    buildSteamIconUrl("730", "not-a-hash"),
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/header.jpg"
  );
});

test("buildSteamCdnAssets builds standard 1x assets", () => {
  const assets = buildSteamCdnAssets(730);
  assert.equal(
    assets.coverImageUrl,
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/library_600x900.jpg"
  );
  assert.equal(
    assets.libraryHeroImageUrl,
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/library_hero.jpg"
  );
});

test("extractSteamAppId extracts numeric appId from ID or URL", () => {
  assert.equal(extractSteamAppId("1091500"), "1091500");
  assert.equal(
    extractSteamAppId(
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/library_600x900.jpg"
    ),
    "570"
  );
  assert.equal(extractSteamAppId("epic-game-id"), null);
});

test("getSteamCoverFallbacks returns fallback candidates in priority order", () => {
  const fallbacks = getSteamCoverFallbacks(1091500);
  assert.ok(fallbacks.length >= 4);
  assert.ok(fallbacks[0].includes("library_600x900.jpg"));
  assert.ok(fallbacks[1].includes("cloudflare"));
  assert.ok(fallbacks[2].includes("library_600x900_2x.jpg"));
});
