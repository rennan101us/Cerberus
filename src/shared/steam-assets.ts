export interface SteamCdnAssets {
  coverImageUrl: string;
  libraryImageUrl: string;
  libraryHeroImageUrl: string;
  logoImageUrl: string;
  iconUrl: string;
}

export function buildSteamIconUrl(
  appId: string | number,
  iconHash?: string | null
): string {
  const cleanId = String(appId).trim();
  const cleanHash = iconHash?.trim();
  if (cleanHash && /^[0-9a-fA-F]{32,40}$/.test(cleanHash)) {
    return `https://media.steampowered.com/steamcommunity/public/images/apps/${cleanId}/${cleanHash}.jpg`;
  }
  return `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${cleanId}/header.jpg`;
}

export function buildSteamCdnAssets(
  appId: string | number,
  iconHash?: string | null
): SteamCdnAssets {
  const cleanId = String(appId).trim();
  const coverUrl = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${cleanId}/library_600x900.jpg`;
  return {
    coverImageUrl: coverUrl,
    libraryImageUrl: coverUrl,
    libraryHeroImageUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${cleanId}/library_hero.jpg`,
    logoImageUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${cleanId}/logo.png`,
    iconUrl: buildSteamIconUrl(cleanId, iconHash),
  };
}

export function getSteamCoverFallbacks(appId: string | number): string[] {
  const cleanId = String(appId).trim();
  if (!cleanId) return [];
  return [
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${cleanId}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${cleanId}/library_600x900.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${cleanId}/library_600x900_2x.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${cleanId}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${cleanId}/header.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${cleanId}/capsule_616x353.jpg`,
  ];
}

export function extractSteamAppId(
  input: string | null | undefined
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^\d{1,10}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(
    /(?:apps\/|steamstatic\.com\/.*\/apps\/|steam\/apps\/)(\d{1,10})/
  );
  return match ? match[1] : null;
}
