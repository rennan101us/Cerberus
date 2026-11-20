import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as libraryCategory from "./library-category.ts";

const {
  appendProfileLibraryFilterParams,
  filterLibraryGames,
  filterLibraryGamesByCategory,
  getLibraryFilterOptions,
  getLibraryPresentationBadgeSource,
  getLibraryPresentationImportSources,
  getProfileLibraryFilter,
  hasSteamLibraryGames,
  isSteamLibraryGame,
  parseStoredLibrarySources,
  readStoredLibraryFilters,
  resolveStoredLibraryCategory,
  shouldShowSteamLibraryBadge,
} = libraryCategory;

const games = [
  { id: "steam-import", shop: "steam", hasActiveSteamImport: true },
  { id: "steam-local", shop: "steam", hasActiveSteamImport: false },
  { id: "custom", shop: "custom" },
  {
    id: "switch-mac",
    shop: "switch2",
    switchPortedAppPath: "/Volumes/SSD FN501 PRO/Emulations/Nx Ports/OOT.app",
  },
  {
    id: "native-mac",
    shop: "custom",
    executablePath: "/Applications/Baldur.app",
  },
];

const ids = (list: { id: string }[]) => list.map((game) => game.id);

describe("Library categories", () => {
  it("filters grouped games by real imported sources instead of presentation", () => {
    const epicOwned = {
      id: "group",
      shop: "epic",
      catalogueGame: { shop: "steam", objectId: "123" },
      availableShops: ["steam", "epic"],
      members: [{ shop: "epic", hasActiveEpicImport: true }],
    };
    const filters = { category: "windows" as const, platforms: [] };
    assert.deepEqual(
      ids(filterLibraryGames([epicOwned], { ...filters, sources: ["epic"] })),
      ["group"]
    );
    assert.deepEqual(
      filterLibraryGames([epicOwned], { ...filters, sources: ["steam"] }),
      []
    );
    const ownedOnBoth = {
      ...epicOwned,
      members: [
        ...epicOwned.members,
        { shop: "steam", hasActiveSteamImport: true },
      ],
    };
    assert.deepEqual(
      ids(
        filterLibraryGames([ownedOnBoth], { ...filters, sources: ["steam"] })
      ),
      ["group"]
    );
    assert.deepEqual(
      ids(
        filterLibraryGames([ownedOnBoth], {
          ...filters,
          sources: ["steam", "epic"],
        })
      ),
      ["group"]
    );
  });

  it("splits Mac and Windows games", () => {
    assert.deepEqual(ids(filterLibraryGamesByCategory(games, "windows")), [
      "steam-import",
      "steam-local",
      "custom",
    ]);
    assert.deepEqual(ids(filterLibraryGamesByCategory(games, "mac")), [
      "switch-mac",
      "native-mac",
    ]);
    assert.equal(filterLibraryGamesByCategory(games, "all"), games);
  });

  it("migrates legacy categories to Windows or All", () => {
    assert.deepEqual(resolveStoredLibraryCategory("steam_library"), {
      category: "windows",
      sources: ["steam"],
    });
    assert.deepEqual(resolveStoredLibraryCategory("pc"), {
      category: "windows",
      sources: null,
    });
    assert.deepEqual(resolveStoredLibraryCategory("classics"), {
      category: "all",
      sources: null,
    });
    assert.deepEqual(resolveStoredLibraryCategory("mac"), {
      category: "mac",
      sources: null,
    });
    assert.deepEqual(resolveStoredLibraryCategory("windows"), {
      category: "windows",
      sources: null,
    });
    assert.deepEqual(resolveStoredLibraryCategory("unknown"), {
      category: "all",
      sources: null,
    });
    assert.deepEqual(resolveStoredLibraryCategory(null), {
      category: "all",
      sources: null,
    });
  });

  it("rewrites a stored Steam Library category once", () => {
    const values = new Map<string, string>([["category", "steam_library"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };

    assert.deepEqual(readStoredLibraryFilters(storage, "category", "sources"), {
      category: "windows",
      sources: ["steam"],
    });
    assert.equal(values.get("category"), "windows");
    assert.equal(values.get("sources"), '["steam"]');
    assert.deepEqual(readStoredLibraryFilters(storage, "category", "sources"), {
      category: "windows",
      sources: ["steam"],
    });
  });

  it("reads a single known library from storage", () => {
    assert.deepEqual(parseStoredLibrarySources('["steam","epic"]'), [
      "steam",
      "epic",
    ]);
    assert.deepEqual(parseStoredLibrarySources('["hydra"]'), ["hydra"]);
    assert.deepEqual(parseStoredLibrarySources('["steam","hydra"]'), [
      "hydra",
      "steam",
    ]);
    assert.deepEqual(parseStoredLibrarySources("not json"), []);
    assert.deepEqual(parseStoredLibrarySources('{"steam":true}'), []);
    assert.deepEqual(parseStoredLibrarySources(null), []);
  });
});

describe("Library and source filters", () => {
  it("uses the selected hidden library's sources independently", () => {
    const visibleGames = [{ id: "visible-pc", shop: "steam" }];
    const hiddenGames = [
      { id: "hidden-steam", shop: "steam", hasActiveSteamImport: true },
      { id: "hidden-hydra", shop: "steam" },
    ];

    assert.deepEqual(getLibraryFilterOptions(visibleGames), {
      hasImportedGames: false,
      sources: ["hydra"],
      platforms: [],
    });
    assert.deepEqual(getLibraryFilterOptions(hiddenGames), {
      hasImportedGames: true,
      sources: ["hydra", "steam"],
      platforms: [],
    });
    assert.deepEqual(
      ids(
        filterLibraryGames(hiddenGames, {
          category: "all",
          sources: ["steam"],
          platforms: [],
        })
      ),
      ["hidden-steam"]
    );
  });

  it("offers only the libraries that have imported games", () => {
    assert.deepEqual(
      getLibraryFilterOptions([{ shop: "steam", hasActiveSteamImport: true }])
        .sources,
      ["hydra", "steam"]
    );
    assert.deepEqual(
      getLibraryFilterOptions([
        {
          shop: "steam",
          members: [
            { shop: "steam", hasActiveSteamImport: true },
            { shop: "epic", hasActiveEpicImport: true },
          ],
        },
      ]).sources,
      ["hydra", "steam", "epic"]
    );
  });

  it("returns every game in the category when nothing is selected", () => {
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "all",
          sources: [],
          platforms: [],
        })
      ),
      ids(games)
    );
  });

  it("filters Windows games by library", () => {
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "windows",
          sources: ["steam"],
          platforms: [],
        })
      ),
      ["steam-import"]
    );
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "windows",
          sources: ["hydra"],
          platforms: [],
        })
      ),
      ["steam-local", "custom"]
    );
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "windows",
          sources: ["hydra", "steam"],
          platforms: [],
        })
      ),
      ["steam-import", "steam-local", "custom"]
    );
  });

  it("detects Steam imports", () => {
    assert.equal(hasSteamLibraryGames(games), true);
    assert.equal(hasSteamLibraryGames(games.slice(1)), false);
  });
});

