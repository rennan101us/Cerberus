import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NXN_MAGIC_HEADER,
  baseApplicationTitleId,
  buildSdlGameControllerEnvForProfile,
  classifySwitchGeneration,
  cleanPortalCardTitle,
  decodeBlueRomsDataLink,
  decryptNxnPresetBuffer,
  encryptNxnPresetBuffer,
  extractArtworkUrls,
  extractBlueRomsDownloadPath,
  extractNswpediaDownloadLinks,
  extractPortalSlugCandidates,
  extractRomsHqDownloadLinks,
  getSwitchPortButtonState,
  inspectProdKeysText,
  isLikelySwitchSourceUrl,
  normalizeSwitchTitle,
  parseProdKeysText,
  parseRamRequirementGB,
  scoreSwitchTitleMatch,
} from "./nx-core-parsers.js";
import type { ControllerProfile } from "../../../types/nxnative.types.js";

describe("prod.keys parser and inspector", () => {
  it("parses valid hex keys and ignores comments or malformed lines", () => {
    const sample = [
      "# Nintendo Switch keys",
      "header_key = " + "aa".repeat(32) + " ; inline comment",
      "master_key_00 = " + "11".repeat(16),
      "master_key_12 = " + "22".repeat(16),
      "invalid_line_without_equals",
      "bad_hex = ZZZZ",
    ].join("\n");

    const parsed = parseProdKeysText(sample);
    assert.equal(Object.keys(parsed).length, 3);
    assert.equal(parsed.header_key.length, 32);
    assert.equal(parsed.master_key_12.length, 16);

    const inspection = inspectProdKeysText(sample);
    assert.equal(inspection.isValid, true);
    assert.equal(inspection.highestMasterRev, 0x12);
    assert.match(inspection.firmwareSummary ?? "", /Firmware até 19\.0\.0/);
  });

  it("rejects prod.keys without a 32-byte header_key", () => {
    const inspection = inspectProdKeysText(
      "master_key_00 = " + "11".repeat(16)
    );
    assert.equal(inspection.isValid, false);
    assert.match(inspection.error ?? "", /header_key/);
  });
});

describe(".nxn encrypted preset format (AES-256-GCM + HKDF-SHA256)", () => {
  it("round-trips metadata and runtime config with exact NXN_PRESET magic header", () => {
    const meta = {
      presetName: "1080p Smooth 60",
      titleId: "01007EF00011E000",
      notes: "Test preset for Zelda",
    };
    const payload = {
      enable60FPS: true,
      enableMetalHUD: true,
      isDockedMode: true,
      renderScale: 1.5,
      enableMetalFXUpscale: true,
      ootExperimentalFrameGen: true,
    };

    const encoded = encryptNxnPresetBuffer(meta, payload);
    assert.equal(
      encoded.subarray(0, NXN_MAGIC_HEADER.length).equals(NXN_MAGIC_HEADER),
      true
    );

    const decoded = decryptNxnPresetBuffer(encoded);
    assert.deepEqual(decoded.metadata, meta);
    assert.deepEqual(decoded.config, payload);
  });

  it("rejects tampered ciphertext or invalid magic header", () => {
    const encoded = encryptNxnPresetBuffer(
      { presetName: "Test", titleId: "0100000000000000" },
      { enable60FPS: true }
    );

    const tampered = Buffer.from(encoded);
    tampered[tampered.length - 20] ^= 0xff;
    assert.throws(() => decryptNxnPresetBuffer(tampered));

    const badMagic = Buffer.from(encoded);
    badMagic[0] = 0x00;
    assert.throws(() => decryptNxnPresetBuffer(badMagic), /Assinatura mágica/);
  });
});

describe("Switch download source heuristics & normalization", () => {
  it("detects Switch 1/2 sites from screenshot and magnets while leaving PC JSON as Hydra", () => {
    assert.equal(
      isLikelySwitchSourceUrl("https://www.blueroms.ws/switch2"),
      true
    );
    assert.equal(
      isLikelySwitchSourceUrl(
        "https://romshq.com/games?type=game&scene=62%2C95"
      ),
      true
    );
    assert.equal(
      isLikelySwitchSourceUrl("https://nswpedia.com/nintendo-switch-roms"),
      true
    );
    assert.equal(
      isLikelySwitchSourceUrl("magnet:?xt=urn:btih:abcdef1234567890"),
      true
    );
    assert.equal(
      isLikelySwitchSourceUrl("https://hydralinks.cloud/sources/fitgirl.json"),
      false
    );
  });

  it("normalizes ROM filenames and classifies Switch 1 vs Switch 2", () => {
    assert.equal(
      normalizeSwitchTitle(
        "The Legend of Zelda: Tears of the Kingdom [0100F2C0115B6000][v0].nsp"
      ),
      "thelegendofzeldatearsofthekingdom"
    );
    assert.equal(classifySwitchGeneration("0400123456789000"), "switch2");
    assert.equal(classifySwitchGeneration("0100F2C0115B6000"), "switch1");
    assert.equal(
      classifySwitchGeneration(null, "Nintendo Switch 2 Compatible"),
      "switch2"
    );
    assert.equal(parseRamRequirementGB("M1+ · 16GB RAM"), 16);
    assert.equal(parseRamRequirementGB("8 GB"), 8);
  });
});

