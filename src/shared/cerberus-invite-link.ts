export interface CerberusInviteData {
  shop: string;
  objectId: string;
  title: string;
  lobbyId?: string;
  connectString?: string;
}

export function buildCerberusInviteUrl(data: CerberusInviteData): string {
  const params = new URLSearchParams();
  params.set("shop", data.shop);
  params.set("id", data.objectId);
  params.set("title", data.title);
  if (data.lobbyId) params.set("lobby", data.lobbyId);
  if (data.connectString) params.set("connect", data.connectString);
  return `cerberus://join?${params.toString()}`;
}

export function parseCerberusInviteUrl(
  input: string | null | undefined
): CerberusInviteData | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed.startsWith("cerberus://join")) return null;

  try {
    const parsed = new URL(trimmed);
    const shop = parsed.searchParams.get("shop");
    const objectId = parsed.searchParams.get("id");
    const title = parsed.searchParams.get("title");
    if (!shop || !objectId || !title) return null;

    return {
      shop,
      objectId,
      title,
      lobbyId: parsed.searchParams.get("lobby") || undefined,
      connectString: parsed.searchParams.get("connect") || undefined,
    };
  } catch {
    return null;
  }
}