describe("Profile library filter", () => {
  it("maps profile platforms to shops", () => {
    assert.deepEqual(getProfileLibraryFilter("windows"), {
      shops: ["steam", "epic"],
    });
    assert.deepEqual(getProfileLibraryFilter("mac"), {
      shops: ["switch1", "switch2"],
    });

    const params = new URLSearchParams();
    appendProfileLibraryFilterParams(params, getProfileLibraryFilter("all"));
    assert.equal(params.toString(), "shop=steam&shop=epic&shop=launchbox");
  });
});

describe("Steam badge", () => {
  it("lists every active import for separate badges", () => {
    assert.deepEqual(
      getLibraryPresentationImportSources({
        shop: "steam",
        members: [
          { shop: "steam", hasActiveSteamImport: true },
          { shop: "epic", hasActiveEpicImport: true },
          { shop: "epic", hasActiveEpicImport: true, isDeleted: true },
        ],
      }),
      { steam: true, epic: true }
    );
    assert.deepEqual(
      getLibraryPresentationImportSources({
        shop: "epic",
        hasActiveEpicImport: true,
      }),
      { steam: false, epic: true }
    );
  });

  it("uses real imports instead of catalogue availability or preferred metadata", () => {
    const catalogue = {
      shop: "epic",
      canonicalId: "same-game",
      catalogueGame: { shop: "steam", objectId: "123" },
      availableShops: ["steam", "epic"],
    };
    assert.equal(getLibraryPresentationBadgeSource(catalogue), null);
    assert.equal(
      getLibraryPresentationBadgeSource({
        ...catalogue,
        hasActiveSteamImport: false,
        hasActiveEpicImport: false,
      }),
      null
    );
    assert.equal(
      getLibraryPresentationBadgeSource({
        ...catalogue,
        hasActiveEpicImport: true,
      }),
      "epic"
    );
    assert.equal(
      getLibraryPresentationBadgeSource({
        ...catalogue,
        hasActiveSteamImport: true,
      }),
      "steam"
    );
    assert.equal(
      getLibraryPresentationBadgeSource({
        ...catalogue,
        hasActiveSteamImport: true,
        hasActiveEpicImport: true,
      }),
      "steam"
    );
  });

  it("hides Steam badges without changing import membership", () => {
    assert.equal(shouldShowSteamLibraryBadge(games[0]), true);
    assert.equal(shouldShowSteamLibraryBadge(games[0], false), true);
    assert.equal(shouldShowSteamLibraryBadge(games[0], true), false);
    assert.equal(shouldShowSteamLibraryBadge(games[1]), false);
    assert.equal(isSteamLibraryGame(games[0]), true);
  });
});

it("keeps Epic imports distinct and preserves two selected sources", () => {
  const sampleGames = [
    { shop: "epic", hasActiveEpicImport: true },
    { shop: "epic", hasActiveEpicImport: false },
    { shop: "steam", hasActiveSteamImport: true },
  ];
  assert.deepEqual(
    filterLibraryGames(sampleGames, {
      category: "windows",
      sources: ["epic"],
      platforms: [],
    }),
    [sampleGames[0]]
  );
  assert.deepEqual(
    filterLibraryGames(sampleGames, {
      category: "windows",
      sources: ["epic", "steam"],
      platforms: [],
    }),
    [sampleGames[0], sampleGames[2]]
  );
  assert.deepEqual(parseStoredLibrarySources('["epic","hydra"]'), [
    "hydra",
    "epic",
  ]);
  assert.deepEqual(parseStoredLibrarySources('["epic","hydra","steam"]'), []);
});