describe("CrossOver SDL_GAMECONTROLLERCONFIG builder", () => {
  it("builds SDL mapping for Xbox/DualSense/Switch Pro controllers", () => {
    const profile: ControllerProfile = {
      id: "nintendo",
      name: "Nintendo Padrão",
      isDefault: true,
      targetDeviceName: "All Gamepads",
      gamepadBindings: {
        buttonB: "A",
        buttonA: "B",
        buttonY: "X",
        buttonX: "Y",
        leftShoulder: "L",
        rightShoulder: "R",
        buttonMenu: "Plus",
        buttonOptions: "Minus",
      },
      keyboardBindings: {},
      keyboardMovement: { up: 13, left: 0, down: 1, right: 2 },
      analogDeadzone: 0.12,
      mouseMode: "auto",
      mouseAsRightStick: true,
      mouseSensitivity: 5,
      mouseInvertX: false,
      mouseInvertY: false,
      mouseRightStickMode: "cursorLock",
      mouseSwitch2Enabled: true,
      mouseSwitch2PointerSpeed: 1,
      mouseSwitch2LockCursor: true,
      mouseSwitch2PrimaryButton: "left",
      mouseSwitch2Side: "right",
      mouseSwitch2InvertY: false,
      enableRumble: true,
      rumbleStrength: 1,
      rumbleFloorBoost: true,
    };

    const env = buildSdlGameControllerEnvForProfile(profile);
    assert.equal(env.SDL_GAMECONTROLLER_USE_BUTTON_LABELS, "1");
    assert.equal(env.CERBERUS_CONTROLLER_PROFILE, "Nintendo Padrão");
    assert.equal(env.CERBERUS_CONTROLLER_DEADZONE, "0.12");
    assert.match(env.SDL_GAMECONTROLLERCONFIG, /Xbox Wireless Controller/);
    assert.match(env.SDL_GAMECONTROLLERCONFIG, /PS5 DualSense Controller/);
    assert.match(env.SDL_GAMECONTROLLERCONFIG, /platform:Mac OS X/);
  });
});

describe("Phase 2 Switch artwork, Title ID, button state, and portal parsers", () => {
  it("computes baseApplicationTitleId across base, update, and DLC IDs", () => {
    assert.equal(
      baseApplicationTitleId("01007EF00011E000"),
      "01007EF00011E000"
    );
    assert.equal(
      baseApplicationTitleId("01007EF00011E800"),
      "01007EF00011E000"
    );
    assert.equal(
      baseApplicationTitleId("01007EF00011F001"),
      "01007EF00011E000"
    );
    assert.equal(
      baseApplicationTitleId("0100f2c0115b7005"),
      "0100F2C0115B6000"
    );
    assert.equal(baseApplicationTitleId("invalid"), null);
  });

  it("extracts icon and banner artwork keys from both schemas", () => {
    assert.deepEqual(
      extractArtworkUrls({
        icon: "https://tinfoil.media/ti/0100A9D01C446000/512/512",
        banner: "https://tinfoil.media/bi/0100A9D01C446000/1280/720",
      }),
      {
        icon: "https://tinfoil.media/ti/0100A9D01C446000/512/512",
        banner: "https://tinfoil.media/bi/0100A9D01C446000/1280/720",
      }
    );
    assert.deepEqual(
      extractArtworkUrls({
        iconUrl: "https://example.com/icon.jpg",
        bannerUrl: "https://example.com/banner.jpg",
      }),
      {
        icon: "https://example.com/icon.jpg",
        banner: "https://example.com/banner.jpg",
      }
    );
    assert.deepEqual(extractArtworkUrls(null), { icon: null, banner: null });
  });

  it("scores Switch titles accurately while rejecting sequel/subtitle mismatches", () => {
    assert.equal(
      scoreSwitchTitleMatch(
        "Poke\u0301mon Pokopia",
        "Pokémon Pokopia (Switch 2)"
      ),
      1
    );
    assert.equal(
      scoreSwitchTitleMatch(
        "The Legend of Zelda Ocarina of Time",
        "The Legend of Zelda: Breath of the Wild"
      ),
      0
    );
    assert.equal(
      scoreSwitchTitleMatch("Pokémon Legends: Z-A", "Pokémon Legends: Arceus"),
      0
    );
    assert.ok(
      scoreSwitchTitleMatch(
        "The Legend of Zelda: Link's Awakening [01006BB00C6F0000].nsp",
        "The Legend of Zelda Link’s Awakening"
      ) >= 0.9
    );
    assert.ok(
      scoreSwitchTitleMatch(
        "The Legend of Zelda Ocarina of Time Remake",
        "The Legend of Zelda: Ocarina of Time"
      ) >= 0.9
    );
    assert.equal(
      scoreSwitchTitleMatch(
        "The Legend of Zelda: Ocarina of Time",
        "The Legend of Khiimori"
      ),
      0
    );
  });

  it("cleans portal card titles and extracts slug candidates for RomsHQ, NSWPedia, and BlueRoms", () => {
    assert.equal(
      cleanPortalCardTitle(
        "Final Release The Legend of Zelda: Ocarina of Time 2026 • 1.2 GB"
      ),
      "The Legend of Zelda: Ocarina of Time"
    );
    assert.equal(
      cleanPortalCardTitle(
        "Final Release Fire Emblem: Fortune&#039;s Weave 2026"
      ),
      "Fire Emblem: Fortune's Weave"
    );
    assert.equal(cleanPortalCardTitle("Download Now"), "");

    const ootSlugs = extractPortalSlugCandidates(
      "https://romshq.com/game/the-legend-of-zelda-ocarina-of-time-2"
    );
    assert.ok(ootSlugs.includes("the legend of zelda ocarina of time"));

    const bayoSlugs = extractPortalSlugCandidates(
      "https://romshq.com/game/bayonetta-3"
    );
    assert.ok(bayoSlugs.includes("bayonetta 3"));

    const arceusSlugs = extractPortalSlugCandidates(
      "https://nswpedia.com/nintendo-switch-roms/adventure/pokemon-legends-arceus-nsp-64"
    );
    assert.ok(arceusSlugs.includes("pokemon legends arceus"));
  });

  it("derives Switch Play/Port button visibility strictly from macOS and iOS ports", () => {
    assert.deepEqual(
      getSwitchPortButtonState({
        isSwitchGame: true,
        hasMacPort: false,
        hasIosPort: false,
      }),
      { showPlay: false, showPrimaryPort: true, showSecondaryPort: false }
    );
    assert.deepEqual(
      getSwitchPortButtonState({
        isSwitchGame: true,
        hasMacPort: true,
        hasIosPort: false,
      }),
      { showPlay: true, showPrimaryPort: false, showSecondaryPort: true }
    );
    assert.deepEqual(
      getSwitchPortButtonState({
        isSwitchGame: true,
        hasMacPort: true,
        hasIosPort: true,
      }),
      { showPlay: true, showPrimaryPort: false, showSecondaryPort: false }
    );
  });

  it("parses BlueRoms, NSWPedia, and RomsHQ download links", () => {
    const encodedMagnet = Buffer.from(
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Pokopia"
    ).toString("base64");
    const blueHtml = `<a class="btn" href="/download/98765">Download</a><button data-link="${encodedMagnet}">Go</button>`;
    assert.equal(extractBlueRomsDownloadPath(blueHtml), "/download/98765");
    assert.equal(
      decodeBlueRomsDataLink(blueHtml),
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Pokopia"
    );

    const nswHtml = `
      <a href="https://nswpedia.com/download/game-1">Page</a>
      <a href="https://nswpedia.com/download_list/game-1">List</a>
      <a id="download-link" href="https://cdn.example.com/game.nsp">Direct</a>
    `;
    assert.deepEqual(extractNswpediaDownloadLinks(nswHtml), {
      downloadPages: ["https://nswpedia.com/download/game-1"],
      directLinks: ["https://cdn.example.com/game.nsp"],
      downloadListPages: ["https://nswpedia.com/download_list/game-1"],
    });

    const romsHqHtml = `
      <a href="https://1fichier.com/?abc">Slow</a>
      <a href="https://datanodes.to/8vt8gmlpbocu">Datanodes</a>
      <a href="https://filekeeper.net/uc48lbb0rk7e/Eglantine_Selevet_Legend_of_Zelda_Ocarina_of_Time_Emulator.rar">Emulator</a>
      <a href="https://filekeeper.net/9aiuqrjusjhr/The_Legend_of_Zelda_Ocarina_of_Time_Switch_2_NUP_Base_Game.rar">FileKeeper Base</a>
      <a href="/files/Game.nsz">NSZ</a>
      <a href="magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12">Magnet</a>
    `;
    const ranked = extractRomsHqDownloadLinks(
      romsHqHtml,
      "https://romshq.com/games/sample"
    );
    assert.equal(ranked[0].startsWith("magnet:"), true);
    assert.equal(ranked[1], "https://romshq.com/files/Game.nsz");
    assert.equal(
      ranked[2],
      "https://filekeeper.net/9aiuqrjusjhr/The_Legend_of_Zelda_Ocarina_of_Time_Switch_2_NUP_Base_Game.rar"
    );
    assert.equal(ranked[3], "https://datanodes.to/8vt8gmlpbocu");
  });
});
